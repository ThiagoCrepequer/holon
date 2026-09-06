import { lazy, Suspense } from "react";
import * as React from "react";

import { useHydrated } from "../../hooks/use-hydrated.js";
import type { WorkflowCanvasProps } from "./workflow-canvas.client.js";

const WorkflowCanvasClient = lazy(() => import("./workflow-canvas.client.js"));

export type { WorkflowCanvasProps };

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  const hydrated = useHydrated();
  if (!hydrated) {
    return (
      <div
        data-testid="workflow-canvas-container"
        className={`border border-slate-800 rounded-xl bg-slate-950 overflow-hidden flex flex-col ${props.className ?? ""}`}
      >
        <div className="h-12 border-b border-slate-800 bg-[#111827] px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              <span>Workflow DAG &amp; Telemetria</span>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 text-slate-400 border border-slate-700">
              {props.stepExecutions.length} step(s)
            </span>
          </div>
        </div>
        <div
          data-testid="canvas-view-area"
          className="relative flex-1 min-h-[440px] bg-[#0a0f1d] p-8 flex items-center justify-center"
        >
          {props.stepExecutions.length === 0 ? (
            <p className="text-sm font-medium text-slate-500">
              Nenhuma execução de etapa registrada para este run.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 justify-center">
              {props.stepExecutions.map((s) => (
                <div
                  key={s.stepName}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900/80 text-xs font-mono text-slate-200"
                >
                  {s.stepName}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <Suspense
      fallback={
        <div
          data-testid="workflow-canvas-container"
          className="border border-slate-800 rounded-xl bg-slate-950 min-h-[440px] animate-pulse"
        />
      }
    >
      <WorkflowCanvasClient {...props} />
    </Suspense>
  );
}
