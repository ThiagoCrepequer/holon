import { lazy, Suspense } from "react";
import * as React from "react";

import { useHydrated } from "../../hooks/use-hydrated.js";
import type { StepInspectorDrawerProps } from "./step-inspector-drawer.client.js";

const StepInspectorDrawerClient = lazy(
  () => import("./step-inspector-drawer.client.js"),
);

export type { StepInspectorDrawerProps };

export function StepInspectorDrawer(props: StepInspectorDrawerProps) {
  const hydrated = useHydrated();
  if (!props.step) return null;
  if (!hydrated) {
    return (
      <aside
        data-testid="step-inspector-drawer"
        className="w-96 border-l border-slate-800 bg-[#111827] flex flex-col z-20 shrink-0 shadow-2xl h-full"
        aria-label={`Detalhes da etapa ${props.step.stepName}`}
      >
        <div className="p-4 border-b border-slate-800">
          <span className="text-sm font-semibold text-slate-100 font-mono">
            {props.step.stepName}
          </span>
        </div>
      </aside>
    );
  }
  return (
    <Suspense fallback={null}>
      <StepInspectorDrawerClient {...props} />
    </Suspense>
  );
}
