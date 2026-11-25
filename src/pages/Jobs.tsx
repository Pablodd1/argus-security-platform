import { useEffect, useState } from "react";
import { Link } from "react-router";
import Shell from "@/components/Shell";
import { trpc } from "@/providers/trpc";

const PHASES = ["queued", "scouting", "adjudicating", "reporting", "completed"] as const;
const ACTIVE = ["queued", "scouting", "adjudicating", "reporting"];

export default function Jobs() {
  const utils = trpc.useUtils();
  const list = trpc.argus.jobs.list.useQuery(undefined, { refetchInterval: 3000 });
  const [sel, setSel] = useState<number | null>(null);

  const jobs = list.data ?? [];
  const selId = sel ?? jobs.find((j) => ACTIVE.includes(j.state))?.id ?? jobs[0]?.id ?? null;

  const detail = trpc.argus.jobs.get.useQuery(
    { id: selId ?? 0 },
    {
      enabled: selId != null,
      refetchInterval: (q) =>
        q.state.data && ACTIVE.includes(q.state.data.job.state) ? 1200 : 5000,
    },
  );

  const stop = trpc.argus.jobs.stop.useMutation({
    onSuccess: () => {
      utils.argus.jobs.get.invalidate();
      utils.argus.jobs.list.invalidate();
      utils.argus.summary.invalidate();
    },
  });

  // Follow the newest active job automatically.
  useEffect(() => {
    if (sel == null && jobs.length) setSel(jobs[0].id);
  }, [jobs, sel]);

  const d = detail.data;
  const job = d?.job;
  const isActive = job ? ACTIVE.includes(job.state) : false;
  const phaseIdx = job ? Math.max(0, PHASES.indexOf(job.state as never)) : 0;

  return (
    <Shell title="Runs — live monitor & kill switch">
      <div className="jobgrid">
        <div className="panel">
          <h2>Job queue<span className="r">{jobs.length} runs</span></h2>
          <div className="joblist">
            {jobs.map((j) => (
              <div
                key={j.id}
                className={"jobitem" + (j.id === selId ? " sel" : "")}
                onClick={() => setSel(j.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSel(j.id)}
              >
                <div className="row">
                  <span className="mono small">#{j.id} · ruleset {j.rulesetVersion}</span>
                  <span className={"tag " + j.state}>{j.state}</span>
                </div>
                <div className="pbar"><div style={{ width: j.progress + "%" }} /></div>
                <div className="small faint">
                  {new Date(j.createdAt).toLocaleString()} · {j.requests}/{j.maxRequests} req
                  {j.stopReason ? ` · stopped: ${j.stopReason}` : ""}
                </div>
              </div>
            ))}
            {jobs.length === 0 && (
              <div className="empty">
                No runs yet. Verify a target and lock its scope on the{" "}
                <Link to="/targets" style={{ color: "var(--accent)" }}>Targets</Link> page.
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {job && (
            <>
              <div className="stopbar">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    Job #{job.id} · {d?.target?.domain}
                  </div>
                  <div className="small muted">
                    The kill switch is independent of the agents: stopping revokes the proxy token
                    and refuses all further requests — the stop event is written into the report.
                  </div>
                </div>
                <button
                  className="btn danger"
                  type="button"
                  disabled={!isActive || stop.isPending}
                  onClick={() => stop.mutate({ id: job.id })}
                >
                  {isActive ? (stop.isPending ? "Stopping…" : "■ STOP RUN") : "Run finished"}
                </button>
              </div>

              <div className="panel">
                <h2>State machine<span className="r">{job.progress}% · {job.requests}/{job.maxRequests} req budget</span></h2>
                <div className="panel-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="phases">
                    {PHASES.map((p, i) => {
                      const halted = job.state === "stopped" || job.state === "failed";
                      const cls = halted
                        ? (i <= phaseIdx ? (i === phaseIdx ? " halted" : " done") : "")
                        : (i < phaseIdx || p === job.state ? " done" : i === phaseIdx ? " cur" : "");
                      return (
                        <div key={p} className={"phase" + cls}>{p}</div>
                      );
                    })}
                  </div>
                  {(job.state === "stopped" || job.state === "failed") && (
                    <div className="tag stopped" style={{ alignSelf: "flex-start" }}>
                      {job.state} — {job.stopReason ?? "no reason recorded"}
                    </div>
                  )}
                  {d?.report && (
                    <Link className="btn primary" to="/reports" style={{ alignSelf: "flex-start" }}>
                      Open report & Proof Packet →
                    </Link>
                  )}
                </div>
              </div>

              <div className="panel">
                <h2>Agent & watcher feed<span className="r">{d?.events.length ?? 0} events</span></h2>
                <div className="feed">
                  {(d?.events ?? []).map((e) => (
                    <div key={e.id} className={"feeditem " + e.kind}>
                      <span className="tm">{new Date(e.createdAt).toTimeString().slice(0, 8)}</span>
                      <span className={"ag " + e.agent}>{e.agent}</span>
                      <span>{e.message}</span>
                    </div>
                  ))}
                  {(d?.events ?? []).length === 0 && <div className="empty">Waiting for the first event…</div>}
                </div>
              </div>

              <div className="panel">
                <h2>Detection timeline<span className="r">three honest tiers</span></h2>
                <div className="feed">
                  {(d?.detection ?? []).map((e) => (
                    <div key={e.id} className="feeditem signal">
                      <span className="tm">{new Date(e.createdAt).toTimeString().slice(0, 8)}</span>
                      <span className={"tag " + e.tier}>{e.tier.replace("_", " ")}</span>
                      <span>{e.message}</span>
                    </div>
                  ))}
                  {(d?.detection ?? []).length === 0 && (
                    <div className="empty">No detection events yet — they land when the run reaches the reporting phase.</div>
                  )}
                </div>
              </div>

              <div className="panel">
                <h2>Findings this run<span className="r">{d?.findings.length ?? 0}</span></h2>
                <div>
                  {(d?.findings ?? []).map((f) => (
                    <div className="fcard" key={f.id} onClick={() => {}} style={{ cursor: "default" }}>
                      <div className="top">
                        <span className={"tag " + f.severity}>{f.severity}</span>
                        <span className={"tag " + f.state}>{f.state.replace("_", " ")}</span>
                        <span className="title">{f.title}</span>
                      </div>
                      <div className="meta">
                        <span>{f.detectorId}</span><span>{f.endpoint}</span>
                        <span>fp {f.fingerprint.slice(0, 12)}…</span>
                      </div>
                    </div>
                  ))}
                  {(d?.findings ?? []).length === 0 && (
                    <div className="empty">Findings appear once adjudication starts.</div>
                  )}
                </div>
              </div>
            </>
          )}
          {!job && <div className="panel"><div className="empty">Select a run on the left.</div></div>}
        </div>
      </div>
    </Shell>
  );
}
