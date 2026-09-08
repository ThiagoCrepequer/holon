import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@holon/ui";
import * as React from "react";

import type { ReadinessReport } from "../../workers/observability/readiness.js";
import { Layout } from "../components/layout.js";
import { PageHeader } from "../components/page-header.js";
import { formatDateTimeUtc } from "../utils/format.js";

export interface ReadinessViewProps {
  readonly userEmail?: string | undefined;
  readonly report: ReadinessReport;
}

export const ReadinessView: React.FC<ReadinessViewProps> = ({
  userEmail,
  report,
}) => {
  const probeEntries = [
    {
      name: "D1 Database Ledger",
      desc: "Queries internal relational store (SELECT 1)",
      status: report.checks.d1,
      critical: true,
    },
    {
      name: "Control Plane RPC",
      desc: "Service Binding AdminReadEntrypoint (ping)",
      status: report.checks.rpc,
      critical: true,
    },
    {
      name: "Analytics Engine",
      desc: "Cloudflare Analytics Engine SQL API for telemetry trends",
      status: report.checks.analyticsEngine,
      critical: false,
    },
    {
      name: "Queue Metrics",
      desc: "Cloudflare Queues API monitoring backlog and DLQ",
      status: report.checks.queueMetrics,
      critical: false,
    },
  ];

  return (
    <Layout userEmail={userEmail} currentPath="/readiness">
      <PageHeader
        title="System Readiness"
        description="Availability of the services that power code reviews."
      />

      <Card className="console-panel section-gap">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle>Overall Operational Status</CardTitle>
            <CardDescription className="text-xs text-[var(--text-disabled)] mt-0.5">
              Probe conducted at {formatDateTimeUtc(report.timestamp)}
            </CardDescription>
          </div>
          <Badge
            variant={
              report.status === "healthy"
                ? "success"
                : report.status === "degraded"
                  ? "danger"
                  : "warning"
            }
            size="md"
            dot
          >
            {report.status.toUpperCase()}
          </Badge>
        </CardHeader>
      </Card>

      <Card className="console-panel">
        <CardHeader className="pb-3">
          <CardTitle>Subsystem Dependency Probes</CardTitle>
        </CardHeader>
        <CardContent className="p-0 border-t border-[var(--border)] overflow-hidden rounded-b-xl">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subsystem</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Criticality</TableHead>
                <TableHead className="text-right">Probe State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {probeEntries.map((probe) => (
                <TableRow key={probe.name}>
                  <TableCell className="font-medium text-[var(--text-primary)]">
                    {probe.name}
                  </TableCell>
                  <TableCell className="text-xs text-[var(--text-muted)]">
                    {probe.desc}
                  </TableCell>
                  <TableCell className="text-xs">
                    {probe.critical ? (
                      <span className="font-semibold text-[var(--text-primary)]">
                        Required
                      </span>
                    ) : (
                      <span className="text-[var(--text-disabled)]">
                        Optional
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={
                        probe.status === "healthy"
                          ? "success"
                          : probe.status === "degraded"
                            ? "danger"
                            : "warning"
                      }
                      size="sm"
                      dot
                    >
                      {probe.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Layout>
  );
};
