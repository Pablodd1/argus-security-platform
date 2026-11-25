import { useState } from "react";
import { useNavigate } from "react-router";
import Shell from "@/components/Shell";
import { trpc } from "@/providers/trpc";

export default function Targets() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const list = trpc.argus.targets.list.useQuery(undefined, { refetchInterval: 5000 });

  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const [tokenFor, setTokenFor] = useState<{ id: number; token: string; env: string } | null>(null);

  const refresh = () => utils.argus.targets.list.invalidate();

  const create = trpc.argus.targets.create.useMutation({
    onSuccess: (r) => {
      setName(""); setDomain("");
      setTokenFor({ id: r.id, token: r.token, env: r.environment });
      setMsg(r.environment === "range"
        ? { kind: "ok", text: "Target added to the ARGUS Range. Publish the DNS TXT record, then confirm verification." }
        : { kind: "err", text: "Added as a production target — scanning stays blocked until counsel clears Gate G4. Demo scans run on Range targets only." });
      refresh();
    },
    onError: (e) => setMsg({ kind: "err", text: e.message }),
  });

  const verify = trpc.argus.targets.confirmVerification.useMutation({
    onSuccess: () => { setMsg({ kind: "ok", text: "Ownership verified via DNS TXT." }); setTokenFor(null); refresh(); },
    onError: (e) => setMsg({ kind: "err", text: e.message }),
  });

  const lock = trpc.argus.targets.lockScope.useMutation({
    onSuccess: (r) => { setMsg({ kind: "ok", text: "Scope locked and signed. Hash: " + r.scopeHash.slice(0, 16) + "…" }); refresh(); },
    onError: (e) => setMsg({ kind: "err", text: e.message }),
  });

  const run = trpc.argus.jobs.create.useMutation({
    onSuccess: () => navigate("/jobs"),
    onError: (e) => setMsg({ kind: "err", text: e.message }),
  });

  const remove = trpc.argus.targets.remove.useMutation({ onSuccess: refresh });

  return (
    <Shell title="Targets — inventory, verification, scope lock">
      <div className="panel">
        <h2>Add target<span className="r">ownership verification is mandatory before any run</span></h2>
        <div className="panel-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <form
            className="form-row"
            onSubmit={(e) => {
              e.preventDefault();
              setMsg(null);
              create.mutate({ name, domain });
            }}
          >
            <div className="field">
              <label htmlFor="tname">Display name</label>
              <input id="tname" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. ClinicMock — demo clinic" required minLength={2} />
            </div>
            <div className="field">
              <label htmlFor="tdomain">Domain</label>
              <input id="tdomain" value={domain} onChange={(e) => setDomain(e.target.value)}
                placeholder="clinicmock.range.aidynamic.pro" required />
            </div>
            <button className="btn primary" type="submit" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add target"}
            </button>
          </form>
          <p className="small faint">
            Demo Range domains: clinicmock / lexpartners / harborhvac .range.aidynamic.pro
          </p>
          {msg && <p className={"form-msg " + msg.kind}>{msg.text}</p>}
        </div>
      </div>

      {tokenFor && (
        <div className="panel" style={{ borderColor: "color-mix(in srgb, var(--warn) 45%, transparent)" }}>
          <h2>Verification pending<span className="r">DNS TXT method</span></h2>
          <div className="panel-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p className="small muted">Publish this TXT record on the domain, then confirm:</p>
            <div className="hashbox">{tokenFor.token}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn primary" type="button"
                disabled={verify.isPending}
                onClick={() => verify.mutate({ id: tokenFor.id })}>
                {verify.isPending ? "Checking DNS…" : "Confirm verification"}
              </button>
              <button className="btn ghost" type="button" onClick={() => setTokenFor(null)}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Inventory<span className="r">{list.data?.length ?? 0} targets</span></h2>
        <div className="tblwrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Target</th><th>Environment</th><th>Ownership</th><th>CDN / Origin</th>
                <th>Scope</th><th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).map((t) => (
                <tr key={t.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                    <div className="small faint mono">{t.domain}</div>
                  </td>
                  <td><span className={"tag " + (t.environment === "range" ? "info" : "medium")}>{t.environment}</span></td>
                  <td><span className={"tag " + t.verification}>{t.verification}</span></td>
                  <td className="small muted">
                    {t.isCdn ? "CDN-fronted · SNI-pinned only" : t.originVerified ? "origin verified · ports in scope" : "—"}
                  </td>
                  <td>
                    {t.scopeLocked
                      ? <span className="small mono" title={t.scopeHash ?? ""}>locked · {(t.scopeHash ?? "").slice(0, 10)}…</span>
                      : <span className="tag pending">unlocked</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {t.verification !== "verified" && (
                        <button className="btn sm" type="button"
                          onClick={() => setTokenFor({ id: t.id, token: t.verifyToken ?? "", env: t.environment })}>
                          Verify
                        </button>
                      )}
                      {t.verification === "verified" && !t.scopeLocked && (
                        <button className="btn sm" type="button" onClick={() => lock.mutate({ id: t.id, maxRequests: 300, rps: 5 })}>
                          Lock scope
                        </button>
                      )}
                      <button className="btn sm primary" type="button"
                        disabled={run.isPending}
                        onClick={() => run.mutate({ targetId: t.id })}>
                        Run scan
                      </button>
                      <button className="btn sm ghost" type="button"
                        onClick={() => { if (confirm(`Remove ${t.domain}?`)) remove.mutate({ id: t.id }); }}>
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {list.data?.length === 0 && (
                <tr><td colSpan={6}><div className="empty">No targets yet — add one above.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="small faint" style={{ maxWidth: 720 }}>
        Gate order is enforced server-side: no run starts without verified ownership, a locked scope hash,
        and an authorization record. CDN-fronted targets are scanned Host/SNI-pinned HTTPS only — port
        scans run solely against verified origin IPs (rule S5).
      </p>
    </Shell>
  );
}
