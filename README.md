# ARGUS — Autonomous Security Operations for Small Business

ARGUS is a multi-agent security platform that runs continuous, evidence-adjudicated
security scans for small businesses — and proves what it did. It is built around one
principle: **never fabricate detection**. Every claim a report makes is backed by
stored, redacted, hash-chained evidence, and anything the detectors cannot prove is
stated as *not tested*, never silently dropped.

## What it does

- **Command Wall (cockpit)** — a 1920×1080 big-screen operations view: live KPI band,
  3D operations globe (egress PoPs → verified targets), exposure ranking with
  target → detector → finding drill-down, evidence-state donut, severity bars, agent
  wall and a live event feed. Falls back to a 2D radar sweep when WebGL is
  unavailable, and to a stacked mobile dashboard under 900px.
- **Console pages** — Targets (inventory, DNS-TXT ownership verification, scope
  lock), Runs (live job monitor with an independent kill switch), Findings
  (three-state evidence with an owner lifecycle: open → acknowledged → fix_claimed →
  verified_fixed / still_open), and Reports.
- **Reports & Proof Packets** — every completed run seals a report with a
  SHA-256 evidence manifest and a signature (HMAC-SHA256 in this demo build; Ed25519
  in production). The manifest hash is re-computed server-side on every read, so a
  tampered packet shows `✗ hash mismatch`.
- **Agent engine** — deterministic Scout / Hacker / Watcher / Reporter agents driven
  by a 1s tick state machine (queued → scouting → adjudicating → reporting →
  completed) with race-safe conditional updates and per-job event dedup. No LLM sits
  in the scan/adjudication path.

## Safety gates (enforced server-side)

- **Range only** — all demo/CI traffic goes to the ARGUS Range (intentionally
  misconfigured dummy sites under `*.range.aidynamic.pro`). No real external site is
  ever touched.
- **Gate order** — no run starts without verified ownership, a locked scope hash, and
  an authorization record.
- **Gate G4** — non-Range (production) targets are refused with FORBIDDEN until
  counsel approval; adding one succeeds but scanning stays blocked.
- **S5** — CDN-fronted targets are scanned Host/SNI-pinned HTTPS only; port scans run
  solely against verified origin IPs.
- **Kill switch** — stopping a run revokes the proxy token and refuses all further
  requests; the stop event is written into the report.

## Stack

React 19 · TypeScript · Vite 7 · ECharts 5 · Three.js (globe) · custom CSS design
tokens · Hono + tRPC 11 + superjson · Drizzle ORM + MySQL · Kimi OAuth (HS256 JWT
sessions via `jose`)

## Repo layout

```
api/            Hono server + tRPC routers + the ARGUS engine
  argusRouter.ts  gates, demo seeder, summary/targets/jobs/findings/reports
  boot.ts         server entry (engine start, middleware, OAuth callback, SPA serve)
api/lib/        logger, http client, request context, secret scrubbing, client log sink
api/kimi/       OAuth exchange, JWKS verification, session tokens
drizzle/        schema + migrations
src/pages/      Cockpit, Targets, Jobs, Findings, Reports, Login, NotFound
src/lib/        charts/theme kit, fx (constellation/radar), 3D globe, geo data, logger
src/styles/     kit.css (design tokens), app.css (cockpit), console.css (console pages)
```

## Running it

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, APP_ID/APP_SECRET, Kimi OAuth URLs
npm run db:migrate
npm run dev            # vite + hono dev server on :3000
```

Other scripts: `npm run build` (client bundle + bundled server), `npm start`
(production), `npm run check` (tsc), `npm test` (vitest).

On first login the demo seeder (`ensureDemoData`) provisions three Range targets,
runs, findings and a sealed report per user — idempotently — so the cockpit is alive
immediately. The `DEMO DATA · ARGUS RANGE` badge is always visible while demo data
is on screen.

## Deliberately not in this repo

`node_modules/`, `dist/`, `package-lock.json`, font/icon binaries, and `.env`
(secrets — see `.env.example` for the required variables).
