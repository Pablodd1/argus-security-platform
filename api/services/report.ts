/**
 * Proof Packet builder (Master Build Doc, Part 11 + S8).
 *
 * On job completion: gathers findings, detection events and stop events into a
 * manifest, chains every finding's evidence hash (each hash includes the
 * previous one), seals the manifest with SHA-256, and signs it.
 *
 * Demo build signs with HMAC-SHA256 under the platform secret; production swaps
 * in Ed25519 — the report and UI label this honestly.
 */
import { createHash, createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { detectionEvents, findings, jobEvents, jobs, reports } from "../../db/schema";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function buildReportForJob(jobId: number) {
  const db = getDb();
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return;

  const dup = await db.select().from(reports).where(eq(reports.jobId, jobId));
  if (dup.length) return;

  const rows = await db.select().from(findings).where(eq(findings.jobId, jobId));
  const det = await db.select().from(detectionEvents).where(eq(detectionEvents.jobId, jobId));
  const stops = await db
    .select()
    .from(jobEvents)
    .where(and(eq(jobEvents.jobId, jobId), eq(jobEvents.kind, "stop")));

  const by = (s: string) => rows.filter((r) => r.state === s);
  const tier = det.some((d) => d.tier === "confirmed")
    ? "confirmed"
    : det.some((d) => d.tier === "external")
      ? "external"
      : "not_observable";

  let prev = "0".repeat(64);
  const chain = rows.map((r) => {
    const h = sha256(prev + r.fingerprint + r.state + (r.evidence ?? ""));
    prev = h;
    return { finding: r.detectorId, fingerprint: r.fingerprint, hash: h };
  });

  const summary = {
    tested: rows.map((r) => r.detectorId),
    reproduced: by("reproduced").map((r) => r.detectorId),
    notReproduced: by("not_reproduced").map((r) => r.detectorId),
    inconclusive: by("inconclusive").map((r) => r.detectorId),
    notTested: ["IDOR/BOLA (v1)", "Authenticated tests (v1)", "Write methods (v1 opt-in)"],
    detectionTier: tier,
    stopEvents: stops.map((s) => s.message),
    chain,
    disclaimer:
      "ARGUS is an automated security check, not a manual penetration test or a compliance certification.",
  };
  const manifest = JSON.stringify({ jobId, ruleset: job.rulesetVersion, summary });
  const manifestHash = sha256(manifest);
  const signature = createHmac("sha256", process.env.APP_SECRET ?? "argus-demo-key")
    .update(manifestHash)
    .digest("hex");

  await db.insert(reports).values({
    jobId,
    manifestHash,
    signature,
    summaryJson: JSON.stringify(summary),
    rulesetVersion: job.rulesetVersion,
  });
}
