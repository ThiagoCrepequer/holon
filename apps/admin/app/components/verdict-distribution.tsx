import { Card, CardHeader, CardTitle, CardContent } from "@holon/ui";

import type { AdminSummaryMetrics } from "../../workers/types.js";
import { formatNumber } from "../utils/format.js";

export function VerdictDistribution({
  distribution,
}: {
  readonly distribution: AdminSummaryMetrics["verdictDistribution"];
}) {
  const { approve, requestChanges, comment } = distribution;
  const total = approve + requestChanges + comment;
  const segments = [
    {
      label: "Approve",
      count: approve,
      offset: 0,
      color: "var(--verdict-approve)",
    },
    {
      label: "Request Changes",
      count: requestChanges,
      offset: approve,
      color: "var(--verdict-changes)",
    },
    {
      label: "Comment",
      count: comment,
      offset: approve + requestChanges,
      color: "var(--verdict-comment)",
    },
  ];
  return (
    <Card className="verdict-panel">
      <CardHeader>
        <CardTitle>Verdict Distribution</CardTitle>
      </CardHeader>
      <CardContent className={total > 0 ? "verdict-content" : "verdict-empty"}>
        {total === 0 ? (
          <>
            <p>No verdicts in this period</p>
            <span>Completed reviews will appear here.</span>
          </>
        ) : (
          <>
            <div className="verdict-visual" aria-hidden="true">
              <svg viewBox="0 0 160 160" className="verdict-ring">
                <circle
                  cx="80"
                  cy="80"
                  r="64"
                  fill="none"
                  stroke="var(--border-subtle)"
                  strokeWidth="17"
                />
                {segments.map((segment) => (
                  <circle
                    key={segment.label}
                    cx="80"
                    cy="80"
                    r="64"
                    fill="none"
                    stroke={segment.color}
                    strokeWidth="17"
                    pathLength="100"
                    strokeDasharray={`${(segment.count / total) * 100} 100`}
                    strokeDashoffset={(-segment.offset / total) * 100}
                    transform="rotate(-90 80 80)"
                  />
                ))}
              </svg>
              <div className="verdict-total">
                <strong>{formatNumber(total)}</strong>
                <span>verdicts</span>
              </div>
            </div>
            <dl className="verdict-legend">
              {segments.map((segment) => (
                <div key={segment.label}>
                  <dt>
                    <i
                      style={{ background: segment.color }}
                      aria-hidden="true"
                    />
                    {segment.label}
                  </dt>
                  <dd>
                    {formatNumber(segment.count)}{" "}
                    <span>({Math.round((segment.count / total) * 100)}%)</span>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}
