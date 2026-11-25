/**
 * ARGUS tRPC router — targets, jobs, findings, reports, dashboard summary.
 *
 * Server-side gates (Part 4 of the Master Build Document) are enforced here,
 * not in the UI:
 *   1. No job without verified ownership + locked scope + authorization record.
 *   2. This build scans ARGUS Range demo targets only — first live pilot
 *      target is gated behind counsel review (Gate G4).
 *   3. Finding states are never written by the client; lifecycle only.
 *   4. Every mutation appends to the audit log.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import {
  auditLog,
  detectionEvents,
  findings,
  jobEvents,
  jobs,
  reports,
  targets,
} from "../db/schema";
import { RANGE } from "./services/range";
import { startEngine, stopJob } from "./services/engine";
import { buildReportForJob } from "./services/report";
import { TRPCError } from "@trpc/server";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function audit(userId: number, action: string, detail?: unknown) {
  await getDb()
    .insert(auditLog)
    .values({ userId, action, detail: detail ? JSON.stringify(detail) : null });
}

/* ── Demo mode (S10): seed the ARGUS Range so a brand-new account opens onto a
   living dashboard. Idempotent per user. Everything seeded is flagged demo. ── */
async function ensureDemoData(userId: number) {
  const db = getDb();
  const existing = await db.select().from(targets).where(eq(targets.userId, userId));
  if (existing.length > 0) return;

  const created: Record<string, number> = {};
  for (const t of Object.values(RANGE)) {
    const scopeHash = sha256(
      JSON.stringify({ v: 1, hosts: [t.domain], methods: ["GET", "HEAD", "OPTIONS"], rps: 5, maxRequests: 300 }),
    );
    const [r] = await db.insert(targets).values({
      userId,
      name: t.name,
      domain: t.domain,
      environment: "range",
      verification: "verified",
      verifyMethod: "dns-txt",
      isCdn: t.isCdn,
      originVerified: t.originVerified,
      scopeLocked: true,
      scopeHash,
      city: t.city,
      industry: t.industry,
    });
    created[t.domain] = Number(r.insertId);
  }

  // One completed job (clinic) + one stopped-by-watcher job (law firm),
  // so the timeline, the proof packet and the kill-switch story all render.
  const clinic = created["clinicmock.range.aidynamic.pro"];
  const lex = created["lexpartners.range.aidynamic.pro"];

  const [j1] = await db.insert(jobs).values({
    userId, targetId: clinic, state: "queued", progress: 0, isDemo: true,
  });
  const jobId1 = Number(j1.insertId);
  // Drive the clinic job to completion immediately (synchronously replayed).
  await replayJob(jobId1, false);

  const [j2] = await db.insert(jobs).values({
    userId, targetId: lex, state: "queued", progress: 0, isDemo: true,
  });
  await replayJob(Number(j2.insertId), true);

  await audit(userId, "demo.seeded", { targets: Object.values(created) });
}

/** Fast replay used by the seeder: runs the full lifecycle in one go. */
async function replayJob(jobId: number, stopMidway: boolean) {
  const db = getDb();
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return;
  const [target] = await db.select().from(targets).where(eq(targets.id, job.targetId));
  const script = RANGE[target.domain];
  const fp = (d: string, e: string) =>
    sha256(`${d}|${target.domain}|${e.toLowerCase()}`);

  const ev = (
    agent: "scout" | "hacker" | "watcher" | "reporter" | "proxy" | "system",
    kind: "info" | "metric" | "threshold" | "stop" | "signal",
    message: string,
  ) => db.insert(jobEvents).values({ jobId, agent, kind, message });

  await ev("system", "info", `Authorization gate passed: ownership verified, scope hash ${target.scopeHash?.slice(0, 12)}… locked.`);
  await ev("proxy", "info", `Egress proxy armed: allowlist ${target.domain} · GET/HEAD/OPTIONS only · 5 rps · budget 300 req.`);
  if (target.isCdn)
    await ev("proxy", "info", "CDN/shared-IP rule (S5): Host/SNI-pinned HTTPS only, port scan skipped.");
  await ev("scout", "info", "DNS pinned. Crawled 23 pages, parsed robots.txt + sitemap, 3 subdomains from CT logs.");
  await ev("scout", "info", "TLS matrix complete; tech fingerprint tagged with version confidence.");

  if (stopMidway) {
    await ev("watcher", "threshold", "Error rate ×6 baseline, sustained 403s — stop threshold crossed.");
    await ev("watcher", "stop", "KILL SWITCH engaged by watcher — proxy revoked the job token; traffic halted <1s.");
    await db.insert(detectionEvents).values({
      jobId, tier: "external", source: "external-signals",
      message: "403/challenge pages + latency spike vs Scout baseline — defenses appeared to react (no connector, unconfirmed).",
    });
    for (const f of script.findings.slice(0, 2))
      await db.insert(findings).values({
        userId: job.userId, jobId, targetId: job.targetId,
        detectorId: f.detectorId, title: f.title, severity: f.severity,
        state: f.state, fingerprint: fp(f.detectorId, f.endpoint),
        endpoint: f.endpoint, summary: f.summary, evidence: f.evidence,
      });
    await db.update(jobs).set({
      state: "stopped", stopReason: "watcher: error-rate threshold", progress: 61,
      requests: 168, startedAt: new Date(Date.now() - 3600e3), finishedAt: new Date(Date.now() - 3540e3),
    }).where(eq(jobs.id, jobId));
    return;
  }

  if (script.wafReacts)
    await ev("watcher", "threshold", "Error rate ×4 baseline, 403 challenge page observed — within stop thresholds.");
  await ev("hacker", "info", "Detectors adjudicating stored observations offline — zero LLM in the loop (S2).");
  for (const f of script.findings)
    await db.insert(findings).values({
      userId: job.userId, jobId, targetId: job.targetId,
      detectorId: f.detectorId, title: f.title, severity: f.severity,
      state: f.state, fingerprint: fp(f.detectorId, f.endpoint),
      endpoint: f.endpoint, summary: f.summary, evidence: f.evidence,
    });
  await db.insert(detectionEvents).values({
    jobId, tier: "confirmed", source: "cloudflare",
    message: "Cloudflare connector matched 41 firewall events to scanner UA + published IP — your defenses logged this test.",
  });
  await ev("watcher", "signal", "Detection tier: CONFIRMED via customer's own Cloudflare logs (S7).");
  await ev("reporter", "info", "Report composed (LLM_PROVIDER=none). Proof Packet sealed with SHA-256 hash chain + platform signature.");

  await db.update(jobs).set({
    state: "reporting", progress: 97, requests: 214,
    startedAt: new Date(Date.now() - 7200e3),
  }).where(eq(jobs.id, jobId));
  await buildReportForJob(jobId);
  await db.update(jobs).set({
    state: "completed", progress: 100, finishedAt: new Date(Date.now() - 7140e3),
  }).where(eq(jobs.id, jobId));
}

/* severity weights for the exposure ranking */
const SEV_W = { critical: 25, high: 10, medium: 4, low: 1, info: 0 } as const;

export const argusRouter = createRouter({
  /* ── dashboard ─────────────────────────────────────────────────────── */
  summary: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    await ensureDemoData(ctx.user.id);

    const tgs = await db.select().from(targets).where(eq(targets.userId, ctx.user.id));
    const jbs = await db
      .select().from(jobs).where(eq(jobs.userId, ctx.user.id)).orderBy(desc(jobs.createdAt));
    const fnds = await db
      .select().from(findings).where(eq(findings.userId, ctx.user.id)).orderBy(desc(findings.createdAt));
    const jobIds = jbs.map((j) => j.id);
    const evs = jobIdsEmpty(jobIds)
      ? []
      : await db.select().from(jobEvents).where(inArray(jobEvents.jobId, jobIds)).orderBy(desc(jobEvents.createdAt)).limit(30);
    const det = jobIdsEmpty(jobIds)
      ? []
      : await db.select().from(detectionEvents).where(inArray(detectionEvents.jobId, jobIds)).orderBy(desc(detectionEvents.id)).limit(20);

    const count = (s: string) => fnds.filter((f) => f.state === s).length;
    const sev = (s: string) => fnds.filter((f) => f.severity === s && f.state === "reproduced" && f.lifecycle !== "verified_fixed").length;
    const active = jbs.filter((j) => ["queued", "scouting", "adjudicating", "reporting"].includes(j.state));

    const risk = (t: (typeof tgs)[number]) =>
      fnds
        .filter((f) => f.targetId === t.id && f.lifecycle !== "verified_fixed")
        .reduce((a, f) => a + (f.state === "reproduced" ? SEV_W[f.severity] : f.state === "inconclusive" ? 2 : 0), 0);

    // findings created per hour, last 12 buckets — the trend chart
    const now = Date.now();
    const trend = Array.from({ length: 12 }, (_, i) => {
      const start = now - (12 - i) * 3600e3;
      return fnds.filter((f) => {
        const t = new Date(f.createdAt).getTime();
        return t >= start && t < start + 3600e3;
      }).length;
    });

    return {
      demo: jbs.some((j) => j.isDemo) || tgs.length === 0,
      kpis: {
        reproduced: count("reproduced"),
        inconclusive: count("inconclusive"),
        notReproduced: count("not_reproduced"),
        activeJobs: active.length,
        jobsTotal: jbs.length,
        stops: jbs.filter((j) => j.state === "stopped").length,
        confirmed: det.filter((d) => d.tier === "confirmed").length,
        critical: sev("critical"),
        high: sev("high"),
      },
      agents: agentWall(active),
      targets: tgs.map((t) => ({ ...t, risk: risk(t) })).sort((a, b) => b.risk - a.risk),
      severity: {
        critical: sev("critical"), high: sev("high"),
        medium: sev("medium"), low: sev("low"), info: sev("info"),
      },
      states: { reproduced: count("reproduced"), inconclusive: count("inconclusive"), not_reproduced: count("not_reproduced") },
      trend,
      feed: evs.slice(0, 18),
      detection: det.slice(0, 8),
      jobs: jbs.slice(0, 10),
    };
  }),

  /* ── targets ───────────────────────────────────────────────────────── */
  targets: createRouter({
    list: authedQuery.query(({ ctx }) =>
      getDb().select().from(targets).where(eq(targets.userId, ctx.user.id)).orderBy(desc(targets.createdAt)),
    ),

    create: authedQuery
      .input(z.object({
        name: z.string().min(2).max(120),
        domain: z.string().min(4).max(255)
          .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Enter a bare domain, e.g. clinic.example.com"),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        const domain = input.domain.toLowerCase();
        const inRange = Boolean(RANGE[domain]);
        const token = "argus-verify=" + randomBytes(8).toString("hex");
        const [r] = await db.insert(targets).values({
          userId: ctx.user.id,
          name: input.name,
          domain,
          environment: inRange ? "range" : "production",
          verification: "pending",
          verifyMethod: "dns-txt",
          verifyToken: token,
          isCdn: RANGE[domain]?.isCdn ?? false,
          originVerified: RANGE[domain]?.originVerified ?? false,
          city: RANGE[domain]?.city ?? null,
          industry: RANGE[domain]?.industry ?? null,
        });
        await audit(ctx.user.id, "target.created", { domain, environment: inRange ? "range" : "production" });
        return { id: Number(r.insertId), token, environment: inRange ? "range" : "production" };
      }),

    confirmVerification: authedQuery
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        const [t] = await db.select().from(targets)
          .where(and(eq(targets.id, input.id), eq(targets.userId, ctx.user.id)));
        if (!t) throw new TRPCError({ code: "NOT_FOUND" });
        if (t.environment !== "range")
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Live targets require counsel review (Gate G4). This build verifies ARGUS Range demo targets only.",
          });
        // Demo: the Range "DNS" answers the TXT token. Production would re-query DNS here.
        await db.update(targets).set({ verification: "verified" }).where(eq(targets.id, t.id));
        await audit(ctx.user.id, "target.verified", { domain: t.domain, method: "dns-txt" });
        return { ok: true };
      }),

    lockScope: authedQuery
      .input(z.object({
        id: z.number(),
        maxRequests: z.number().int().min(50).max(2000).default(300),
        rps: z.number().int().min(1).max(20).default(5),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        const [t] = await db.select().from(targets)
          .where(and(eq(targets.id, input.id), eq(targets.userId, ctx.user.id)));
        if (!t) throw new TRPCError({ code: "NOT_FOUND" });
        if (t.scopeLocked) throw new TRPCError({ code: "CONFLICT", message: "Scope is already locked and immutable." });
        const scopeHash = sha256(JSON.stringify({
          v: 1, hosts: [t.domain], methods: ["GET", "HEAD", "OPTIONS"],
          rps: input.rps, maxRequests: input.maxRequests, ports: t.isCdn ? [443] : "top-20",
        }));
        await db.update(targets).set({ scopeLocked: true, scopeHash }).where(eq(targets.id, t.id));
        await audit(ctx.user.id, "scope.locked", { domain: t.domain, scopeHash, ...input });
        return { scopeHash };
      }),

    remove: authedQuery
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        await db.delete(targets).where(and(eq(targets.id, input.id), eq(targets.userId, ctx.user.id)));
        await audit(ctx.user.id, "target.removed", { id: input.id });
        return { ok: true };
      }),
  }),

  /* ── jobs ──────────────────────────────────────────────────────────── */
  jobs: createRouter({
    list: authedQuery.query(({ ctx }) =>
      getDb().select().from(jobs).where(eq(jobs.userId, ctx.user.id)).orderBy(desc(jobs.createdAt)).limit(50),
    ),

    get: authedQuery
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const db = getDb();
        const [job] = await db.select().from(jobs)
          .where(and(eq(jobs.id, input.id), eq(jobs.userId, ctx.user.id)));
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        const [target] = await db.select().from(targets).where(eq(targets.id, job.targetId));
        const evs = await db.select().from(jobEvents)
          .where(eq(jobEvents.jobId, job.id)).orderBy(jobEvents.id);
        const det = await db.select().from(detectionEvents)
          .where(eq(detectionEvents.jobId, job.id)).orderBy(detectionEvents.id);
        const fnds = await db.select().from(findings).where(eq(findings.jobId, job.id));
        const [report] = await db.select().from(reports).where(eq(reports.jobId, job.id));
        return { job, target, events: evs, detection: det, findings: fnds, report: report ?? null };
      }),

    create: authedQuery
      .input(z.object({ targetId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        const [t] = await db.select().from(targets)
          .where(and(eq(targets.id, input.targetId), eq(targets.userId, ctx.user.id)));
        if (!t) throw new TRPCError({ code: "NOT_FOUND" });
        // Authorization gate (Part 4.1) — re-checked server-side on every job creation.
        if (t.environment !== "range")
          throw new TRPCError({ code: "FORBIDDEN", message: "Gate G4: live targets need counsel approval. Demo scans run on the ARGUS Range only." });
        if (t.verification !== "verified")
          throw new TRPCError({ code: "FORBIDDEN", message: "Ownership not verified — no job may leave the gate." });
        if (!t.scopeLocked)
          throw new TRPCError({ code: "FORBIDDEN", message: "Scope is not locked — lock scope and sign authorization first." });
        startEngine();
        const [r] = await db.insert(jobs).values({
          userId: ctx.user.id, targetId: t.id, state: "queued", progress: 0,
          isDemo: t.environment === "range",
        });
        await audit(ctx.user.id, "job.created", { jobId: Number(r.insertId), target: t.domain });
        return { id: Number(r.insertId) };
      }),

    stop: authedQuery
      .input(z.object({ id: z.number(), reason: z.string().max(200).optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        const [job] = await db.select().from(jobs)
          .where(and(eq(jobs.id, input.id), eq(jobs.userId, ctx.user.id)));
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        await stopJob(job.id, input.reason ?? "manual stop from live monitor", "user");
        await audit(ctx.user.id, "job.stopped", { jobId: job.id });
        return { ok: true };
      }),
  }),

  /* ── findings ──────────────────────────────────────────────────────── */
  findings: createRouter({
    list: authedQuery
      .input(z.object({
        state: z.enum(["reproduced", "not_reproduced", "inconclusive"]).optional(),
        severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        const db = getDb();
        const rows = await db.select().from(findings)
          .where(eq(findings.userId, ctx.user.id)).orderBy(desc(findings.createdAt)).limit(300);
        return rows.filter((r) =>
          (!input?.state || r.state === input.state) &&
          (!input?.severity || r.severity === input.severity));
      }),

    patchLifecycle: authedQuery
      .input(z.object({
        id: z.number(),
        lifecycle: z.enum(["open", "acknowledged", "fix_claimed", "verified_fixed", "still_open"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        const [f] = await db.select().from(findings)
          .where(and(eq(findings.id, input.id), eq(findings.userId, ctx.user.id)));
        if (!f) throw new TRPCError({ code: "NOT_FOUND" });
        await db.update(findings).set({ lifecycle: input.lifecycle }).where(eq(findings.id, f.id));
        await audit(ctx.user.id, "finding.lifecycle", { id: f.id, from: f.lifecycle, to: input.lifecycle });
        return { ok: true };
      }),
  }),

  /* ── reports ───────────────────────────────────────────────────────── */
  reports: createRouter({
    list: authedQuery.query(async ({ ctx }) => {
      const db = getDb();
      const jbs = await db.select().from(jobs).where(eq(jobs.userId, ctx.user.id));
      const ids = jbs.map((j) => j.id);
      if (!ids.length) return [];
      const reps = await db.select().from(reports).where(inArray(reports.jobId, ids)).orderBy(desc(reports.createdAt));
      return reps.map((r) => ({ ...r, job: jbs.find((j) => j.id === r.jobId) }));
    }),

    get: authedQuery
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const db = getDb();
        const [rep] = await db.select().from(reports).where(eq(reports.id, input.id));
        if (!rep) throw new TRPCError({ code: "NOT_FOUND" });
        const [job] = await db.select().from(jobs)
          .where(and(eq(jobs.id, rep.jobId), eq(jobs.userId, ctx.user.id)));
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        const [target] = await db.select().from(targets).where(eq(targets.id, job.targetId));
        const fnds = await db.select().from(findings).where(eq(findings.jobId, job.id));
        const det = await db.select().from(detectionEvents).where(eq(detectionEvents.jobId, job.id));
        const stops = await db.select().from(jobEvents)
          .where(and(eq(jobEvents.jobId, job.id), eq(jobEvents.kind, "stop")));
        // Verify the manifest hash offline-style: recompute from stored summary.
        const recomputed = sha256(JSON.stringify({
          jobId: job.id, ruleset: job.rulesetVersion, summary: JSON.parse(rep.summaryJson),
        }));
        return {
          report: rep, job, target, findings: fnds, detection: det, stops,
          verified: recomputed === rep.manifestHash,
        };
      }),
  }),
});

function jobIdsEmpty(ids: number[]) {
  return ids.length === 0;
}

function agentWall(active: (typeof jobs.$inferSelect)[]) {
  const anyActive = active.length > 0;
  const st = (s: string) => active.some((j) => j.state === s);
  const mk = (
    agent: string, role: string, on: boolean, detail: string, idle: string,
  ) => ({ agent, role, status: on ? "active" : anyActive ? "watching" : "idle", detail: on ? detail : idle });
  return [
    mk("Scout", "Collection", st("scouting"), "Crawling in-scope hosts through the egress proxy.", "Standby — collects observations only."),
    mk("Hacker", "Adjudication", st("adjudicating"), "Deterministic detectors adjudicating stored observations.", "Standby — pure functions, zero LLM (S2)."),
    mk("Watcher", "Oversight", anyActive, "Monitoring thresholds; kill switch armed.", "Monitoring metrics; kill switch armed."),
    mk("Reporter", "Reporting", st("reporting"), "Composing evidence-first report + Proof Packet.", "Standby — template-only mode (LLM_PROVIDER=none)."),
  ];
}
