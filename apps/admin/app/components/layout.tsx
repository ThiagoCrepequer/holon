import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";

import { ConsoleIcon } from "./console-icon.js";

export interface LayoutProps {
  userEmail?: string | undefined;
  currentPath: string;
  children: ReactNode;
}

const navigation = [
  { label: "Overview", href: "/", glyph: "overview" },
  { label: "Runs", href: "/runs", glyph: "runs" },
  { label: "Readiness", href: "/readiness", glyph: "pulse" },
] as const;

export function Layout({ userEmail, children }: LayoutProps) {
  return (
    <div className="console-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="console-sidebar">
        <Link to="/" className="console-brand" aria-label="Holon Console">
          <span className="brand-mark" aria-hidden="true">
            h<span>↗</span>
          </span>
          <span>
            holon<span className="brand-caption">Review intelligence</span>
          </span>
        </Link>
        <div className="sidebar-section-label">Workspace</div>
        <nav aria-label="Main navigation" className="console-navigation">
          {navigation.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.href === "/"}
              className={({ isActive }) =>
                `console-nav-item${isActive ? " is-active" : ""}`
              }
            >
              <ConsoleIcon name={item.glyph} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="console-identity" aria-label="Signed-in user">
            <span className="identity-avatar" aria-hidden="true">
              {userEmail?.charAt(0).toUpperCase() ?? "H"}
            </span>
            <div className="identity-text">
              <span title={userEmail}>{userEmail ?? "Unauthenticated"}</span>
              <small>
                {userEmail ? "Authorized operator" : "Access required"}
              </small>
            </div>
          </div>
          <div className="sidebar-access">
            <span className="access-dot" /> Read-only workspace
          </div>
        </div>
      </aside>
      <div className="console-body">
        <main id="main-content" tabIndex={-1} className="console-main">
          {children}
        </main>
        <footer className="console-footer">
          <span>Holon Internal Operational Console</span>
          <span>Read-Only · Strict Access Isolation</span>
        </footer>
      </div>
    </div>
  );
}
