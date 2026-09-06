import type { StepExecutionNode } from "@holon/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StepInspectorDrawer } from "../app/components/workflow-canvas/step-inspector-drawer.client.js";
import { WorkflowCanvas } from "../app/components/workflow-canvas/workflow-canvas.client.js";

const mockStepExecutions: StepExecutionNode[] = [
  {
    attempts: [
      {
        attempt: 1,
        durationMs: 18,
        endedAt: "2026-09-04T12:00:00.018Z",
        errorCode: null,
        startedAt: "2026-09-04T12:00:00.000Z",
        status: "completed",
        waitBeforeRetryMs: null,
      },
    ],
    attemptsCount: 1,
    errorCode: null,
    firstStartedAt: "2026-09-04T12:00:00.000Z",
    lastEndedAt: "2026-09-04T12:00:00.018Z",
    phase: "admission",
    sanitizedInput: { runId: "run-123" },
    sanitizedOutput: { outcome: "claimed", supersededCount: 0 },
    status: "completed",
    stepName: "claim-run",
    totalDurationMs: 18,
  },
  {
    attempts: [
      {
        attempt: 1,
        durationMs: 2000,
        endedAt: "2026-09-04T12:00:03.000Z",
        errorCode: "ModelRateLimitError",
        startedAt: "2026-09-04T12:00:01.000Z",
        status: "failed",
        waitBeforeRetryMs: 1000,
      },
      {
        attempt: 2,
        durationMs: 1500,
        endedAt: "2026-09-04T12:00:05.500Z",
        errorCode: null,
        startedAt: "2026-09-04T12:00:04.000Z",
        status: "completed",
        waitBeforeRetryMs: null,
      },
    ],
    attemptsCount: 2,
    errorCode: null,
    firstStartedAt: "2026-09-04T12:00:01.000Z",
    lastEndedAt: "2026-09-04T12:00:05.500Z",
    phase: "analysis",
    sanitizedInput: { modelRoute: "deepseek-chat", structuralFilesCount: 3 },
    sanitizedOutput: {
      findingsCount: 1,
      promptTruncated: false,
      summary: "Defect found",
    },
    status: "completed",
    stepName: "analyze-review",
    totalDurationMs: 3500,
  },
];

afterEach(cleanup);

describe("WorkflowCanvas Component", () => {
  it("renders steps in DAG canvas and switches to timeline", () => {
    const onSelectStep = vi.fn();
    render(
      <WorkflowCanvas
        stepExecutions={mockStepExecutions}
        selectedStepName={null}
        onSelectStep={onSelectStep}
      />,
    );

    expect(screen.getByText("Workflow DAG & Telemetria")).toBeDefined();
    expect(screen.getByText("2 step(s)")).toBeDefined();

    // Node for claim-run
    const claimNode = screen.getByTestId("canvas-node-claim-run");
    expect(claimNode).toBeDefined();
    expect(claimNode.textContent).toContain("claim-run");
    expect(claimNode.textContent).toContain("admission");

    // Node for analyze-review
    const analyzeNode = screen.getByTestId("canvas-node-analyze-review");
    expect(analyzeNode).toBeDefined();
    expect(analyzeNode.textContent).toContain("analyze-review");
    expect(analyzeNode.textContent).toContain("2 att.");

    // Clicking a node
    fireEvent.click(analyzeNode);
    expect(onSelectStep).toHaveBeenCalledWith("analyze-review");

    // Switch to timeline view
    const timelineBtn = screen.getByRole("button", { name: /Timeline/i });
    fireEvent.click(timelineBtn);

    expect(screen.getByTestId("timeline-view-area")).toBeDefined();
    expect(screen.getByText("Etapa")).toBeDefined();
  });

  it("renders topological DAG SVG connections and phase badges", () => {
    const { container } = render(
      <WorkflowCanvas
        stepExecutions={mockStepExecutions}
        selectedStepName="claim-run"
        onSelectStep={() => {}}
      />,
    );

    // SVG elements
    const svgEl = container.querySelector("svg");
    expect(svgEl).toBeDefined();
    const paths = container.querySelectorAll("svg path");
    expect(paths.length).toBeGreaterThan(0);

    // Phase headers
    expect(screen.getAllByText("admission").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("preparation")).toBeDefined();
    expect(screen.getAllByText("analysis").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("publication")).toBeDefined();
    expect(screen.getByText("cleanup")).toBeDefined();

    // Node selection ring styling
    const claimNode = screen.getByTestId("canvas-node-claim-run");
    expect(claimNode.className).toContain("ring-2 ring-orange-500");
  });

  it("handles zoom controls", () => {
    render(
      <WorkflowCanvas
        stepExecutions={mockStepExecutions}
        selectedStepName={null}
        onSelectStep={() => {}}
      />,
    );

    expect(screen.getByText("100%")).toBeDefined();

    const zoomInBtn = screen.getByRole("button", { name: "Zoom in" });
    fireEvent.click(zoomInBtn);
    expect(screen.getByText("110%")).toBeDefined();

    const zoomOutBtn = screen.getByRole("button", { name: "Zoom out" });
    fireEvent.click(zoomOutBtn);
    expect(screen.getByText("100%")).toBeDefined();

    const resetBtn = screen.getByRole("button", { name: "Reset" });
    fireEvent.click(resetBtn);
    expect(screen.getByText("100%")).toBeDefined();

    const fitBtn = screen.getByRole("button", { name: "Ajustar" });
    fireEvent.click(fitBtn);
    expect(screen.getByText("85%")).toBeDefined();

    // Test zoom clamping
    for (let i = 0; i < 15; i++) {
      fireEvent.click(zoomInBtn);
    }
    expect(screen.getByText("200%")).toBeDefined();

    for (let i = 0; i < 20; i++) {
      fireEvent.click(zoomOutBtn);
    }
    expect(screen.getByText("50%")).toBeDefined();
  });

  it("renders empty state when no step executions exist", () => {
    render(
      <WorkflowCanvas
        stepExecutions={[]}
        selectedStepName={null}
        onSelectStep={() => {}}
      />,
    );
    expect(
      screen.getByText("Nenhuma execução de etapa registrada para este run."),
    ).toBeDefined();
  });

  it("renders empty state in timeline view", () => {
    render(
      <WorkflowCanvas
        stepExecutions={[]}
        selectedStepName={null}
        onSelectStep={() => {}}
        initialViewMode="timeline"
      />,
    );
    expect(
      screen.getByText("Nenhuma etapa registrada nesta execução."),
    ).toBeDefined();
  });

  it("interacts with timeline rows and triggers step selection", () => {
    const onSelectStep = vi.fn();
    render(
      <WorkflowCanvas
        stepExecutions={mockStepExecutions}
        selectedStepName="claim-run"
        onSelectStep={onSelectStep}
        initialViewMode="timeline"
      />,
    );
    const inspectButtons = screen.getAllByRole("button", {
      name: "Inspecionar",
    });
    expect(inspectButtons.length).toBe(2);
    fireEvent.click(inspectButtons[1]!);
    expect(onSelectStep).toHaveBeenCalledWith("analyze-review");
  });
});

describe("StepInspectorDrawer Component", () => {
  it("returns null when step is null", () => {
    const { container } = render(
      <StepInspectorDrawer step={null} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders step details and navigates through tabs", () => {
    const onClose = vi.fn();
    const step = mockStepExecutions[1];
    expect(step).toBeDefined();
    render(<StepInspectorDrawer step={step ?? null} onClose={onClose} />);

    expect(screen.getByTestId("step-inspector-drawer")).toBeDefined();
    expect(screen.getByText("analyze-review")).toBeDefined();

    // Default tab: Overview
    expect(screen.getByText("Tempo de Execução")).toBeDefined();
    expect(screen.getByText("3.50s (3500 ms)")).toBeDefined();

    // Switch to Tentativas tab
    const attemptsTab = screen.getByRole("button", { name: /Tentativas/i });
    fireEvent.click(attemptsTab);
    expect(screen.getByText("Tentativa #1")).toBeDefined();
    expect(screen.getByText("Tentativa #2")).toBeDefined();
    expect(screen.getByText("Erro: ModelRateLimitError")).toBeDefined();
    expect(screen.getByText("Espera antes de retry: 1000 ms")).toBeDefined();

    // Switch to Entrada tab
    const inputTab = screen.getByRole("button", { name: "Entrada" });
    fireEvent.click(inputTab);
    expect(screen.getByText(/deepseek-chat/)).toBeDefined();

    // Switch to Retorno tab
    const outputTab = screen.getByRole("button", { name: "Retorno" });
    fireEvent.click(outputTab);
    expect(screen.getByText(/Defect found/)).toBeDefined();

    // Close button
    const closeBtn = screen.getByRole("button", { name: "Fechar inspetor" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("supports copying sanitized JSON to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(
      <StepInspectorDrawer
        step={mockStepExecutions[1] ?? null}
        onClose={vi.fn()}
        initialTab="input"
      />,
    );

    const copyBtn = screen.getByRole("button", { name: "Copiar JSON" });
    fireEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalled();
    expect(screen.getByText("✓ Copiado!")).toBeDefined();
  });

  it("renders null placeholder messages when input or output is null", () => {
    const emptyStep: StepExecutionNode = {
      ...mockStepExecutions[0]!,
      sanitizedInput: null,
      sanitizedOutput: null,
    };

    render(
      <StepInspectorDrawer
        step={emptyStep}
        onClose={vi.fn()}
        initialTab="input"
      />,
    );
    expect(
      screen.getByText("// Nenhum dado de entrada sanitizado"),
    ).toBeDefined();

    const outputTab = screen.getByRole("button", { name: "Retorno" });
    fireEvent.click(outputTab);
    expect(
      screen.getByText("// Nenhum dado de retorno sanitizado"),
    ).toBeDefined();
  });

  it("renders failed status and attempts empty placeholder", () => {
    const failedStep: StepExecutionNode = {
      ...mockStepExecutions[0]!,
      status: "failed",
      errorCode: "SandboxCrash",
      attempts: [],
      attemptsCount: 1,
      totalDurationMs: 45,
    };

    render(
      <StepInspectorDrawer
        step={failedStep}
        onClose={vi.fn()}
        initialTab="attempts"
      />,
    );

    expect(screen.getByText("failed")).toBeDefined();
    expect(
      screen.getByText("Nenhuma tentativa individual registrada."),
    ).toBeDefined();

    const overviewTab = screen.getByRole("button", { name: "Visão Geral" });
    fireEvent.click(overviewTab);
    expect(screen.getByText("SandboxCrash")).toBeDefined();
  });

  it("renders running status and in-progress attempt duration", () => {
    const runningStep: StepExecutionNode = {
      ...mockStepExecutions[0]!,
      status: "running",
      attempts: [
        {
          attempt: 1,
          durationMs: null,
          endedAt: null,
          errorCode: null,
          startedAt: "2026-09-04T12:00:00.000Z",
          status: "running",
          waitBeforeRetryMs: null,
        },
      ],
      attemptsCount: 1,
    };

    render(
      <StepInspectorDrawer
        step={runningStep}
        onClose={vi.fn()}
        initialTab="attempts"
      />,
    );

    expect(screen.getByText("Em andamento...")).toBeDefined();
  });

  it("closes on Escape key press", () => {
    const onClose = vi.fn();
    const step = mockStepExecutions[0];
    expect(step).toBeDefined();
    render(<StepInspectorDrawer step={step ?? null} onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("resets active tab to overview when step changes and supports copying output json", () => {
    const step1 = mockStepExecutions[0]!;
    const step2 = mockStepExecutions[1]!;
    const onClose = vi.fn();

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    const { rerender } = render(
      <StepInspectorDrawer step={step1} onClose={onClose} initialTab="input" />,
    );
    expect(screen.getByText("Payload sanitizado de entrada:")).toBeDefined();

    // Change step prop
    rerender(
      <StepInspectorDrawer step={step2} onClose={onClose} initialTab="input" />,
    );
    // Should have reset to overview
    expect(screen.getByText("Tempo de Execução")).toBeDefined();

    // Switch to output tab and click copy
    const outputTab = screen.getByRole("button", { name: "Retorno" });
    fireEvent.click(outputTab);
    const copyBtn = screen.getByText("Copiar JSON");
    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalled();
  });

  it("renders vertical SVG connections for multiple steps in the same phase and switches views", () => {
    const multiStepSamePhase: StepExecutionNode[] = [
      {
        ...mockStepExecutions[0]!,
        stepName: "claim-run-1",
        phase: "admission",
        stepOrder: 0,
      },
      {
        ...mockStepExecutions[0]!,
        stepName: "claim-run-2",
        phase: "admission",
        stepOrder: 1,
      },
    ];

    render(
      <WorkflowCanvas
        stepExecutions={multiStepSamePhase}
        selectedStepName="claim-run-1"
        onSelectStep={vi.fn()}
      />,
    );

    // Verify SVG curves rendered
    const flowPath = screen.getByTestId("flow-path-claim-run-1->claim-run-2");
    expect(flowPath).toBeDefined();

    // Switch to timeline and back to canvas
    const timelineBtn = screen.getByRole("button", { name: /Timeline/i });
    fireEvent.click(timelineBtn);
    expect(screen.getByText("Etapa")).toBeDefined();

    const canvasBtn = screen.getByRole("button", { name: /DAG Canvas/i });
    fireEvent.click(canvasBtn);
    expect(screen.getByTestId("canvas-view-area")).toBeDefined();
  });
});
