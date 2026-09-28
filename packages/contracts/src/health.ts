import { z } from "zod";

export const healthCheckReportSchema = z.strictObject({
  checks: z.strictObject({
    aiGateway: z.boolean(),
    database: z.boolean(),
    executor: z.boolean(),
  }),
  diagnostics: z.array(z.string().min(1).max(300)).optional(),
  status: z.enum(["ok", "degraded", "error"]),
  timestamp: z.string().datetime(),
  version: z.string().min(1).max(50),
});

export type HealthCheckReport = z.infer<typeof healthCheckReportSchema>;
