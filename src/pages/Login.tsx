function getOAuthUrl() {
  const kimiAuthUrl = import.meta.env.VITE_KIMI_AUTH_URL;
  const appID = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${kimiAuthUrl}/api/oauth/authorize`);
  url.searchParams.set("client_id", appID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", state);

  return url.toString();
}

export default function Login() {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-mark">A</div>
        <h1>ARGUS Command Center</h1>
        <p className="login-sub">
          Autonomous security operations for small business — evidence-adjudicated
          findings, detection timeline, and a kill switch that actually works.
        </p>
        <a className="btn primary block" href={getOAuthUrl()}>
          Sign in with Kimi
        </a>
        <p className="login-fine">
          Demo build: all scans run against the ARGUS Range (intentionally
          misconfigured dummy sites). No real site is ever touched.
        </p>
      </div>
    </div>
  );
}
