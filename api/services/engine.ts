/**
 * ARGUS job engine — the orchestrator loop (Master Build Doc, Part 14 M3–M7).
 *
 * In this demo build every job runs against the ARGUS Range: the engine plays
 * back scripted observations instead of touching a network, but the mechanics
 * are real and enforce the same contract as production:
 *
 *  - state machine  queued → scouting → adjudicating → reporting → completed
 *                   (stopped / failed at any point; illegal transitions rejected)
 *  - budgets        requests counted against maxRequests; exhaustion stops the job
 *  - kill switch    jobs.stop flips the state; the engine refuses to advance a
 *                   stopped job — the stop event lands in the report
 *  - three states   findings are created with deterministic adjudication states
 *  - watcher        emits threshold/signal events independent of the "hacker"
 *  - proof packet   on completion, a manifest hash chain (SHA-256) + HMAC
 *                   platform signature is stored with the report
 *
 * CDN rule (S5): CDN-fronted targets are scanned Host/SNI-pinned HTTPS only —
 * the engine logs the port-scan skip instead of running it.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { detectionEvents, findings, jobEvents, jobs, targets } from "../../db/schema";
import { RANGE, SCANNER_UA } from "./range";
import { buildReportForJob } from "./report";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const fingerprint = (detector: string, host: string, endpoint: string) =>
  sha256(`${detector}|${host}|${endpoint.toLowerCase()}`);

const ACTIVE = ["queued", "scouting", "adjudicating", "reporting"] as const;

/** progress % boundaries of the state machine */
const PHASES = [
  { until: 5, state: "queued" },
  { until: 55, state: "scouting" },
  { until: 80, state: "adjudicating" },
  { until: 96, state: "reporting"},
  { until: 101, state: "completed" },
] as const;

function phaseOf(progress: number): (typeof PHASES)[number]["state"] {
  for (const p of PHASES) if (progress < p.until) return p.state;
  return "completed";
}

let started = false;
/** per-job milestone memory: which scripted steps already landed in the DB */
const emitted = new Map<number, Set<string>>();

async function emit(
  jobId: number,
  agent: "scout" | "hacker" | "watcher" | "reporter" | "proxy" | "system",
  kind: "info" | "metric" | "threshold" | "stop" | "signal",
  message: string,
  key?: string,
) {
  const k = key ?? `${agent}:${message}`;
  let set = emitted.get(jobId);
  if (!set) emitted.set(jobId, (set = new Set()));
  if (set.has(k)) return;
  set.add(k);
  await getDb().insert(jobEvents).values({ jobId, agent, kind, message });
}

export async function stopJob(
  jobId: number,
  reason: string,
  by: "user" | "watcher" | "proxy" | "budget",
) {
  const db = getDb();
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job || !ACTIVE.includes(job.state as (typeof ACTIVE)[number])) return;
  await emit(jobId, "watcher", "stop",
    `KILL SWITCH engaged by ${by} — proxy revoked the job token; all further requests refused (<1s). Reason: ${reason}.`,
    `stop:${reason}`);
  await db
    .update(jobs)
    .set({ state: "stopped", stopReason: `${by}: ${reason}`, finishedAt: new Date() })
    .where(eq(jobs.id, jobId));
  emitted.delete(jobId);
}

async function tickJob(job: typeof jobs.$inferSelect) {
  const db = getDb();
  const [target] = await db.select().from(targets).where(eq(targets.id, job.targetId));
  if (!target) return stopJob(job.id, "target removed", "watcher");
  const script = RANGE[target.domain];

  // Budget enforcement (Part 4.6): exhausted budget stops the run at the proxy.
  if (job.requests >= job.maxRequests && job.state !== "reporting") {
    return stopJob(job.id, `request budget exhausted (${job.maxRequests})`, "budget");
  }

  const progress = Math.min(100, job.progress + 4);
  const nextState = phaseOf(progress);
  const prevState = job.state;

  /* ── state-entry effects ─────────────────────────────────────────────── */
  if (prevState !== nextState) {
    if (nextState === "scouting") {
      await emit(job.id, "system", "info",
        `Authorization gate passed: ownership verified, scope hash ${target.scopeHash?.slice(0, 12)}… locked, budgets pinned.`);
      await emit(job.id, "proxy", "info",
        `Egress proxy armed: allowlist ${target.domain} only · methods GET/HEAD/OPTIONS · ${job.rps} rps · budget ${job.maxRequests} req · UA "${SCANNER_UA}".`);
      if (target.isCdn)
        await emit(job.id, "proxy", "info",
          "CDN/shared-IP rule (S5): target fronts a CDN — Host/SNI-pinned HTTPS only, port scan skipped. Third-party infrastructure is never probed.");
    }
    if (nextState === "adjudicating") {
      await emit(job.id, "hacker", "info",
        "Collection complete. Detectors adjudicating stored observations offline — zero LLM in the loop (S2).");
      if (script) {
        for (const f of script.findings) {
          await db.insert(findings).values({
            userId: job.userId,
            jobId: job.id,
            targetId: job.targetId,
            detectorId: f.detectorId,
            title: f.title,
            severity: f.severity,
            state: f.state,
            fingerprint: fingerprint(f.detectorId, target.domain, f.endpoint),
            endpoint: f.endpoint,
            summary: f.summary,
            evidence: f.evidence,
          });
        }
        await emit(job.id, "hacker", "info",
          `${script.findings.length} findings adjudicated: ` +
          `${script.findings.filter((f) => f.state === "reproduced").length} reproduced · ` +
          `${script.findings.filter((f) => f.state === "inconclusive").length} inconclusive · ` +
          `${script.findings.filter((f) => f.state === "not_reproduced").length} not reproduced.`);
      }
    }
    if (nextState === "reporting") {
      await emit(job.id, "reporter", "info",
        "Composing report (template-only, LLM_PROVIDER=none): tested / not tested / inconclusive / detection tier / stop events / disclaimer.");
      if (script) {
        if (script.connector === "cloudflare") {
          await db.insert(detectionEvents).values({
            jobId: job.id, tier: "confirmed", source: "cloudflare",
            message:
              "Cloudflare connector (read-only) matched 41 firewall events to our scanner UA + published IP in the test window — your defenses logged this test.",
          });
          await emit(job.id, "watcher", "signal",
            "Detection tier: CONFIRMED — matched the customer's own Cloudflare firewall log lines (S7).");
        } else if (script.wafReacts) {
          await db.insert(detectionEvents).values({
            jobId: job.id, tier: "external", source: "external-signals",
            message:
              "403/challenge pages and a latency spike appeared mid-run vs Scout baseline — defenses appeared to react. No connector installed, so this cannot be confirmed.",
          });
          await emit(job.id, "watcher", "signal",
            "Detection tier: EXTERNAL SIGNALS only — reaction observed, not confirmed against customer logs.");
        } else {
          await db.insert(detectionEvents).values({
            jobId: job.id, tier: "not_observable", source: "none",
            message:
              "No detection connector and no external signals: whether defenses noticed this test is not observable. Reported as-is — never fabricated.",
          });
          await emit(job.id, "watcher", "signal",
            "Detection tier: NOT OBSERVABLE — the report says exactly that.");
        }
      }
    }
    if (nextState === "completed") {
      await buildReportForJob(job.id);
      await emit(job.id, "reporter", "info",
        "Proof Packet sealed: manifest SHA-256 hash chain + platform signature attached to the report (S8).");
    }
  }

  /* ── in-phase telemetry ──────────────────────────────────────────────── */
  let requests = job.requests;
  if (nextState === "scouting") {
    requests += job.rps;
    const steps: [number, string][] = [
      [10, `DNS pinned at job creation (rebinding → stop). Crawling /, /robots.txt, /sitemap.xml…`],
      [22, "TLS handshake matrix complete; certificate chain inspected."],
      [34, script?.isCdn
        ? "Subdomain enumeration via passive CT logs: 3 hosts in scope, deduped."
        : "Port check on verified origin IP (top-20, ≤2 pps) — permitted by S5."],
      [46, "Tech fingerprinting: headers, meta, JS libraries (version confidence tagged)."],
    ];
    for (const [at, msg] of steps)
      if (progress >= at) await emit(job.id, "scout", "info", msg);
    if (script?.wafReacts && progress >= 30)
      await emit(job.id, "watcher", "threshold",
        "Watcher: error rate ×4 baseline and 403 challenge page observed — inside stop thresholds, run continues under observation.");
    if (progress % 12 === 1 || progress === 10)
      await emit(job.id, "proxy", "metric",
        `egress ${requests}/${job.maxRequests} req · 0 policy violations`, `metric:${progress}`);
  }
  if (nextState === "adjudicating" && progress % 12 === 3)
    await emit(job.id, "hacker", "metric",
      `adjudicating detectors over stored observations… ${progress - 55 + 20}%`, `adj:${progress}`);

  // Conditional write: only advance if the state is still what we read — a kill
  // switch that landed mid-tick must never be overwritten back to life.
  const res = await db
    .update(jobs)
    .set({
      progress: nextState === "completed" ? 100 : progress,
      requests,
      state: nextState,
      startedAt: job.startedAt ?? new Date(),
      finishedAt: nextState === "completed" ? new Date() : null,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.state, job.state)));
  const affected = Number((res as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 1);
  if (nextState === "completed" && affected > 0) emitted.delete(job.id);
}

async function tick() {
  try {
    const db = getDb();
    const active = await db
      .select()
      .from(jobs)
      .where(inArray(jobs.state, [...ACTIVE]));
    for (const job of active) await tickJob(job);
  } catch (e) {
    console.error("[engine] tick failed", e);
  }
}

export function startEngine() {
  if (started) return;
  started = true;
  setInterval(tick, 1000);
}
