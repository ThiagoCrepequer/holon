import { projectCompatibility } from "@holon/application";
import type {
  RunConfigurationRef,
  RepositoryPolicy,
  ReviewJob,
} from "@holon/contracts";
import type { WorkflowStep } from "cloudflare:workers";

import type { ReviewServices } from "./review-services.js";
import { modelStep, repositoryStep, stateStep } from "./workflow-policy.js";

interface ProjectIdentificationPhase {
  job: ReviewJob;
  policy: RepositoryPolicy;
  configuration: RunConfigurationRef;
  services: Pick<
    ReviewServices,
    "identifyProjects" | "useProjectIdentification"
  > & {
    ledger: Pick<
      ReviewServices["ledger"],
      "loadRunConfiguration" | "saveProjectIdentification"
    >;
  };
  step: WorkflowStep;
  emit: (
    event: string,
    fields: Readonly<Record<string, boolean | number | string | undefined>>,
  ) => void;
}

export async function runProjectIdentification({
  job,
  policy,
  configuration,
  services,
  step,
  emit,
}: ProjectIdentificationPhase): Promise<void> {
  const identifyProjects = services.identifyProjects;
  if (!identifyProjects) return;
  const identificationStarted = await step.do(
    "start-project-identification",
    stateStep,
    async () => Date.now(),
  );
  const discovered = await step.do(
    "discover-project-metadata",
    repositoryStep,
    async () =>
      identifyProjects(policy, undefined, true, identificationStarted + 120000),
  );
  if (discovered) {
    const identification = {
      ...discovered,
      projects: [] as typeof discovered.projects,
      usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 },
    };
    for (const [index, project] of discovered.projects.entries()) {
      const identifyProject = async () => {
        if (Date.now() >= identificationStarted + 120000)
          return {
            ...discovered,
            projects: [
              {
                ...project,
                status: "partial" as const,
                limitations: [
                  ...project.limitations,
                  "identification-deadline",
                ],
              },
            ],
            usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 },
          };
        return identifyProjects(
          policy,
          { ...discovered, projects: [project] },
          false,
          identificationStarted + 120000,
        );
      };
      let result = await step.do(
        `identify-project-${index}`,
        modelStep,
        identifyProject,
      );
      for (
        let waiting = 0;
        waiting < 3 &&
        result?.projects.some((p) =>
          p.limitations.includes("identification-pending"),
        );
        waiting++
      ) {
        const mayWait = await step.do(
          `continue-project-identification-${index}-${waiting}`,
          stateStep,
          async () => Date.now() - identificationStarted < 90000,
        );
        if (!mayWait) break;
        await step.sleep(
          `wait-project-identification-${index}-${waiting}`,
          "30 seconds",
        );
        result = await step.do(
          `retry-project-identification-${index}-${waiting}`,
          modelStep,
          identifyProject,
        );
      }
      identification.projects.push(
        ...(result?.projects ?? [
          {
            ...project,
            status: "partial" as const,
            limitations: [...project.limitations, "identification-unavailable"],
          },
        ]),
      );
      identification.usage.inputTokens += result?.usage?.inputTokens ?? 0;
      identification.usage.outputTokens += result?.usage?.outputTokens ?? 0;
      identification.usage.modelCalls += result?.usage?.modelCalls ?? 0;
    }
    if (
      identification.projects.some((project) => project.status !== "complete")
    ) {
      identification.status = "partial";
      emit("project.identification_partial", {
        severity: "warning",
        totalProjects: identification.projects.length,
        partialProjects: identification.projects.filter(
          (project) => project.status !== "complete",
        ).length,
      });
    }
    const configuredIdentification = {
      ...identification,
      configuredCompatibility: projectCompatibility(
        await services.ledger.loadRunConfiguration(configuration),
        identification,
      ),
    };
    services.useProjectIdentification?.(configuredIdentification);
    if (services.ledger.saveProjectIdentification)
      await step.do("record-project-identification", stateStep, async () =>
        services.ledger.saveProjectIdentification!(
          job.runId,
          configuredIdentification,
        ),
      );
  }
}
