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
      desc: "Service Binding AdminReadEntrypoint (pingV1)",
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
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-zinc-950">
          System Readiness
        </h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Real-time probe status of backend dependencies and operational
          infrastructure
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle>Overall Operational Status</CardTitle>
            <CardDescription className="text-xs text-zinc-400 mt-0.5">
              Probe conducted at {new Date(report.timestamp).toLocaleString()}
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Subsystem Dependency Probes</CardTitle>
        </CardHeader>
        <CardContent>
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
                  <TableCell className="font-medium text-zinc-900">
                    {probe.name}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500">
                    {probe.desc}
                  </TableCell>
                  <TableCell className="text-xs">
                    {probe.critical ? (
                      <span className="font-semibold text-zinc-900">
                        Required
                      </span>
                    ) : (
                      <span className="text-zinc-400">Optional</span>
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
