/**
 * ARGUS Range — intentionally misconfigured dummy targets (Master Build Doc, Part 5).
 *
 * Every demo scan runs against these scripts. Nothing here touches a real
 * network: the job engine plays back scripted observations, and detectors
 * adjudicate exactly what the script declares. This is demo mode (S10) —
 * the UI carries a persistent DEMO DATA badge wherever this data appears.
 *
 * Detector IDs and three-state rules follow Part 8 of the Master Build
 * Document. `state` is what deterministic adjudication concluded:
 *   reproduced     — evidence confirmed the issue
 *   not_reproduced — probe ran, issue did not reproduce
 *   inconclusive   — observable limit reached; reported honestly, never hidden
 */

export interface RangeFinding {
  detectorId: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  state: "reproduced" | "not_reproduced" | "inconclusive";
  endpoint: string;
  summary: string;
  evidence: string;
}

export interface RangeTarget {
  domain: string;
  name: string;
  city: string;
  industry: string;
  isCdn: boolean;
  originVerified: boolean;
  /** Detection connector available for this target (S7). */
  connector: "cloudflare" | null;
  /** Whether the fake WAF visibly reacts (external signals tier). */
  wafReacts: boolean;
  findings: RangeFinding[];
}

export const RANGE: Record<string, RangeTarget> = {
  "clinicmock.range.aidynamic.pro": {
    domain: "clinicmock.range.aidynamic.pro",
    name: "ClinicMock — demo clinic portal",
    city: "Miami",
    industry: "Healthcare clinic",
    isCdn: true, // sits behind Cloudflare: Host/SNI-pinned HTTPS only, no port scan (S5)
    originVerified: false,
    connector: "cloudflare",
    wafReacts: true,
    findings: [
      {
        detectorId: "EXP-01",
        title: "Exposed .git directory",
        severity: "critical",
        state: "reproduced",
        endpoint: "/.git/HEAD",
        summary:
          "The site's Git repository metadata is publicly reachable. Source code and history can be reconstructed.",
        evidence:
          "GET /.git/HEAD → 200, body ref: refs/heads/main (redacted hash 9f2c…e1). Content-Type text/plain. Reproduced 2/2 via egress proxy.",
      },
      {
        detectorId: "ADM-01",
        title: "Exposed admin login panel",
        severity: "high",
        state: "reproduced",
        endpoint: "/admin",
        summary:
          "An administrative login panel is reachable from the public internet, with login form markers confirmed in the response.",
        evidence:
          "GET /admin → 200 with <form action=\"/admin/login\"> and password field markers. 200 alone was not accepted; markers required by rule ADM-01 v1.3.",
      },
      {
        detectorId: "HDR-01",
        title: "Missing Content-Security-Policy",
        severity: "medium",
        state: "reproduced",
        endpoint: "/",
        summary:
          "No Content-Security-Policy header on the main booking page, leaving injected scripts unrestricted.",
        evidence:
          "Stored response headers for GET / (job observation #014): content-security-policy absent in 3/3 samples.",
      },
      {
        detectorId: "HDR-02",
        title: "Missing HSTS (Strict-Transport-Security)",
        severity: "medium",
        state: "reproduced",
        endpoint: "/",
        summary:
          "The site does not tell browsers to stick to HTTPS, so first visits can be downgraded.",
        evidence:
          "strict-transport-security absent in stored response; TLS-04 confirmed no HTTP→HTTPS redirect on :80 probe.",
      },
      {
        detectorId: "CK-01",
        title: "Session cookie without Secure / HttpOnly",
        severity: "high",
        state: "reproduced",
        endpoint: "/booking",
        summary:
          "The booking session cookie can be read by scripts and sent over plain HTTP.",
        evidence:
          "Set-Cookie: sid=…; Path=/ (no Secure, no HttpOnly) in stored response, redacted value fingerprint sha256:7ab1…",
      },
      {
        detectorId: "CORS-01",
        title: "Permissive CORS with credentials",
        severity: "high",
        state: "not_reproduced",
        endpoint: "/api/v1/appointments",
        summary:
          "Probed with an arbitrary Origin; the API did not reflect it together with credentials. No issue reproduced.",
        evidence:
          "GET with Origin: https://evil.example → ACAO absent in 2/2 samples. Rule CORS-01 requires reflection AND allow-credentials.",
      },
      {
        detectorId: "VER-01",
        title: "Outdated web server (suspected)",
        severity: "medium",
        state: "inconclusive",
        endpoint: "/",
        summary:
          "Server header suggests nginx 1.18 (EOL), but the version string may be backport-patched. Deterministic rules cannot confirm vulnerability.",
        evidence:
          "Server: nginx/1.18.0 observed. Version confidence: suspected, not confirmed → inconclusive per VER-01 v2.0.",
      },
      {
        detectorId: "RL-01",
        title: "Rate limiting on login endpoint",
        severity: "low",
        state: "inconclusive",
        endpoint: "/admin/login",
        summary:
          "A small safe probe (10 requests) saw no throttling, but the sample is too small to conclude no rate limit exists.",
        evidence:
          "10/10 GET → 200, median 212 ms, no 429. RL-01 marks absence inconclusive unless strict threshold met.",
      },
      {
        detectorId: "STO-01",
        title: "Subdomain takeover candidate",
        severity: "high",
        state: "not_reproduced",
        endpoint: "legacy.clinicmock.range.aidynamic.pro",
        summary:
          "Dangling CNAME found in passive CT logs, but the provider page did not show an unclaimed marker. Detection only — never claimed.",
        evidence:
          "CNAME → unpkg-cdn.example (dangling). Provider marker check negative in 2/2 samples.",
      },
      {
        detectorId: "API-01",
        title: "Public API surface discovered",
        severity: "info",
        state: "reproduced",
        endpoint: "/api/v1/openapi.json",
        summary:
          "An OpenAPI specification is publicly served, documenting 14 endpoints including /api/v1/patients (auth required).",
        evidence: "GET /api/v1/openapi.json → 200, openapi: 3.0.1, 14 paths inventoried.",
      },
      {
        detectorId: "TLS-01",
        title: "TLS protocol strength",
        severity: "info",
        state: "not_reproduced",
        endpoint: "tcp/443",
        summary: "TLS 1.2+ only; no weak protocol or cipher reproduced.",
        evidence: "Handshake matrix TLS1.0/1.1 refused; TLS1.3 negotiated (observation #003).",
      },
    ],
  },

  "lexpartners.range.aidynamic.pro": {
    domain: "lexpartners.range.aidynamic.pro",
    name: "LexPartners — demo law firm",
    city: "Chicago",
    industry: "Law firm",
    isCdn: false,
    originVerified: true, // verified origin IP: port check permitted (S5)
    connector: null,
    wafReacts: true, // external signals only: no connector, so tier stays "external"
    findings: [
      {
        detectorId: "TLS-02",
        title: "Certificate hostname mismatch",
        severity: "high",
        state: "reproduced",
        endpoint: "tcp/443",
        summary:
          "The TLS certificate is issued for a different hostname; visitors may see browser warnings.",
        evidence: "Presented CN=mail.hosting-provider.example for SNI lexpartners… (observation #002).",
      },
      {
        detectorId: "PRT-01",
        title: "Open database port on verified origin",
        severity: "critical",
        state: "reproduced",
        endpoint: "tcp/3306",
        summary:
          "MySQL answers on a public port of the verified origin IP. Origin verified as customer-owned, so the port check was in scope (S5).",
        evidence: "Banner 5.7.44-log on tcp/3306, 2/2 connects. CDN-skip rule not triggered (origin verified).",
      },
      {
        detectorId: "EXP-02",
        title: "Backup archive downloadable",
        severity: "critical",
        state: "reproduced",
        endpoint: "/backup/site-2026-10.zip",
        summary: "A full site backup archive is publicly downloadable from a predictable path.",
        evidence: "HEAD → 200, application/zip, 48.2 MB. Content sampled and redacted; hash sha256:c41d…",
      },
      {
        detectorId: "HDR-03",
        title: "Missing X-Frame-Options / frame-ancestors",
        severity: "medium",
        state: "reproduced",
        endpoint: "/",
        summary: "The site can be framed by other pages, enabling clickjacking on the client-portal login.",
        evidence: "x-frame-options absent and no CSP frame-ancestors in stored response (3/3 samples).",
      },
      {
        detectorId: "MC-01",
        title: "Mixed content on portal page",
        severity: "low",
        state: "reproduced",
        endpoint: "/portal",
        summary: "An HTTPS page loads a JavaScript file over plain HTTP.",
        evidence: "https://…/portal references http://…/js/legacy.js (type: script).",
      },
      {
        detectorId: "VER-01",
        title: "WordPress core version",
        severity: "medium",
        state: "inconclusive",
        endpoint: "/",
        summary:
          "Meta generator indicates WordPress 6.4; mapped CVEs apply only below 6.4.3 and the patch level is not deterministically visible.",
        evidence: "generator meta \"WordPress 6.4\" — suspected patch level → inconclusive per VER-01 v2.0.",
      },
    ],
  },

  "harborhvac.range.aidynamic.pro": {
    domain: "harborhvac.range.aidynamic.pro",
    name: "Harbor HVAC — demo local services",
    city: "Seattle",
    industry: "Local services",
    isCdn: false,
    originVerified: true,
    connector: null,
    wafReacts: false, // no connector, no external signals → honestly "not observable"
    findings: [
      {
        detectorId: "HDR-01",
        title: "Missing Content-Security-Policy",
        severity: "medium",
        state: "reproduced",
        endpoint: "/",
        summary: "No Content-Security-Policy header anywhere on the site.",
        evidence: "CSP absent in 5/5 stored responses across crawled pages.",
      },
      {
        detectorId: "CK-02",
        title: "Cookie scoped to all subdomains",
        severity: "low",
        state: "reproduced",
        endpoint: "/",
        summary: "The analytics cookie is valid for every subdomain, widening exposure if any subdomain is weaker.",
        evidence: "Set-Cookie: …; Domain=.harborhvac.range.aidynamic.pro (overly broad per CK-02 v1.1).",
      },
      {
        detectorId: "EXP-03",
        title: "Debug status page",
        severity: "medium",
        state: "reproduced",
        endpoint: "/status/debug",
        summary: "A debug page discloses framework version and environment flags.",
        evidence: "GET → 200, contains \"DEBUG=true\" and framework banner (snippet redacted, sha256:90be…).",
      },
      {
        detectorId: "PRT-01",
        title: "Non-web ports on verified origin",
        severity: "info",
        state: "not_reproduced",
        endpoint: "tcp/top-20",
        summary: "Top-20 web/admin port check found only 80/443 open on the verified origin IP.",
        evidence: "20 ports probed at ≤2 pps; 18 closed/filtered, 80+443 open.",
      },
    ],
  },
};

/** Scanner identity published per S6 — every demo request claims this UA. */
export const SCANNER_UA = "ARGUS-Scanner/1.0 (+https://aidynamic.pro/argus/scanner)";

export function cityOf(domain: string): string {
  return RANGE[domain]?.city ?? "Miami";
}
