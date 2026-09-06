import type { StepExecutionNode } from "@holon/contracts";
import * as React from "react";

export interface WorkflowCanvasProps {
  readonly stepExecutions: readonly StepExecutionNode[];
  readonly selectedStepName: string | null;
  readonly onSelectStep: (stepName: string) => void;
  readonly className?: string;
  readonly initialViewMode?: CanvasViewMode;
}

type CanvasViewMode = "canvas" | "timeline";

const PHASES = [
  "admission",
  "preparation",
  "analysis",
  "publication",
  "cleanup",
] as const;

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
  const [zoom, setZoom] = React.useState(1.0);

  const handleZoom = (delta: number) => {
    setZoom((prev) =>
      Math.min(Math.max(Number((prev + delta).toFixed(1)), 0.5), 2.0),
    );
  };

  const handleResetZoom = () => setZoom(1.0);
  const handleFit = () => setZoom(0.85);

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

  // Compute topological DAG node positions based on phase pipeline
  const { nodePositions, canvasWidth, canvasHeight } = React.useMemo(() => {
    const positions = new Map<string, NodePosition>();
    const CARD_WIDTH = 224;
    const CARD_HEIGHT = 100;
    const COL_GAP = 76;
    const ROW_GAP = 30;
    const START_X = 40;
    const START_Y = 60;

    // Group steps by known phase, preserving sequence order
    const phaseStepsMap = new Map<string, StepExecutionNode[]>();
    for (const p of PHASES) {
      phaseStepsMap.set(p, []);
    }
    for (const step of stepsSorted) {
      const list = phaseStepsMap.get(step.phase) ?? [];
      list.push(step);
      phaseStepsMap.set(step.phase, list);
    }

    let maxRows = 1;
    let globalIndex = 0;

    PHASES.forEach((phase, colIdx) => {
      const stepsInPhase = phaseStepsMap.get(phase) ?? [];
      if (stepsInPhase.length > maxRows) {
        maxRows = stepsInPhase.length;
      }

      stepsInPhase.forEach((step, rowIdx) => {
        const x = START_X + colIdx * (CARD_WIDTH + COL_GAP);
        const y = START_Y + rowIdx * (CARD_HEIGHT + ROW_GAP);
        positions.set(step.stepName, {
          height: CARD_HEIGHT,
          index: globalIndex++,
          step,
          width: CARD_WIDTH,
          x,
          y,
        });
      });
    });

    const totalWidth = Math.max(
      1100,
      START_X * 2 + PHASES.length * (CARD_WIDTH + COL_GAP),
    );
    const totalHeight = Math.max(
      460,
      START_Y + maxRows * (CARD_HEIGHT + ROW_GAP) + 40,
    );

    return {
      canvasHeight: totalHeight,
      canvasWidth: totalWidth,
      nodePositions: positions,
    };
  }, [stepsSorted]);

  // Compute SVG edge curves between sequential steps
  const edges = React.useMemo(() => {
    const list: Array<{
      id: string;
      d: string;
      status: string;
    }> = [];

    for (let i = 0; i < stepsSorted.length - 1; i++) {
      const source = stepsSorted[i];
      const target = stepsSorted[i + 1];
      if (!source || !target) continue;

      const pos1 = nodePositions.get(source.stepName);
      const pos2 = nodePositions.get(target.stepName);
      if (!pos1 || !pos2) continue;

      let d = "";
      if (pos1.x === pos2.x) {
        // Vertical connection inside same phase column
        const startX = pos1.x + pos1.width / 2;
        const startY = pos1.y + pos1.height;
        const endX = pos2.x + pos2.width / 2;
        const endY = pos2.y;
        const dy = Math.max(15, (endY - startY) / 2);
        d = `M ${startX} ${startY} C ${startX} ${startY + dy}, ${endX} ${endY - dy}, ${endX} ${endY}`;
      } else {
        // Horizontal / cross-column connection
        const startX = pos1.x + pos1.width;
        const startY = pos1.y + pos1.height / 2;
        const endX = pos2.x;
        const endY = pos2.y + pos2.height / 2;
        const dx = Math.max(30, (endX - startX) / 2);
        d = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;
      }

      list.push({
        d,
        id: `${source.stepName}->${target.stepName}`,
        status: target.status,
      });
    }

    return list;
  }, [stepsSorted, nodePositions]);

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
      `}</style>

      {/* Canvas Top Bar */}
      <div className="h-12 border-b border-slate-800 bg-[#111827] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <span className="w-2 h-2 rounded-full bg-orange-500" />
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
            className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
              viewMode === "canvas"
                ? "bg-orange-600 text-white shadow-sm"
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
            className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
              viewMode === "timeline"
                ? "bg-orange-600 text-white shadow-sm"
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
        <div
          data-testid="canvas-view-area"
          className="relative flex-1 min-h-[460px] overflow-auto bg-[#0a0f1d] p-6 flex items-center justify-center select-none"
          style={{
            backgroundImage:
              "radial-gradient(#1e293b 1.2px, transparent 1.2px)",
            backgroundSize: "24px 24px",
          }}
        >
          {/* Zoom Controls Overlay */}
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-1 bg-slate-900/90 border border-slate-700/80 p-1 rounded-lg shadow-xl backdrop-blur-sm text-xs">
            <button
              type="button"
              onClick={() => handleZoom(-0.1)}
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
              data-testid="canvas-viewport"
              className="relative transition-transform duration-150 origin-center"
              style={{
                height: `${canvasHeight}px`,
                transform: `scale(${zoom})`,
                width: `${canvasWidth}px`,
              }}
            >
              {/* Topological Phase Column Headers */}
              {PHASES.map((phase, idx) => {
                const colX = 40 + idx * (224 + 76);
                return (
                  <div
                    key={phase}
                    style={{ left: `${colX}px`, top: "14px" }}
                    className="absolute flex items-center gap-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-500 bg-slate-900/60 px-2 py-0.5 rounded border border-slate-800/80"
                  >
                    <span>{phaseIcon(phase)}</span>
                    <span>{phase}</span>
                  </div>
                );
              })}

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
                    id="gradSuccess"
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="0%"
                  >
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.85" />
                    <stop
                      offset="100%"
                      stopColor="#06b6d4"
                      stopOpacity="0.85"
                    />
                  </linearGradient>
                  <marker
                    id="arrow-success"
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
                    id="arrow-active"
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
                    id="arrow-failed"
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
                    id="arrow-default"
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
                        ? "url(#gradSuccess)"
                        : "#475569";

                  const marker = isFailed
                    ? "url(#arrow-failed)"
                    : isRunning
                      ? "url(#arrow-active)"
                      : isCompleted
                        ? "url(#arrow-success)"
                        : "url(#arrow-default)";

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
                    style={{
                      height: `${pos.height}px`,
                      left: `${pos.x}px`,
                      top: `${pos.y}px`,
                      width: `${pos.width}px`,
                    }}
                    className={`absolute text-left bg-slate-900/95 border rounded-xl p-3 shadow-lg cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl z-10 ${
                      isSelected
                        ? "border-orange-500 ring-2 ring-orange-500/40 shadow-orange-500/10"
                        : "border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-md bg-slate-800 flex items-center justify-center text-[10px] font-mono text-slate-300">
                          {pos.index + 1}
                        </span>
                        <span className="text-xs">{phaseIcon(step.phase)}</span>
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
                      className="text-xs font-semibold text-slate-100 font-mono truncate"
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
          )}
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
                        isSelected ? "bg-orange-500/10" : ""
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
