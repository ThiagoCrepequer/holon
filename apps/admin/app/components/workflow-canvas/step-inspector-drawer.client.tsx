import type { StepExecutionNode } from "@holon/contracts";
import * as React from "react";

export interface StepInspectorDrawerProps {
  readonly step: StepExecutionNode | null;
  readonly onClose: () => void;
  readonly initialTab?: TabKey;
}

type TabKey = "overview" | "attempts" | "input" | "output";

export const StepInspectorDrawer: React.FC<StepInspectorDrawerProps> = ({
  step,
  onClose,
  initialTab,
}) => {
  const [activeTab, setActiveTab] = React.useState<TabKey>(
    initialTab ?? "overview",
  );
  const [copiedTab, setCopiedTab] = React.useState<string | null>(null);

  const prevStepNameRef = React.useRef(step?.stepName);

  // Reset tab when selected step changes
  React.useEffect(() => {
    if (prevStepNameRef.current !== step?.stepName) {
      prevStepNameRef.current = step?.stepName;
      setActiveTab("overview");
    }
  }, [step?.stepName]);

  // Handle Escape key to close
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!step) return null;

  const copyJson = (data: unknown, label: string) => {
    const text = JSON.stringify(data ?? {}, null, 2);
    void navigator.clipboard?.writeText(text);
    setCopiedTab(label);
    setTimeout(() => setCopiedTab(null), 2000);
  };

  const statusVariant =
    step.status === "completed"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
      : step.status === "failed"
        ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
        : "bg-amber-500/10 text-amber-400 border-amber-500/30";

  return (
    <aside
      data-testid="step-inspector-drawer"
      className="w-full sm:w-96 max-w-full border-l border-slate-800 bg-[#111827] flex flex-col z-20 shrink-0 shadow-2xl transition-all h-full"
      aria-label={`Detalhes da etapa ${step.stepName}`}
    >
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {step.phase}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${statusVariant}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full mr-1 ${
                  step.status === "completed"
                    ? "bg-emerald-400"
                    : step.status === "failed"
                      ? "bg-rose-400"
                      : "bg-amber-400 animate-pulse"
                }`}
              />
              {step.status}
            </span>
            {step.attemptsCount > 1 && (
              <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-300 font-mono border border-amber-500/30">
                {step.attemptsCount} att.
              </span>
            )}
          </div>
          <h2 className="text-sm font-semibold text-slate-100 font-mono">
            {step.stepName}
          </h2>
          <p className="text-xs text-slate-400">
            Fase de execução: {step.phase}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar inspetor"
          className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Tabs Nav */}
      <div className="flex border-b border-slate-800 bg-slate-900/40 text-xs shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`flex-1 py-2.5 font-medium text-center transition border-b-2 ${
            activeTab === "overview"
              ? "text-orange-400 border-orange-500 bg-slate-900/60"
              : "text-slate-400 hover:text-slate-200 border-transparent"
          }`}
        >
          Visão Geral
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("attempts")}
          className={`flex-1 py-2.5 font-medium text-center transition border-b-2 ${
            activeTab === "attempts"
              ? "text-orange-400 border-orange-500 bg-slate-900/60"
              : "text-slate-400 hover:text-slate-200 border-transparent"
          }`}
        >
          Tentativas ({step.attempts.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("input")}
          className={`flex-1 py-2.5 font-medium text-center transition border-b-2 ${
            activeTab === "input"
              ? "text-orange-400 border-orange-500 bg-slate-900/60"
              : "text-slate-400 hover:text-slate-200 border-transparent"
          }`}
        >
          Entrada
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("output")}
          className={`flex-1 py-2.5 font-medium text-center transition border-b-2 ${
            activeTab === "output"
              ? "text-orange-400 border-orange-500 bg-slate-900/60"
              : "text-slate-400 hover:text-slate-200 border-transparent"
          }`}
        >
          Retorno
        </button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <div className="space-y-4">
            <div className="bg-slate-900/80 rounded-lg p-3 border border-slate-800">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Tempo de Execução
              </h3>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-400">Duração Total:</span>
                <span className="font-mono font-semibold text-slate-200">
                  {step.totalDurationMs >= 1000
                    ? `${(step.totalDurationMs / 1000).toFixed(2)}s (${step.totalDurationMs} ms)`
                    : `${step.totalDurationMs} ms`}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1">
                <span>Início: {step.firstStartedAt}</span>
              </div>
              {step.lastEndedAt && (
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>Fim: {step.lastEndedAt}</span>
                </div>
              )}
            </div>

            <div className="bg-slate-900/80 rounded-lg p-3 border border-slate-800">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Resumo da Etapa
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">
                    Tentativas Registradas:
                  </span>
                  <span className="font-mono text-slate-200 font-semibold">
                    {step.attemptsCount}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Fase:</span>
                  <span className="font-mono text-slate-200">{step.phase}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Código de Erro:</span>
                  <span className="font-mono text-slate-300">
                    {step.errorCode ?? "Nenhum (Sucesso)"}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Idempotência:</span>
                  <span className="font-mono text-slate-300">
                    step.do memoization
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ATTEMPTS TAB */}
        {activeTab === "attempts" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Histórico de tentativas:</span>
              <span className="text-[10px] text-amber-400 font-mono">
                {step.attempts.length} tentativa(s)
              </span>
            </div>
            {step.attempts.length === 0 ? (
              <div className="text-xs text-slate-500 py-4 text-center">
                Nenhuma tentativa individual registrada.
              </div>
            ) : (
              step.attempts.map((att) => (
                <div
                  key={att.attempt}
                  className="p-3 bg-slate-900/90 rounded-lg border border-slate-800 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">
                      Tentativa #{att.attempt}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        att.status === "completed"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : att.status === "failed"
                            ? "bg-rose-500/20 text-rose-300"
                            : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {att.status}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 flex justify-between">
                    <span>Duração:</span>
                    <span className="text-slate-300">
                      {att.durationMs !== null
                        ? `${att.durationMs} ms`
                        : "Em andamento..."}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 truncate">
                    Início: {att.startedAt}
                  </div>
                  {att.endedAt && (
                    <div className="text-[10px] font-mono text-slate-500 truncate">
                      Fim: {att.endedAt}
                    </div>
                  )}
                  {att.waitBeforeRetryMs !== null && (
                    <div className="text-[10px] text-amber-400/80 font-mono">
                      Espera antes de retry: {att.waitBeforeRetryMs} ms
                    </div>
                  )}
                  {att.errorCode && (
                    <div className="text-[11px] text-rose-400 font-mono bg-rose-950/40 p-1.5 rounded border border-rose-900/40 mt-1">
                      Erro: {att.errorCode}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* INPUT JSON TAB */}
        {activeTab === "input" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Payload sanitizado de entrada:</span>
              <button
                type="button"
                onClick={() => copyJson(step.sanitizedInput, "input")}
                className="text-orange-400 hover:text-orange-300 text-[11px] transition"
              >
                {copiedTab === "input" ? "✓ Copiado!" : "Copiar JSON"}
              </button>
            </div>
            <pre className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-[480px] leading-snug">
              {step.sanitizedInput
                ? JSON.stringify(step.sanitizedInput, null, 2)
                : "// Nenhum dado de entrada sanitizado"}
            </pre>
          </div>
        )}

        {/* OUTPUT JSON TAB */}
        {activeTab === "output" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Payload sanitizado de retorno:</span>
              <button
                type="button"
                onClick={() => copyJson(step.sanitizedOutput, "output")}
                className="text-orange-400 hover:text-orange-300 text-[11px] transition"
              >
                {copiedTab === "output" ? "✓ Copiado!" : "Copiar JSON"}
              </button>
            </div>
            <pre className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-[480px] leading-snug">
              {step.sanitizedOutput
                ? JSON.stringify(step.sanitizedOutput, null, 2)
                : "// Nenhum dado de retorno sanitizado"}
            </pre>
          </div>
        )}
      </div>
    </aside>
  );
};

export default StepInspectorDrawer;
