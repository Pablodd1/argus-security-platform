import { type ReactNode, useEffect, useRef } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import Kit from "@/lib/kit.js";

/** Redirects to /login until a session exists. Returns the user or null. */
export function useRequireAuth() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isLoading && !user) navigate("/login", { replace: true });
  }, [user, isLoading, navigate]);
  return { user, isLoading };
}

const NAV = [
  { to: "/", label: "Command Wall", end: true },
  { to: "/targets", label: "Targets" },
  { to: "/jobs", label: "Runs" },
  { to: "/findings", label: "Findings" },
  { to: "/reports", label: "Reports" },
];

export function ThemeSlot() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const btn = Kit.themeToggle(undefined, ref.current);
    return () => btn.remove();
  }, []);
  return <div ref={ref} style={{ display: "contents" }} />;
}

export function UserChip() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="userchip">
      <span className="uname">{user.name ?? user.email ?? "operator"}</span>
      <button className="btn ghost sm" onClick={() => logout()} type="button">
        Sign out
      </button>
    </div>
  );
}

export default function Shell({
  children,
  title,
  actions,
}: {
  children: ReactNode;
  title: string;
  actions?: ReactNode;
}) {
  const { user, isLoading } = useRequireAuth();

  if (isLoading || !user) {
    return (
      <div className="shell-loading">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="console">
      <header className="cnav">
        <Link to="/" className="brand">
          <span className="brand-mark">A</span>
          <span className="brand-name">
            ARGUS<small>SECURITY OPERATIONS</small>
          </span>
        </Link>
        <nav className="cnav-links" aria-label="Console">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => "cnav-link" + (isActive ? " on" : "")}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <span className="demo-badge" title="All scan data comes from the ARGUS Range — intentionally misconfigured demo sites">
          DEMO DATA
        </span>
        <ThemeSlot />
        <UserChip />
      </header>
      <div className="chead">
        <h1>{title}</h1>
        <div className="spacer" />
        {actions}
      </div>
      <main className="cmain">{children}</main>
    </div>
  );
}
