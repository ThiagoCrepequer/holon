import { Badge } from "@holon/ui";
import * as React from "react";

import type { OperationalNotice } from "../operational-status.js";

export interface OperationalStatusBannerProps {
  readonly notices: readonly OperationalNotice[];
}

export const OperationalStatusBanner: React.FC<
  OperationalStatusBannerProps
> = ({ notices }) => {
  if (notices.length === 0) return null;

  const hasDegradation = notices.some((notice) => notice.state === "degraded");

  return (
    <div
      role={hasDegradation ? "alert" : "status"}
      className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-xs flex items-start gap-3"
    >
      <div className="shrink-0 mt-0.5 text-amber-600">
        <svg
          aria-hidden="true"
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <div className="flex-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-800">
          {hasDegradation
            ? "Operational Degradation Detected"
            : "Optional Telemetry Unavailable"}
        </h4>
        <p className="mt-1 text-xs text-amber-700">
          {hasDegradation
            ? "At least one operational subsystem has breached its configured health threshold."
            : "Core review processing remains available. Configure the optional integrations or wait for upstream recovery to restore these panels."}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {notices.map((notice) => (
            <Badge
              key={notice.service}
              variant={notice.state === "degraded" ? "warning" : "info"}
              size="sm"
            >
              {notice.service} ·{" "}
              {notice.state === "degraded" ? "Degraded" : "Unavailable"}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
};
