import type { StepExecutionNode } from "@holon/contracts";
import * as React from "react";

import { useCanvasNavigation } from "./use-canvas-navigation.client.js";

export interface WorkflowCanvasProps {
  readonly stepExecutions: readonly StepExecutionNode[];
  readonly selectedStepName: string | null;
  readonly onSelectStep: (stepName: string) => void;
  readonly className?: string;
  readonly initialViewMode?: CanvasViewMode;
}

type CanvasViewMode = "canvas" | "timeline";

function phaseIcon(phase: string): string {
  switch (phase) {
    case "admission":
      return "⚡";
    case "preparation":
      return "📦";
    case "analysis":
      return "🧠";
    case "publication":
      return "📋";
    case "cleanup":
      return "⏰";
    default:
      return "⚙️";
  }
}

function stepStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
    case "failed":
      return "text-rose-400 border-rose-500/30 bg-rose-500/10";
    case "running":
      return "text-amber-400 border-amber-500/30 bg-amber-500/10 animate-pulse";
    default:
      return "text-slate-400 border-slate-700 bg-slate-800/40";
  }
}

interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
  step: StepExecutionNode;
  index: number;
}

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({
  stepExecutions,
  selectedStepName,
  onSelectStep,
  className = "",
  initialViewMode,
}) => {
  const [viewMode, setViewMode] = React.useState<CanvasViewMode>(
    initialViewMode ?? "canvas",
  );
  const stepsSorted = React.useMemo(() => {
    return stepExecutions.toSorted((a, b) => {
      if (a.stepOrder !== undefined && b.stepOrder !== undefined) {
        return a.stepOrder - b.stepOrder;
      }
      return (
        new Date(a.firstStartedAt).getTime() -
        new Date(b.firstStartedAt).getTime()
      );
    });
  }, [stepExecutions]);

  // Keep actual execution order across phases; no horizontal phase lanes.
  const { nodePositions, canvasWidth, canvasHeight } = React.useMemo(() => {
    const positions = new Map<string, NodePosition>();
    let y = 24;
    for (const [index, step] of stepsSorted.entries()) {
      if (index === 0 || stepsSorted[index - 1]?.phase !== step.phase) y += 36;
      positions.set(step.stepName, {
        x: 24,
        y,
        width: 320,
        height: 112,
        step,
        index,
      });
      y += 148;
    }
    return { nodePositions: positions, canvasWidth: 368, canvasHeight: y + 12 };
  }, [stepsSorted]);
  const navigation = useCanvasNavigation(
    canvasWidth,
    canvasHeight,
    viewMode === "canvas",
  );
  const { zoom } = navigation;
  const handleZoom = navigation.zoomBy;
  const handleResetZoom = navigation.reset;
  const handleFit = navigation.fit;
  const svgId = React.useId().replaceAll(":", "");

  // Connections always follow the vertical execution sequence.
  const edges = React.useMemo(() => {
    const positions = Array.from(nodePositions.values());
    return positions.slice(1).map((target, index) => {
      const source = positions[index]!;
      const x = source.x + source.width / 2;
      const startY = source.y + source.height;
      const endY = target.y;
      const bend = (endY - startY) / 2;
      return {
        id: `${source.step.stepName}->${target.step.stepName}`,
        d: `M ${x} ${startY} C ${x} ${startY + bend}, ${x} ${endY - bend}, ${x} ${endY}`,
        status: target.step.status,
      };
    });
  }, [nodePositions]);

  return (
    <div
      data-testid="workflow-canvas-container"
      className={`border border-slate-800 rounded-xl bg-slate-950 overflow-hidden flex flex-col ${className}`}
    >
      <style>{`
        @keyframes flowDash {
          to {
            stroke-dashoffset: -16;
          }
        }
        .flow-line {
          stroke-dasharray: 6 6;
          animation: flowDash 1.4s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) { .flow-line { animation: none; } }
      `}</style>

      {/* Canvas Top Bar */}
      <div className="min-h-12 py-2 gap-2 flex-wrap border-b border-slate-800 bg-[#111827] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
            <span>Workflow DAG & Telemetria</span>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 text-slate-400 border border-slate-700">
            {stepExecutions.length} step(s)
          </span>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => setViewMode("canvas")}
            aria-pressed={viewMode === "canvas"}
            className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
              viewMode === "canvas"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
              />
            </svg>
            DAG Canvas
          </button>
          <button
            type="button"
            onClick={() => setViewMode("timeline")}
            aria-pressed={viewMode === "timeline"}
            className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
              viewMode === "timeline"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 6h16M4 10h16M4 14h16M4 18h16"
              />
            </svg>
            Timeline
          </button>
        </div>
      </div>

      {/* CANVAS VIEW */}
      {viewMode === "canvas" && (
        <div className="flex flex-col min-h-0">
          <div className="flex flex-wrap items-center justify-between gap-2 p-2 border-b border-slate-800">
            {/* Zoom Controls Overlay */}
            <div className="shrink-0 z-20 flex items-center gap-1 bg-slate-900/90 border border-slate-700/80 p-1 rounded-lg  text-xs">
              <button
                type="button"
                onClick={() => handleZoom(-0.1)}
                disabled={zoom <= 0.05 || !stepExecutions.length}
                aria-label="Zoom out"
                className="w-7 h-7 rounded hover:bg-slate-800 text-slate-300 flex items-center justify-center font-bold transition"
              >
                −
              </button>
              <span className="font-mono px-2 text-slate-400 text-[11px]">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => handleZoom(0.1)}
                disabled={zoom >= 2 || !stepExecutions.length}
                aria-label="Zoom in"
                className="w-7 h-7 rounded hover:bg-slate-800 text-slate-300 flex items-center justify-center font-bold transition"
              >
                +
              </button>
              <div className="h-3.5 w-[1px] bg-slate-700 mx-1" />
              <button
                type="button"
                onClick={handleResetZoom}
                className="px-2 py-1 rounded hover:bg-slate-800 text-[11px] text-slate-300 transition"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={handleFit}
                className="px-2 py-1 rounded hover:bg-slate-800 text-[11px] text-slate-300 transition"
              >
                Ajustar
              </button>
            </div>

            <span className="text-xs text-slate-400 px-2">
              Arraste para navegar · Role para explorar
            </span>
          </div>
          <div
            ref={navigation.area}
            {...navigation.handlers}
            data-testid="canvas-view-area"
            tabIndex={0}
            role="region"
            aria-label="Workflow: arraste ou use as teclas de seta para navegar"
            className={`relative h-[min(65vh,720px)] min-h-[280px] overflow-auto overscroll-contain bg-[#0a0f1d] select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${navigation.dragging ? "cursor-grabbing" : "cursor-grab"}`}
            style={{
              backgroundImage: "radial-gradient(#1e293b 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          >
            {stepExecutions.length === 0 ? (
              <div className="text-center text-slate-500 py-16">
                <p className="text-sm font-medium">
                  Nenhuma execução de etapa registrada para este run.
                </p>
                <p className="text-xs mt-1">
                  Os passos são sincronizados pelo Durable Object conforme o
                  workflow avança.
                </p>
              </div>
            ) : (
              <div
                className="relative"
                data-testid="canvas-scroll-content"
                style={{
                  width: navigation.scaledWidth,
                  height: navigation.scaledHeight,
                }}
              >
                <div
                  data-testid="canvas-viewport"
                  className="absolute origin-top-left"
                  style={{
                    height: canvasHeight,
                    width: canvasWidth,
                    left: navigation.offsetX,
                    top: 0,
                    transform: `scale(${zoom})`,
                  }}
                >
                  {Array.from(nodePositions.values())
                    .filter(
                      (pos) =>
                        pos.index === 0 ||
                        stepsSorted[pos.index - 1]?.phase !== pos.step.phase,
                    )
                    .map((pos) => (
                      <div
                        key={pos.step.stepName}
                        style={{ left: pos.x, top: pos.y - 30 }}
                        className="absolute text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400"
                      >
                        {phaseIcon(pos.step.phase)} {pos.step.phase}
                      </div>
                    ))}

                  {/* Dynamic SVG Connections Layer */}
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none z-0"
                    style={{
                      height: `${canvasHeight}px`,
                      width: `${canvasWidth}px`,
                    }}
                  >
                    <defs>
                      <linearGradient
                        id={`${svgId}-gradSuccess`}
                        gradientUnits="userSpaceOnUse"
                        x1="0%"
                        y1="0%"
                        x2={canvasWidth}
                        y2={canvasHeight}
                      >
                        <stop
                          offset="0%"
                          stopColor="#10b981"
                          stopOpacity="0.85"
                        />
                        <stop
                          offset="100%"
                          stopColor="#06b6d4"
                          stopOpacity="0.85"
                        />
                      </linearGradient>
                      <marker
                        id={`${svgId}-arrow-success`}
                        viewBox="0 0 10 10"
                        refX="6"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 8 5 L 0 9 z" fill="#06b6d4" />
                      </marker>
                      <marker
                        id={`${svgId}-arrow-active`}
                        viewBox="0 0 10 10"
                        refX="6"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 8 5 L 0 9 z" fill="#f59e0b" />
                      </marker>
                      <marker
                        id={`${svgId}-arrow-failed`}
                        viewBox="0 0 10 10"
                        refX="6"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 8 5 L 0 9 z" fill="#f43f5e" />
                      </marker>
                      <marker
                        id={`${svgId}-arrow-default`}
                        viewBox="0 0 10 10"
                        refX="6"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 8 5 L 0 9 z" fill="#475569" />
                      </marker>
                    </defs>

                    {edges.map((edge) => {
                      const isRunning = edge.status === "running";
                      const isFailed = edge.status === "failed";
                      const isCompleted = edge.status === "completed";

                      const stroke = isFailed
                        ? "#f43f5e"
                        : isRunning
                          ? "#f59e0b"
                          : isCompleted
                            ? `url(#${svgId}-gradSuccess)`
                            : "#475569";

                      const marker = isFailed
                        ? `url(#${svgId}-arrow-failed)`
                        : isRunning
                          ? `url(#${svgId}-arrow-active)`
                          : isCompleted
                            ? `url(#${svgId}-arrow-success)`
                            : `url(#${svgId}-arrow-default)`;

                      return (
                        <path
                          key={edge.id}
                          data-testid={`flow-path-${edge.id}`}
                          d={edge.d}
                          fill="none"
                          stroke={stroke}
                          strokeWidth={isRunning ? 2.5 : 2}
                          markerEnd={marker}
                          className={isRunning ? "flow-line" : ""}
                        />
                      );
                    })}
                  </svg>

                  {/* Positioned Node Cards */}
                  {Array.from(nodePositions.values()).map((pos) => {
                    const step = pos.step;
                    const isSelected = selectedStepName === step.stepName;
                    const statusClass = stepStatusColor(step.status);

                    return (
                      <button
                        key={step.stepName}
                        type="button"
                        data-testid={`canvas-node-${step.stepName}`}
                        onClick={() => onSelectStep(step.stepName)}
                        aria-pressed={isSelected}
                        onFocus={(event) => {
                          if (event.currentTarget.matches(":focus-visible"))
                            event.currentTarget.scrollIntoView?.({
                              block: "nearest",
                              inline: "nearest",
                            });
                        }}
                        style={{
                          height: `${pos.height}px`,
                          left: `${pos.x}px`,
                          top: `${pos.y}px`,
                          width: `${pos.width}px`,
                        }}
                        className={`absolute text-left bg-slate-900/95 border rounded-xl p-3 shadow-lg cursor-pointer transition-colors hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] z-10 ${
                          isSelected
                            ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/40"
                            : "border-slate-800 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="w-5 h-5 rounded-md bg-slate-800 flex items-center justify-center text-[10px] font-mono text-slate-300">
                              {pos.index + 1}
                            </span>
                            <span className="text-xs">
                              {phaseIcon(step.phase)}
                            </span>
                            <span className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">
                              {step.phase}
                            </span>
                          </div>
                          <span
                            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${statusClass}`}
                          >
                            {step.status}
                          </span>
                        </div>

                        <h4
                          title={step.stepName}
                          className="text-xs font-semibold text-slate-100 font-mono break-all leading-4 line-clamp-2"
                        >
                          {step.stepName}
                        </h4>

                        <div className="mt-2 flex items-center justify-between text-[10px] font-mono border-t border-slate-800/80 pt-1.5 text-slate-400">
                          <span>
                            {step.attemptsCount > 1 ? (
                              <span className="text-amber-400 font-medium">
                                {step.attemptsCount} att.
                              </span>
                            ) : (
                              "1 att."
                            )}
                          </span>
                          <span className="bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 text-slate-300">
                            {step.totalDurationMs >= 1000
                              ? `${(step.totalDurationMs / 1000).toFixed(2)}s`
                              : `${step.totalDurationMs}ms`}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TIMELINE VIEW */}
      {viewMode === "timeline" && (
        <div data-testid="timeline-view-area" className="p-4 overflow-x-auto">
          {stepExecutions.length === 0 ? (
            <div className="text-center text-slate-500 py-12 text-sm">
              Nenhuma etapa registrada nesta execução.
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">Etapa</th>
                  <th className="py-2.5 px-3">Fase</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Tentativas</th>
                  <th className="py-2.5 px-3">Duração</th>
                  <th className="py-2.5 px-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {stepsSorted.map((step, idx) => {
                  const isSelected = selectedStepName === step.stepName;
                  const statusClass = stepStatusColor(step.status);

                  return (
                    <tr
                      key={step.stepName}
                      className={`hover:bg-slate-900/60 transition ${
                        isSelected ? "bg-[var(--accent)]/10" : ""
                      }`}
                    >
                      <td className="py-2.5 px-3 font-mono text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-200">
                        {step.stepName}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400 font-mono">
                        {step.phase}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-1.5 py-0.5 text-[10px] font-mono rounded border ${statusClass}`}
                        >
                          {step.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">
                        {step.attemptsCount > 1 ? (
                          <span className="text-amber-400 font-medium">
                            {step.attemptsCount}
                          </span>
                        ) : (
                          "1"
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">
                        {step.totalDurationMs >= 1000
                          ? `${(step.totalDurationMs / 1000).toFixed(2)}s`
                          : `${step.totalDurationMs}ms`}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => onSelectStep(step.stepName)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition"
                        >
                          Inspecionar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkflowCanvas;
