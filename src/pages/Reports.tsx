import { useState } from "react";
import Shell from "@/components/Shell";
import { trpc } from "@/providers/trpc";
import Kit from "@/lib/kit.js";

export default function Reports() {
  const list = trpc.argus.reports.list.useQuery(undefined, { refetchInterval: 8000 });
  const [sel, setSel] = useState<number | null>(null);
  const reps = list.data ?? [];
  const selId = sel ?? reps[0]?.id ?? null;

  const detail = trpc.argus.reports.get.useQuery(
    { id: selId ?? 0 },
    { enabled: selId != null },
  );
  const d = detail.data;
  const summary = d ? (JSON.parse(d.report.summaryJson) as {
    tested: string[]; reproduced: string[]; notReproduced: string[]; inconclusive: string[];
    notTested: string[]; detectionTier: string; stopEvents: string[];
    chain: { finding: string; fingerprint: string; hash: string }[];
    disclaimer: string;
  }) : null;

  const downloadPacket = () => {
    if (!d) return;
    const packet = {
      product: "ARGUS Proof Packet",
      job: d.job.id,
      target: d.target?.domain,
      ruleset: d.report.rulesetVersion,
      manifestHash: d.report.manifestHash,
      signature: d.report.signature,
      signatureScheme: "HMAC-SHA256 (demo build; Ed25519 in production)",
      summary,
      verifiedByServer: d.verified,
    };
    Kit.download(`argus-proof-packet-job-${d.job.id}.json`, JSON.stringify(packet, null, 2), "application/json");
  };

  return (
    <Shell title="Reports — evidence-first, sealed with a Proof Packet">
      <div className="repgrid">
        <div className="panel">
          <h2>Reports<span className="r">{reps.length}</span></h2>
          <div className="joblist">
            {reps.map((r) => (
              <div key={r.id}
                className={"jobitem" + (r.id === selId ? " sel" : "")}
                onClick={() => setSel(r.id)} role="button" tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSel(r.id)}>
                <div className="row">
                  <span className="mono small">report #{r.id} · job #{r.jobId}</span>
                  <span className="tag confirmed">ruleset {r.rulesetVersion}</span>
                </div>
                <div className="small faint">{new Date(r.createdAt).toLocaleString()}</div>
              </div>
            ))}
            {reps.length === 0 && (
              <div className="empty">No reports yet — a report is sealed when a run completes.</div>
            )}
          </div>
        </div>

        <div className="panel" style={{ minWidth: 0 }}>
          {d && summary ? (
            <>
              <h2>
                Job #{d.job.id} · {d.target?.domain}
                <span className="r">
                  <button className="btn sm primary" onClick={downloadPacket}>Download Proof Packet</button>
                </span>
              </h2>

              <div className="repsection">
                <h3>Outcome</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="tag reproduced">{summary.reproduced.length} reproduced</span>
                  <span className="tag inconclusive">{summary.inconclusive.length} inconclusive</span>
                  <span className="tag not_reproduced">{summary.notReproduced.length} not reproduced</span>
                  <span className={"tag " + summary.detectionTier}>detection: {summary.detectionTier.replace("_", " ")}</span>
                </div>
              </div>

              <div className="repsection">
                <h3>Tested ({summary.tested.length} detectors)</h3>
                <p className="small muted mono">{summary.tested.join(" · ") || "—"}</p>
              </div>

              <div className="repsection">
                <h3>Not tested (out of v0 scope — stated, never hidden)</h3>
                <p className="small muted">{summary.notTested.join(" · ")}</p>
              </div>

              {summary.inconclusive.length > 0 && (
                <div className="repsection">
                  <h3>Inconclusive — needs human judgement</h3>
                  <div>
                    {d.findings.filter((f) => f.state === "inconclusive").map((f) => (
                      <div className="feeditem" key={f.id}>
                        <span className={"tag " + f.severity}>{f.severity}</span>
                        <span><b>{f.detectorId}</b> — {f.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="repsection">
                <h3>Detection timeline ({d.detection.length})</h3>
                {d.detection.map((e) => (
                  <div className="feeditem signal" key={e.id}>
                    <span className={"tag " + e.tier}>{e.tier.replace("_", " ")}</span>
                    <span>{e.message}</span>
                  </div>
                ))}
                {d.detection.length === 0 && <p className="small muted">No detection events recorded.</p>}
              </div>

              <div className="repsection">
                <h3>Stop events</h3>
                {summary.stopEvents.length
                  ? summary.stopEvents.map((s, i) => <p className="small muted" key={i}>{s}</p>)
                  : <p className="small muted">None — the run finished within all budgets and thresholds.</p>}
              </div>

              <div className="repsection">
                <h3>Proof Packet · evidence integrity</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="hashbox">
                    manifest sha256: {d.report.manifestHash}<br />
                    signature: {d.report.signature}<br />
                    hash-chain entries: {summary.chain.length} · ruleset {d.report.rulesetVersion}
                  </div>
                  <div>
                    {d.verified
                      ? <span className="tag verified">✓ manifest hash re-computed server-side — packet intact</span>
                      : <span className="tag unverified">✗ hash mismatch — do not trust this packet</span>}
                  </div>
                  <p className="small faint">
                    Demo build signs with HMAC-SHA256 under the platform key; production swaps in an
                    Ed25519 keypair so packets verify offline against a published public key (S8).
                  </p>
                </div>
              </div>

              <div className="repsection">
                <div className="disclaimer">{summary.disclaimer}</div>
              </div>
            </>
          ) : (
            <div className="empty" style={{ padding: 60 }}>
              {detail.isLoading ? "Loading report…" : "Select a report on the left."}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
