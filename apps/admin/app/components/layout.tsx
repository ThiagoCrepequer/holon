import { Badge } from "@holon/ui";
import * as React from "react";
import { Link, NavLink } from "react-router";

export interface LayoutProps {
  userEmail?: string | undefined;
  currentPath: string;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
  userEmail,
  currentPath,
  children,
}) => {
  const navItems = [
    {
      label: "Overview",
      href: "/",
      icon: (
        <svg
          className="w-4 h-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect width="7" height="7" x="3" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="14" rx="1" />
          <rect width="7" height="7" x="3" y="14" rx="1" />
        </svg>
      ),
    },
    {
      label: "Runs",
      href: "/runs",
      icon: (
        <svg
          className="w-4 h-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" x2="20" y1="19" y2="19" />
        </svg>
      ),
    },
    {
      label: "Readiness",
      href: "/readiness",
      icon: (
        <svg
          className="w-4 h-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col md:flex-row">
      {/* Desktop Lateral Sidebar */}
      <aside className="hidden md:flex md:w-64 md:shrink-0 md:flex-col md:justify-between border-r border-zinc-200 bg-white min-h-screen sticky top-0 h-screen overflow-y-auto">
        <div className="p-5">
          {/* Logo & Brand */}
          <Link
            to="/"
            className="flex items-center gap-2.5 font-semibold tracking-tight text-zinc-950 group"
          >
            <span className="w-7 h-7 rounded-lg bg-zinc-950 flex items-center justify-center text-xs text-white font-mono font-bold shadow-xs group-hover:bg-zinc-800 transition-colors">
              H
            </span>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-bold tracking-tight text-zinc-950">
                Holon Console
              </span>
              <span className="text-[10px] font-mono text-zinc-400 mt-0.5">
                INTERNAL CONSOLE
              </span>
            </div>
            <Badge
              variant="neutral"
              size="sm"
              className="ml-auto text-[10px] font-mono"
            >
              READ-ONLY
            </Badge>
          </Link>

          {/* Navigation Section */}
          <nav aria-label="Main navigation" className="mt-8 space-y-1">
            <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-mono">
              Operations
            </div>
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? currentPath === "/"
                  : currentPath.startsWith(item.href);
              return (
                <NavLink
                  key={item.href}
                  to={item.href}
                  className={`flex items-center gap-3 px-3 py-2 text-xs rounded-lg transition-colors font-medium ${
                    isActive
                      ? "bg-zinc-900 text-white shadow-xs font-semibold"
                      : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100/80"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className={isActive ? "text-white" : "text-zinc-500"}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer: User Identity & Isolation Status */}
        <div className="p-4 border-t border-zinc-200 bg-zinc-50/50 space-y-3">
          {userEmail ? (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white border border-zinc-200 flex items-center justify-center text-xs font-mono font-bold text-zinc-700 uppercase shadow-2xs shrink-0">
                {userEmail.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="text-xs font-semibold text-zinc-900 truncate font-mono"
                  title={userEmail}
                >
                  {userEmail}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge variant="success" size="sm" dot>
                    Authorized
                  </Badge>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Badge variant="neutral" size="sm">
                Unauthenticated
              </Badge>
            </div>
          )}
          <div className="pt-2 border-t border-zinc-200/60 flex items-center justify-between text-[11px] text-zinc-400">
            <span>Strict Access Isolation</span>
            <span className="font-mono text-[10px]">v1.0</span>
          </div>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Top Header */}
        <header className="md:hidden sticky top-0 z-40 w-full border-b border-zinc-200 bg-white/95 backdrop-blur-xs">
          <div className="px-4 h-14 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2 font-semibold">
              <span className="w-6 h-6 rounded-md bg-zinc-950 flex items-center justify-center text-xs text-white font-mono">
                H
              </span>
              <span className="text-sm font-bold text-zinc-950">
                Holon Console
              </span>
              <Badge
                variant="neutral"
                size="sm"
                className="text-[10px] font-mono"
              >
                INTERNAL
              </Badge>
            </Link>
            {userEmail && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 font-mono hidden sm:inline">
                  {userEmail}
                </span>
                <Badge variant="success" size="sm" dot>
                  Authorized
                </Badge>
              </div>
            )}
          </div>
          {/* Mobile Navigation bar */}
          <nav
            className="flex items-center gap-1 px-4 pb-2.5 overflow-x-auto border-t border-zinc-100 pt-2"
            aria-label="Mobile navigation"
          >
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? currentPath === "/"
                  : currentPath.startsWith(item.href);
              return (
                <NavLink
                  key={item.href}
                  to={item.href}
                  className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium rounded-md transition-colors shrink-0 ${
                    isActive
                      ? "bg-zinc-900 text-white font-semibold"
                      : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </header>

        {/* Main Page Content */}
        <main className="flex-1 p-5 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-zinc-200 bg-white py-4 px-5 sm:px-6 lg:px-8 mt-auto">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-zinc-400">
            <div>Holon Internal Operational Console &bull; Read-Only</div>
            <div className="font-mono text-[11px]">Strict Access Isolation</div>
          </div>
        </footer>
      </div>
    </div>
  );
};
