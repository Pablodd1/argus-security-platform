/**
 * ARGUS Command Wall — the big-screen cockpit.
 *
 * Same skeleton as the bigscreen-cockpit template (scaled 1920×1080 stage,
 * three columns around a 3D globe), re-pointed at the ARGUS API:
 *   left   — exposure ranking (targets → detectors → findings), evidence-state
 *            donut, severity bars
 *   center — KPI band, 3D globe (egress PoPs + targets, arcs = scan traffic),
 *            findings trend
 *   right  — active runs, agent wall (Scout/Hacker/Watcher/Reporter), live feed
 *
 * Every number comes from trpc.argus.summary / findings.list, polled live.
 * Under 900px the stage yields to a stacked mobile dashboard (console.css .mob).
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import * as echarts from "echarts";
import Kit from "@/lib/kit.js";
import { constellation, radar } from "@/lib/fx.js";
import * as geo from "@/lib/geo.js";
import { trpc } from "@/providers/trpc";
import { ThemeSlot, UserChip, useRequireAuth } from "@/components/Shell";

/* Range cities + scanner egress PoPs (S6: published scanner origins). */
Object.assign(geo.CITY, {
  Miami: [-80.19, 25.76],
  Seattle: [-122.33, 47.61],
  Ashburn: [-77.49, 39.04],
});
const EGRESS = ["Miami", "Frankfurt", "Singapore", "São Paulo"];

interface Earth {
  focus: (city: string) => void;
}

type Summary = NonNullable<ReturnType<typeof useSummary>["data"]>;
function useSummary(enabled: boolean) {
  return trpc.argus.summary.useQuery(undefined, {
    enabled,
    refetchInterval: 4000,
    retry: 1,
  });
}

/* One chart component: owns its echarts instance, follows the theme toggle. */
function Chart({ opt }: { opt: object }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const [, setTheme] = useState(0);
  useEffect(() => {
    Kit.onTheme(() => setTheme((t) => t + 1));
  }, []);
  useEffect(() => {
    if (!ref.current) return;
    inst.current = echarts.init(ref.current, null, { renderer: "canvas" });
    const onR = () => inst.current?.resize();
    addEventListener("resize", onR);
    return () => {
      removeEventListener("resize", onR);
      inst.current?.dispose();
    };
  }, []);
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inst.current?.setOption(Object.assign(Kit.base(), opt) as any, true);
    setTimeout(() => inst.current?.resize(), 0);
  });
  return <div className="chart" ref={ref} />;
}

const css = (n: string) => Kit.css(n);

function donutOpt(states: Summary["states"]) {
  return {
    animation: false,
    series: [
      {
        type: "pie",
        radius: ["46%", "68%"],
        center: ["50%", "52%"],
        itemStyle: { borderColor: css("panel"), borderWidth: 3 },
        color: [css("neg"), css("warn"), css("pos")],
        label: {
          color: css("ink"), fontSize: 13, formatter: "{b}\n{d}%", lineHeight: 17,
          alignTo: "edge", edgeDistance: 6,
        },
        labelLine: { length: 8, length2: 10, lineStyle: { color: css("line") } },
        data: [
          { name: "Reproduced", value: states.reproduced },
          { name: "Inconclusive", value: states.inconclusive },
          { name: "Not repro.", value: states.not_reproduced },
        ],
      },
    ],
  };
}

function sevOpt(sev: Summary["severity"]) {
  const rows = [
    ["critical", sev.critical], ["high", sev.high], ["medium", sev.medium],
    ["low", sev.low], ["info", sev.info],
  ] as const;
  return {
    animation: false,
    grid: { left: 12, right: 40, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "value", ...Kit.axis("value"), axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: {
      type: "category", data: rows.map((r) => r[0]).reverse(), ...Kit.axis("category"),
      splitLine: { show: false }, axisLabel: { color: css("ink"), fontSize: 12.5 },
    },
    series: [
      {
        type: "bar", barWidth: 12,
        data: rows.map((r) => r[1]).reverse(),
        itemStyle: {
          borderRadius: [0, 3, 3, 0],
          color: (p: { name: string }) =>
            p.name === "critical" ? css("neg") : p.name === "high" ? css("s6")
            : p.name === "medium" ? css("warn") : css("s1"),
        },
        label: { show: true, position: "right", color: css("muted"), fontSize: 13, fontFamily: "Geist Mono Variable" },
      },
    ],
  };
}

function trendOpt(trend: number[]) {
  const labels = trend.map((_, i) => {
    const d = new Date(Date.now() - (trend.length - 1 - i) * 3600e3);
    return d.getHours().toString().padStart(2, "0") + ":00";
  });
  const acc = css("s1");
  return {
    animation: false,
    grid: { left: 40, right: 16, top: 26, bottom: 24 },
    xAxis: { type: "category", data: labels, boundaryGap: false, ...Kit.axis("category"), splitLine: { show: false } },
    yAxis: { type: "value", minInterval: 1, ...Kit.axis("value") },
    series: [
      {
        name: "findings", type: "line", smooth: 0.3, symbol: "circle", symbolSize: 5,
        data: trend,
        lineStyle: { width: 2.5, color: acc, shadowColor: acc, shadowBlur: 10 },
        itemStyle: { color: acc },
        areaStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "color-mix(in srgb," + acc + " 40%,transparent)" },
              { offset: 1, color: "color-mix(in srgb," + acc + " 0%,transparent)" },
            ],
          },
        },
      },
    ],
  };
}

const STATE_ORDER = ["queued", "scouting", "adjudicating", "reporting", "completed"] as const;

export default function Cockpit() {
  const { user, isLoading } = useRequireAuth();
  const summary = useSummary(Boolean(user));
  const findingsQ = trpc.argus.findings.list.useQuery(undefined, {
    enabled: Boolean(user),
    refetchInterval: 6000,
  });

  const [level, setLevel] = useState(0);
  const [curTarget, setCurTarget] = useState<string | null>(null); // domain
  const [curDetector, setCurDetector] = useState<string | null>(null);
  const [pick, setPick] = useState<{ city: string; v: string | null } | null>(null);
  const [clock, setClock] = useState({ t: "", d: "" });
  const [tourIdx, setTourIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  const stage = useRef<HTMLDivElement>(null);
  const space = useRef<HTMLDivElement>(null);
  const earthHost = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const earth = useRef<Earth | null>(null);
  const idle = useRef(0);
  const isMobile = useRef(false);

  const data = summary.data;
  const findings = findingsQ.data ?? [];
  const ready = Boolean(user && data);
  const lastOk = summary.dataUpdatedAt || Date.now();
  const online = Date.now() - lastOk <= 12000;

  /* ── stage scaling + globe boot (desktop only) ─────────────────────────── */
  useEffect(() => {
    // The stage divs only exist once data is in — bail until then (the loading
    // branch above returns a bare spinner, and the refs would be null).
    if (!ready || !space.current || !stage.current) return;
    isMobile.current = matchMedia("(max-width: 899px)").matches;
    constellation(space.current, { count: 90, link: 118, speed: 0.05, alpha: 0.5 });

    const fit = () => {
      const mob = matchMedia("(max-width: 899px)").matches;
      isMobile.current = mob;
      if (mob || !stage.current) return;
      const k = Math.min(innerWidth / 1920, innerHeight / 1080);
      const W = Math.min(2560, Math.max(1920, innerWidth / k));
      const H = Math.min(1600, Math.max(1080, innerHeight / k));
      const st = stage.current;
      st.style.width = W + "px";
      st.style.height = H + "px";
      st.style.transform =
        `translate(${(innerWidth - W * k) / 2}px, ${(innerHeight - H * k) / 2}px) scale(${k})`;
    };
    addEventListener("resize", fit);
    fit();

    const t = setTimeout(() => {
      if (isMobile.current) return;
      // Pre-detect WebGL: on headless / GPU-less clients we go straight to the
      // 2D radar sweep instead of letting THREE fail noisily into the console.
      let gl = false;
      try {
        const c = document.createElement("canvas");
        gl = Boolean(c.getContext("webgl2") || c.getContext("webgl"));
      } catch { gl = false; }
      if (!gl) {
        radar(earthHost.current, { period: 4.2, blips: (data?.targets.length ?? 3) + 4 });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      import("@/lib/globe.js").then((m: any) =>
        m.globe(earthHost.current, {
          routes: (data?.targets ?? []).map((tg) => ({
            from: "Miami",
            to: tg.city ?? "Miami",
            level: tg.risk >= 25 ? "warn" : undefined,
          })),
          markers: [
            ...EGRESS.map((city) => ({ city, v: 40 })),
            ...(data?.targets ?? []).map((tg) => ({ city: tg.city ?? "Miami", v: 60 + Math.min(40, tg.risk) })),
          ],
          onPick: (m: { city: string }) => {
            const tg = (data?.targets ?? []).find((x) => x.city === m.city);
            setPick(tg ? { city: tg.domain, v: `risk ${tg.risk}` } : { city: m.city, v: "egress PoP" });
            if (tg) {
              setLevel(1);
              setCurTarget(tg.domain);
              setCurDetector(null);
            }
          },
        }),
      ).then((g: Earth) => {
        earth.current = g;
      }).catch(() => {
        // No WebGL (headless, old GPU, blocked driver): fall back to the 2D
        // radar sweep so the centerpiece is never a black canvas.
        radar(earthHost.current, { period: 4.2, blips: (data?.targets.length ?? 3) + 4 });
      });
    }, 0);

    return () => {
      clearTimeout(t);
      removeEventListener("resize", fit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data?.targets?.length]);

  /* ── clock ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock({
        t: d.toTimeString().slice(0, 8),
        d: d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit", weekday: "long" }),
      });
    };
    const a = setInterval(tick, 1000);
    tick();
    return () => clearInterval(a);
  }, []);

  /* ── auto-tour over target cities, paused by any interaction ───────────── */
  const tour = (data?.targets ?? []).map((t) => ({ city: t.city ?? "Miami", domain: t.domain }));
  useEffect(() => {
    if (!tour.length) return;
    const id = setInterval(() => {
      idle.current++;
      if (paused && idle.current > 30) setPaused(false);
      if (paused || idle.current % 12) return;
      setTourIdx((i) => {
        const next = (i + 1) % tour.length;
        earth.current?.focus(tour[next].city);
        return next;
      });
    }, 1000);
    const onAct = () => {
      idle.current = 0;
      setPaused(true);
    };
    const evs = ["click", "keydown", "wheel"] as const;
    evs.forEach((ev) => addEventListener(ev, onAct));
    return () => {
      clearInterval(id);
      evs.forEach((ev) => removeEventListener(ev, onAct));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, tour.length]);

  if (isLoading || !user) {
    return (
      <div className="shell-loading"><div className="spinner" aria-label="Loading" /></div>
    );
  }
  if (!data) {
    return (
      <div className="shell-loading"><div className="spinner" aria-label="Connecting" /></div>
    );
  }

  /* ── drill-down model ──────────────────────────────────────────────────── */
  const targetRows = data.targets;
  const selTarget = targetRows.find((t) => t.domain === curTarget) ?? null;
  const detectorRows = selTarget
    ? Object.values(
        findings
          .filter((f) => f.targetId === selTarget.id)
          .reduce((acc, f) => {
            const w = { critical: 25, high: 10, medium: 4, low: 1, info: 0 }[f.severity];
            const k = f.detectorId;
            (acc[k] ??= { n: k, v: 0, count: 0 });
            acc[k].v += f.state === "reproduced" ? w : f.state === "inconclusive" ? 2 : 0;
            acc[k].count++;
            return acc;
          }, {} as Record<string, { n: string; v: number; count: number }>),
      ).sort((a, b) => b.v - a.v)
    : [];
  const findingRows = curDetector
    ? findings.filter((f) => f.targetId === selTarget?.id && f.detectorId === curDetector)
    : [];

  const list = level === 0
    ? targetRows.map((t) => ({ n: t.name.split("—")[0].trim(), sub: t.domain, v: t.risk, hub: t.city ?? "Miami", pct: Math.min(100, t.risk) }))
    : level === 1
      ? detectorRows.map((d) => ({ n: d.n, sub: `${d.count} finding${d.count > 1 ? "s" : ""}`, v: d.v, hub: selTarget?.city ?? "Miami", pct: Math.min(100, d.v) }))
      : findingRows.map((f) => ({ n: f.endpoint ?? f.detectorId, sub: f.state.replace("_", " "), v: 0, hub: selTarget?.city ?? "Miami", pct: f.state === "reproduced" ? 100 : f.state === "inconclusive" ? 45 : 8 }));
  const max = Math.max(1, ...list.map((r) => r.v));

  const drill = (row: { n: string; sub: string; hub: string }, i: number) => {
    if (level === 0) {
      setLevel(1);
      setCurTarget(targetRows[i].domain);
      setCurDetector(null);
    } else if (level === 1) {
      setLevel(2);
      setCurDetector(detectorRows[i].n);
    }
    if (row.hub && geo.CITY[row.hub as keyof typeof geo.CITY]) {
      earth.current?.focus(row.hub);
      setPick({ city: row.sub, v: null });
    }
  };

  const crumbs = ["All targets", ...(selTarget ? [selTarget.domain] : []), ...(curDetector ? [curDetector] : [])];
  const k = data.kpis;
  const KPI = [
    { l: "Reproduced", v: k.reproduced, u: "findings", tone: "var(--neg)" },
    { l: "Critical open", v: k.critical, u: "sev", tone: "var(--neg)" },
    { l: "Inconclusive", v: k.inconclusive, u: "honest", tone: "var(--warn)" },
    { l: "Detection confirmed", v: k.confirmed, u: "jobs", tone: "var(--pos)" },
    { l: "Kill-switch stops", v: k.stops, u: "total", tone: "var(--s5)" },
  ];

  const activeJobs = data.jobs.filter((j) => STATE_ORDER.includes(j.state as never) && j.state !== "completed");

  const stageEl = (
    <div id="stage" ref={stage} className="desktop-only">
      <div id="space" ref={space} />

      <div className="top" ref={top}>
        <div className="title" style={{ fontSize: 26 }}>
          ARGUS<small>AUTONOMOUS SECURITY OPERATIONS</small>
        </div>
        <div className="crumb">
          {level > 0 && (
            <button
              type="button"
              onClick={() => {
                if (level === 2) { setLevel(1); setCurDetector(null); }
                else { setLevel(0); setCurTarget(null); }
              }}
            >
              ← Back
            </button>
          )}
          {crumbs.map((p, i) => (
            <Fragment key={p}>
              {i ? <span>›</span> : null}
              <span className={i === crumbs.length - 1 ? "cur" : ""}>{p}</span>}
            </Fragment>
          ))}
        </div>
        {data.demo && <span className="demo-badge">DEMO DATA · ARGUS RANGE</span>}
        <div className="spacer" />
        <nav style={{ display: "flex", gap: 8 }}>
          <Link className="btn ghost sm" to="/targets">Targets</Link>
          <Link className="btn ghost sm" to="/jobs">Runs</Link>
          <Link className="btn ghost sm" to="/findings">Findings</Link>
          <Link className="btn ghost sm" to="/reports">Reports</Link>
        </nav>
        <div className={"live" + (online ? "" : " off")}>
          <span className="blip" />
          <span>{online ? "LIVE" : "STALE · reconnecting"}</span>
        </div>
        <div className="clock"><span>{clock.t}</span><small>{clock.d}</small></div>
        <ThemeSlot />
        <UserChip />
      </div>

      <div className="body">
        {/* left rail */}
        <div className="col">
          <div className="card">
            <h2>
              {level === 0 ? "Exposure ranking" : level === 1 ? "Detectors" : "Findings"}
              <span className="r">{level === 0 ? "click to drill" : level === 1 ? "target: " + selTarget?.domain : curDetector}</span>
            </h2>
            <div className="rank">
              {list.length === 0 && <div className="empty">No entries yet.</div>}
              {list.map((r, i) => (
                <div
                  className={"rk " + ((level === 0 && curTarget === (targetRows[i]?.domain ?? "")) ? "sel" : "")}
                  key={r.n + i}
                  onClick={() => drill(r, i)}
                >
                  <div className={"no " + (i < 3 ? "t3" : "")}>{i + 1}</div>
                  <div className="nm" style={{ width: 150 }} title={r.sub}>{r.n}</div>
                  <div className="track"><div className="fill" style={{ width: (r.v / max) * 100 + "%" }} /></div>
                  <div className="v" style={{ width: 46 }}>{r.v}</div>
                  <div className="p" style={{ color: r.pct >= 60 ? "var(--neg)" : r.pct >= 25 ? "var(--warn)" : "var(--pos)" }}>
                    {r.pct.toFixed(0)}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h2>Evidence states<span className="r">three-state adjudication</span></h2>
            <Chart opt={donutOpt(data.states)} />
          </div>
          <div className="card">
            <h2>Open by severity<span className="r">reproduced only</span></h2>
            <Chart opt={sevOpt(data.severity)} />
          </div>
        </div>

        {/* center */}
        <div className="mid">
          <div className="kpibar">
            {KPI.map((kk) => (
              <div className="kpi" key={kk.l}>
                <div className="l">{kk.l}</div>
                <div className="v" style={{ color: kk.tone }}>{kk.v}<u>{kk.u}</u></div>
                <div className="d"><span>rolling · live</span></div>
              </div>
            ))}
          </div>

          <div className="globe">
            <div id="earth" ref={earthHost} />
            <div className="hud"><i /><i /><i /><i /></div>
            <div className="gtitle"><b>OPERATIONS THEATRE</b><small>EGRESS PoPs → VERIFIED TARGETS · RANGE ONLY</small></div>
            <div className="readout">
              {pick ? (
                <>
                  <span>Selected</span><b>{pick.city}</b>
                  {pick.v && <span className="k">{pick.v}</span>}
                </>
              ) : (
                <>
                  <span>Targets</span><b>{data.targets.length}</b>
                  <span>· Active runs</span><b>{k.activeJobs}</b>
                  <span className="k">egress {EGRESS.length} PoPs</span>
                </>
              )}
            </div>
            <div className="ghint">drag to rotate · click a marker to drill</div>
          </div>

          <div className="card">
            <h2>Findings intake · last 12h<span className="r">{curDetector || selTarget?.domain || "all targets"}</span></h2>
            <Chart opt={trendOpt(data.trend)} />
          </div>
        </div>

        {/* right rail */}
        <div className="col">
          <div className="card">
            <h2>Active runs<span className="r">{activeJobs.length} in flight</span></h2>
            <div className="routes">
              {data.jobs.slice(0, 7).map((j) => {
                const tg = data.targets.find((t) => t.id === j.targetId);
                const active = j.state !== "completed" && j.state !== "stopped" && j.state !== "failed";
                return (
                  <div className="rt" key={j.id} onClick={() => tg?.city && earth.current?.focus(tg.city)}>
                    <span className="pair">
                      <span className="mono" style={{ fontSize: 12.5 }}>#{j.id}</span>
                      <em>·</em>{tg?.domain ?? "?"}
                    </span>
                    <span className={"tag " + j.state}>{j.state}</span>
                    <span className="dl" style={{ color: active ? "var(--s1)" : j.state === "stopped" ? "var(--neg)" : "var(--pos)" }}>
                      {j.progress}%
                    </span>
                  </div>
                );
              })}
              {data.jobs.length === 0 && <div className="empty">No runs yet.</div>}
            </div>
          </div>
          <div className="card">
            <h2>Agent wall<span className="r">deterministic core · S2</span></h2>
            <div className="routes">
              {data.agents.map((a) => (
                <div className="rt" key={a.agent} style={{ cursor: "default" }}>
                  <span className="pair" style={{ flex: "0 0 118px" }}>
                    <b style={{ fontSize: 14.5 }}>{a.agent}</b>
                  </span>
                  <span className="small muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.detail}
                  </span>
                  <span
                    className="dl"
                    style={{
                      width: 76,
                      color: a.status === "active" ? "var(--pos)" : a.status === "watching" ? "var(--warn)" : "var(--faint)",
                    }}
                  >
                    {a.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h2>Live feed<span className="r">watcher + proxy + agents</span></h2>
            <div className="alerts"><div className="lane">
              {data.feed.concat(data.feed).map((e, i) => (
                <div className={"al " + (e.kind === "stop" || e.kind === "threshold" ? "hi" : "")} key={i}>
                  <span className="t">{new Date(e.createdAt).toTimeString().slice(0, 5)}</span>
                  <span className="x" title={e.message}>[{e.agent}] {e.message}</span>
                  <span className={"lv " + (e.kind === "stop" || e.kind === "threshold" ? "a" : "b")}>
                    {e.kind === "stop" ? "STOP" : e.kind === "threshold" ? "THR" : e.kind === "signal" ? "SIG" : "OPS"}
                  </span>
                </div>
              ))}
            </div></div>
          </div>
        </div>
      </div>

      <div className="dots">
        <span>{paused ? "tour paused" : "auto-tour"}</span>
        {tour.map((_, i) => <i className={i === tourIdx ? "on" : ""} key={i} />)}
      </div>
    </div>
  );

  /* ── mobile: stacked command dashboard ─────────────────────────────────── */
  const mobileEl = (
    <div className="mob">
      <div className="mtop">
        <span className="mtitle">ARGUS</span>
        {data.demo && <span className="demo-badge">DEMO DATA</span>}
        <div className="spacer" />
        <ThemeSlot />
        <UserChip />
      </div>
      <div className="mnav">
        <Link to="/targets">Targets</Link>
        <Link to="/jobs">Runs</Link>
        <Link to="/findings">Findings</Link>
        <Link to="/reports">Reports</Link>
      </div>
      <div className="kpis">
        {KPI.map((kk) => (
          <div className="mkpi" key={kk.l}>
            <div className="l">{kk.l}</div>
            <div className="v" style={{ color: kk.tone }}>{kk.v}</div>
          </div>
        ))}
      </div>
      <div className="mcard">
        <h2>Agent wall</h2>
        {data.agents.map((a) => (
          <div className="feeditem" key={a.agent}>
            <span className={"ag " + a.agent.toLowerCase()}>{a.agent}</span>
            <span style={{ flex: 1 }}>{a.detail}</span>
            <span className="tm">{a.status}</span>
          </div>
        ))}
      </div>
      <div className="mcard">
        <h2>Live feed</h2>
        {data.feed.slice(0, 8).map((e) => (
          <div className={"feeditem " + e.kind} key={e.id}>
            <span className="tm">{new Date(e.createdAt).toTimeString().slice(0, 5)}</span>
            <span>[{e.agent}] {e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {stageEl}
      {mobileEl}
    </>
  );
}
