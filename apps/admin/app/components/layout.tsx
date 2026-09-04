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
    { label: "Overview", href: "/" },
    { label: "Runs", href: "/runs" },
    { label: "Readiness", href: "/readiness" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 text-zinc-900">
      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b border-zinc-200 bg-white/95 backdrop-blur-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              to="/"
              className="flex items-center gap-2 font-semibold tracking-tight text-zinc-950"
            >
              <span className="w-5 h-5 rounded-md bg-zinc-950 flex items-center justify-center text-[11px] text-white font-mono">
                H
              </span>
              <span>Holon Console</span>
              <Badge
                variant="neutral"
                size="sm"
                className="ml-1 text-[10px] font-mono"
              >
                INTERNAL
              </Badge>
            </Link>

            <nav
              className="hidden md:flex items-center gap-1"
              aria-label="Main navigation"
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
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      isActive
                        ? "bg-zinc-100 text-zinc-950 font-semibold"
                        : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
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
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 bg-white py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-zinc-400">
          <div>Holon Internal Operational Console &bull; Read-Only</div>
          <div className="font-mono text-[11px]">Strict Access Isolation</div>
        </div>
      </footer>
    </div>
  );
};
