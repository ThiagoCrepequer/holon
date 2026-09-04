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
      className={`operational-notice${hasDegradation ? " is-degraded" : ""}`}
    >
      <div className="operational-notice-icon">
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
      <div className="operational-notice-body">
        <h4 className="operational-notice-title">
          {hasDegradation
            ? "Operational Degradation Detected"
            : "Optional Telemetry Unavailable"}
        </h4>
        <p className="operational-notice-description">
          {hasDegradation
            ? "At least one operational subsystem has breached its configured health threshold."
            : "Core review processing remains available. Optional metrics will appear when integrations are available."}
        </p>
        <div className="operational-notice-services">
          {notices.map((notice) => (
            <span key={notice.service} className="operational-notice-service">
              {notice.service} ·{" "}
              {notice.state === "degraded" ? "Degraded" : "Unavailable"}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
