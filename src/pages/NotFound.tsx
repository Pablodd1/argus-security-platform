import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1 style={{ fontSize: 40 }}>404</h1>
        <p className="login-sub">This console page does not exist.</p>
        <Link className="btn primary block" to="/">
          Back to Command Center
        </Link>
      </div>
    </div>
  );
}
