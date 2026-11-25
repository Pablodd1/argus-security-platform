# ARGUS — Security Operations Command Center

Built on the bigscreen-cockpit template (1920×1080 command wall with 3D globe).

## What it is

Autonomous multi-agent security assessment platform for small businesses:

- **Four agents** — Scout (collection), Hacker (deterministic adjudication, zero LLM), Watcher (independent oversight + kill switch), Reporter (evidence packaging)
- **Three-state evidence** — reproduced / not_reproduced / inconclusive; HTTP 200 alone never counts
- **Safety** — egress-proxy policy, request budgets, <1s kill switch, CDN S5 rule, Gate G4 counsel gate for live targets
- **Proof Packets** — SHA-256 hash chain + signature per report, re-verified server-side on every view
- **Demo mode (S10)** — all scans run against the scripted ARGUS Range; the UI carries a persistent DEMO DATA badge

## Stack

React 19 + TypeScript + Vite 7 frontend; Hono + tRPC 11 + Drizzle ORM + MySQL backend; Kimi OAuth; PWA.

## Develop

```bash
npm install
npm run db:push   # sync schema
npm run dev       # http://localhost:3000
```

## Build & run

```bash
npm run build     # dist/public + bundled dist/boot.js
npm start         # production server on :3000
```
