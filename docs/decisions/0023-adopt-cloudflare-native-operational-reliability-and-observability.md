# ADR-0023: Adopt Cloudflare-Native Operational Reliability and Observability

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: Holon Core Architecture Team
- **Consulted**: Cloudflare Workers & Workflows Platform Guidelines, AGENTS.md

## Context

Holon performs automated pull request reviews using a distributed Cloudflare-native architecture:

- Cloudflare Workflows orchestrates lifecycle steps across execution checkpoints.
- Cloudflare Sandbox container executes isolated repository git operations and structural analysis.
- Durable Objects (SQLite per PR) persist atomic state transitions, finding fingerprints, and causal consensus.
- AI Gateway routes LLM inference with prompt guards.

As review volumes and multi-shard PR complexity increase, operational visibility becomes essential. Specifically:

1. **Latency & Step Profiling**: Measuring duration across queue waiting, repository preparation, shard analysis, and GitHub publication.
2. **Token & Cost Accounting**: Measuring token consumption (input, output, reasoning) and computing deterministic costs without relying on external SaaS vendors.
3. **SLO Verification**: Detecting breaches in queue latency, run duration, and excessive tool usage.
4. **Strict Zero Data Leakage**: In accordance with `AGENTS.md`, logs and telemetry must never contain repository diffs, code excerpts, prompts, tokens, private keys, or raw stack traces.
5. **Deep Health Reporting**: Providing structured readiness probes (`/healthz`) for platform health verification.

## Decision

We adopt a multi-tier, Cloudflare-native operational telemetry architecture:

1. **Contracts & Schemas (`@holon/contracts`)**:
   - Strictly typed Zod contracts for `stepTimingSchema`, `tokenAccountingSchema`, `costAccountingSchema`, `runTelemetrySchema`, and `healthCheckReportSchema`.
2. **Pure Domain Cost & SLO Engines (`@holon/domain`)**:
   - `calculateInferenceCost`: pure deterministic calculation mapping token volumes to model pricing tables (e.g. DeepSeek-R1, Claude 3.5 Sonnet, GPT-4o mini, and conservative defaults).
   - `evaluateRunSlo`: pure evaluation checking queue wait thresholds (<30s), total duration (<3m), tool call limits, and terminal state health.
3. **Telemetry Ports & Emitters (`@holon/application` & `apps/control-plane`)**:
   - `TelemetryEmitter` interface in application ports.
   - `AnalyticsEngineTelemetryEmitter`: writes structured data points to Cloudflare Workers Analytics Engine (`env.ANALYTICS_ENGINE`) without blocking request cycles.
   - `StructuredLogTelemetryEmitter`: outputs sanitized structured JSON logs with deterministic event IDs and zero payload leakage.
   - `CompositeTelemetryEmitter`: dispatches telemetry to multiple sinks with error isolation.
4. **Durable Ledger Persistence (`apps/control-plane`)**:
   - Migration 7 creates `run_telemetry` table in Durable Object SQLite to query historical PR run metrics.
5. **Safe Offline Incident Replay (`@holon/evaluation`)**:
   - `replayIncidentTelemetry`: verifies recorded telemetry offline, recalculates costs, detects timing inconsistencies, and checks SLO compliance without any network side effects.
6. **Deep Healthcheck Probe (`GET /healthz`)**:
   - Reports operational status of database (DO binding), AI Gateway credentials, and executor sandbox.

## Consequences

### Positive

- Real-time time-series telemetry available in Cloudflare Analytics Engine dashboards and SQL queries.
- Zero external observability vendor dependencies or recurring egress costs.
- 100% adherence to zero-leakage security boundary.
- Transparent cost and token accounting for every PR review.
- Offline replayability allows debugging incident regressions without GitHub interaction.

### Neutral / Negative

- Durable Object SQLite stores an additional telemetry record per run (bounded schema).
