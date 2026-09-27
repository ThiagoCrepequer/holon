import type {
  ProjectIdentificationResult,
  RunConfigurationSummary,
} from "@holon/contracts";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@holon/ui";

const comparisonLabels = {
  matches: "Matches detected evidence",
  conflicts: "Conflicts with detected evidence",
  unknown: "Comparison unavailable",
  not_detected: "Not detected",
} as const;

export function RepositoryConfiguration({
  configuration,
  identification,
}: {
  readonly configuration: RunConfigurationSummary | null | undefined;
  readonly identification: ProjectIdentificationResult | null | undefined;
}) {
  return (
    <Card className="section-gap">
      <CardHeader className="pb-3">
        <CardTitle>Repository review configuration</CardTitle>
        <p className="text-xs text-[var(--text-muted)]">
          Preferences sealed from the base commit. Changes in this pull request
          apply after merging into the base branch.
        </p>
      </CardHeader>
      <CardContent className="text-xs space-y-4">
        {!configuration ? (
          <p className="text-[var(--text-muted)]">
            No compiled configuration was recorded for this run.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {[
                [
                  "Source",
                  configuration.source === "default"
                    ? "Built-in defaults (configuration absent)"
                    : configuration.source,
                ],
                ["Base commit", configuration.identity.baseSha],
                ["Review language", configuration.output.language],
                ["Narrative detail", configuration.output.detail],
                [
                  "New inline comment limit",
                  String(configuration.output.maxInlineComments),
                ],
                ["Verdict policy", configuration.verdictStrictness],
                [
                  "Focus",
                  configuration.focus.join(", ") || "All defect categories",
                ],
                [
                  "Guidance",
                  `${configuration.instructionCount} instructions · ${configuration.referenceCount} referenced files · ${configuration.pathRuleCount} path rules`,
                ],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[var(--text-muted)]">{label}</dt>
                  <dd className="mt-1 break-all">{value}</dd>
                </div>
              ))}
            </dl>
            {configuration.additionalExcludes.length > 0 && (
              <details>
                <summary className="cursor-pointer focus-visible:outline focus-visible:outline-[var(--primary)]">
                  Additional exclusions (
                  {configuration.additionalExcludes.length})
                </summary>
                <ul className="mt-2 space-y-1 font-mono break-all">
                  {configuration.additionalExcludes.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </details>
            )}
            {configuration.projects.length > 0 && (
              <div className="space-y-4">
                <p className="text-[var(--text-muted)]">
                  Declared compatibility is maintainer intent. A mismatch alone
                  does not block the review.
                </p>
                {configuration.projects.map((project) => {
                  const comparison =
                    identification?.configuredCompatibility?.find(
                      (item) => item.name === project.name,
                    );
                  return (
                    <section
                      key={project.name}
                      aria-label={`Configured scope ${project.name}`}
                    >
                      <h3 className="font-medium break-all">
                        {project.name}{" "}
                        <span className="font-mono text-[var(--text-muted)]">
                          · {project.root}
                        </span>
                      </h3>
                      <p className="mt-1 break-all text-[var(--text-muted)]">
                        Detected projects:{" "}
                        {comparison?.projectIds.length
                          ? comparison.projectIds.join(", ")
                          : "No associated detected project"}
                      </p>
                      <dl className="mt-2 divide-y divide-[var(--border)]">
                        {(["runtimes", "frameworks"] as const).flatMap(
                          (category) =>
                            Object.entries(
                              project.compatibility[category] ?? {},
                            ).map(([name, expected]) => {
                              const result = comparison?.declarations.find(
                                (item) =>
                                  item.category === category &&
                                  item.name === name,
                              );
                              return (
                                <div
                                  key={`${category}:${name}`}
                                  className="py-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2"
                                >
                                  <dt className="break-all">
                                    {name}{" "}
                                    <span className="font-mono">
                                      {expected}
                                    </span>
                                  </dt>
                                  <dd className="min-w-0 space-y-1">
                                    <Badge
                                      variant={
                                        result?.status === "conflicts"
                                          ? "warning"
                                          : "neutral"
                                      }
                                      size="sm"
                                    >
                                      {result
                                        ? comparisonLabels[result.status]
                                        : "Not compared in this run"}
                                    </Badge>
                                    {result?.detected.map((fact, index) => (
                                      <p
                                        className="break-all text-[var(--text-muted)]"
                                        key={index}
                                      >
                                        {fact.technology}:{" "}
                                        <span className="font-mono">
                                          {fact.value}
                                        </span>{" "}
                                        · {fact.kind}
                                        {fact.condition
                                          ? ` · ${fact.condition}`
                                          : ""}
                                      </p>
                                    ))}
                                  </dd>
                                </div>
                              );
                            }),
                        )}
                      </dl>
                    </section>
                  );
                })}
              </div>
            )}
            <details className="text-[var(--text-muted)]">
              <summary className="cursor-pointer focus-visible:outline focus-visible:outline-[var(--primary)]">
                Configuration provenance
              </summary>
              <dl className="mt-2 space-y-2 font-mono break-all">
                <div>
                  <dt>Effective digest</dt>
                  <dd>{configuration.configDigest}</dd>
                </div>
                <div>
                  <dt>Source digest</dt>
                  <dd>{configuration.sourceDigest}</dd>
                </div>
                <div>
                  <dt>Scope digest</dt>
                  <dd>{configuration.scopeDigest}</dd>
                </div>
              </dl>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
