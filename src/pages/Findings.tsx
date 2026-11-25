import { useState } from "react";
import { useNavigate } from "react-router";
import Shell from "@/components/Shell";
import { trpc } from "@/providers/trpc";

const STATES = ["reproduced", "inconclusive", "not_reproduced"] as const;
const SEVS = ["critical", "high", "medium", "low", "info"] as const;

export default function Findings() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [state, setState] = useState<string | null>(null);
  const [sev, setSev] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const list = trpc.argus.findings.list.useQuery(
    {
      ...(state ? { state: state as (typeof STATES)[number] } : {}),
      ...(sev ? { severity: sev as (typeof SEVS)[number] } : {}),
    },
    { refetchInterval: 6000 },
  );
  const rows = list.data ?? [];
  const open = rows.find((r) => r.id === openId) ?? null;

  const patch = trpc.argus.findings.patchLifecycle.useMutation({
    onSuccess: () => utils.argus.findings.list.invalidate(),
  });
  const retest = trpc.argus.jobs.create.useMutation({
    onSuccess: () => navigate("/jobs"),
    onError: (e) => alert(e.message),
  });

  return (
    <Shell title="Findings — three-state evidence, owner lifecycle">
      <div className="chips">
        <button className={"chip" + (!state ? " on" : "")} onClick={() => setState(null)}>All states</button>
        {STATES.map((s) => (
          <button key={s} className={"chip" + (state === s ? " on" : "")} onClick={() => setState(state === s ? null : s)}>
            {s.replace("_", " ")}
          </button>
        ))}
        <span style={{ width: 12 }} />
        <button className={"chip" + (!sev ? " on" : "")} onClick={() => setSev(null)}>All severities</button>
        {SEVS.map((s) => (
          <button key={s} className={"chip" + (sev === s ? " on" : "")} onClick={() => setSev(sev === s ? null : s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="panel">
        <h2>{rows.length} findings<span className="r">HTTP 200 alone is never evidence — every row carries detector + fingerprint + stored evidence</span></h2>
        <div>
          {rows.map((f) => (
            <div className="fcard" key={f.id} onClick={() => setOpenId(f.id)} role="button" tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setOpenId(f.id)}>
              <div className="top">
                <span className={"tag " + f.severity}>{f.severity}</span>
                <span className={"tag " + f.state}>{f.state.replace("_", " ")}</span>
                <span className="title">{f.title}</span>
                <span className={"tag " + f.lifecycle} style={{ marginLeft: "auto" }}>{f.lifecycle.replace("_", " ")}</span>
              </div>
              <div className="sum">{f.summary}</div>
              <div className="meta">
                <span>{f.detectorId}</span><span>{f.endpoint}</span>
                <span>job #{f.jobId}</span><span>fp {f.fingerprint.slice(0, 12)}…</span>
              </div>
            </div>
          ))}
          {rows.length === 0 && <div className="empty">No findings match these filters.</div>}
        </div>
      </div>

      {open && (
        <>
          <div className="modal-veil" onClick={() => setOpenId(null)} />
          <aside className="drawer" role="dialog" aria-label={open.title}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className={"tag " + open.severity}>{open.severity}</span>
                  <span className={"tag " + open.state}>{open.state.replace("_", " ")}</span>
                  <span className={"tag " + open.lifecycle}>{open.lifecycle.replace("_", " ")}</span>
                </div>
                <h2 style={{ fontSize: 17 }}>{open.title}</h2>
              </div>
              <button className="btn sm ghost" onClick={() => setOpenId(null)} aria-label="Close">✕</button>
            </div>

            <p className="small muted" style={{ lineHeight: 1.7 }}>{open.summary}</p>

            <div>
              <h3 className="eyebrow" style={{ marginBottom: 8 }}>Evidence (redacted, hash-chained)</h3>
              <div className="evidence">{open.evidence}</div>
            </div>

            <div className="meta small faint mono" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <span>detector {open.detectorId}</span>
              <span>endpoint {open.endpoint}</span>
              <span>fingerprint {open.fingerprint.slice(0, 20)}…</span>
            </div>

            <div>
              <h3 className="eyebrow" style={{ marginBottom: 8 }}>Lifecycle</h3>
              <div className="lifecycle">
                {open.lifecycle === "open" && (
                  <button className="btn sm" onClick={() => patch.mutate({ id: open.id, lifecycle: "acknowledged" })}>
                    Acknowledge
                  </button>
                )}
                {(open.lifecycle === "open" || open.lifecycle === "acknowledged" || open.lifecycle === "still_open") && (
                  <button className="btn sm" onClick={() => patch.mutate({ id: open.id, lifecycle: "fix_claimed" })}>
                    Claim fix
                  </button>
                )}
                {open.lifecycle === "fix_claimed" && (
                  <button
                    className="btn sm primary"
                    disabled={retest.isPending}
                    onClick={() => retest.mutate({ targetId: open.targetId })}
                  >
                    {retest.isPending ? "Queueing re-test…" : "Re-test now"}
                  </button>
                )}
                {(open.lifecycle === "fix_claimed" || open.lifecycle === "open") && (
                  <button className="btn sm" onClick={() => patch.mutate({ id: open.id, lifecycle: "verified_fixed" })}>
                    Mark verified fixed
                  </button>
                )}
                {open.lifecycle !== "still_open" && open.lifecycle !== "verified_fixed" && (
                  <button className="btn sm ghost" onClick={() => patch.mutate({ id: open.id, lifecycle: "still_open" })}>
                    Still open
                  </button>
                )}
              </div>
              <p className="small faint" style={{ marginTop: 10 }}>
                Lifecycle: open → acknowledged → fix_claimed → verified_fixed / still_open.
                A re-test re-runs the same detector over fresh observations and diffs by fingerprint.
              </p>
            </div>
          </aside>
        </>
      )}
    </Shell>
  );
}
