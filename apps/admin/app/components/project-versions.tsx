import type { ProjectIdentificationResult } from "@holon/contracts";
import { Badge, Card, CardHeader, CardTitle, CardContent } from "@holon/ui";
const kinds: Record<string, string> = {
  "declared-exact": "Declared",
  "declared-range": "Version range",
  locked: "Lockfile",
  "configured-target": "Compile target",
  "configured-runtime": "Runtime configuration",
  conditional: "Conditional",
  unknown: "Unresolved",
};
export function ProjectVersions({
  result,
}: {
  readonly result: ProjectIdentificationResult | null | undefined;
}) {
  return (
    <Card className="section-gap">
      <CardHeader className="pb-3">
        <CardTitle>Project versions</CardTitle>
        <p className="text-xs text-[var(--text-muted)]">
          Repository configuration at this run’s commit. Deployed versions may
          differ.
        </p>
      </CardHeader>
      <CardContent>
        {!result ? (
          <p className="text-xs text-[var(--text-muted)]">
            Version identification was not recorded for this run.
          </p>
        ) : (
          <>
            <div className="flex gap-2 items-center text-xs mb-3">
              <Badge
                variant={result.status === "complete" ? "neutral" : "warning"}
                size="sm"
              >
                {result.status}
              </Badge>
              <span className="font-mono text-[var(--text-muted)]">
                {result.snapshotSha.slice(0, 12)}
              </span>
            </div>
            {result.projects.length === 0 && (
              <p className="text-xs text-[var(--text-muted)]">
                No supported projects identified in this scope.
              </p>
            )}
            <div className="space-y-5">
              {result.projects.map((project) => (
                <section
                  key={project.id}
                  aria-label={`Versions for ${project.root}`}
                >
                  <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
                    <h3 className="text-sm font-medium font-mono break-all">
                      {project.root}
                    </h3>
                    <span className="text-xs text-[var(--text-muted)]">
                      {project.ecosystem} · {project.status}
                    </span>
                  </div>
                  {project.technologies.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">
                      No version declarations available.
                    </p>
                  ) : (
                    <dl className="divide-y divide-[var(--border)]">
                      {project.technologies.map((technology) => (
                        <div
                          key={technology.name}
                          className="py-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-1 sm:gap-3"
                        >
                          <dt className="text-xs font-medium break-all">
                            {technology.name}
                          </dt>
                          <dd className="space-y-2">
                            {technology.declarations.map(
                              (declaration, index) => (
                                <div key={index} className="text-xs">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono break-all">
                                      {declaration.value}
                                    </span>
                                    <span className="text-[var(--text-muted)]">
                                      {kinds[declaration.kind]}
                                    </span>
                                  </div>
                                  {declaration.condition && (
                                    <p className="text-[var(--text-muted)] break-words">
                                      {declaration.condition}
                                    </p>
                                  )}
                                  <p className="text-[var(--text-disabled)] break-all">
                                    {declaration.evidenceIds
                                      .map((id) =>
                                        project.facts.find((f) => f.id === id),
                                      )
                                      .filter(Boolean)
                                      .map((f) => `${f!.path} · ${f!.selector}`)
                                      .join(", ")}
                                  </p>
                                </div>
                              ),
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {project.limitations.length > 0 && (
                    <details className="mt-2 text-xs text-[var(--text-muted)]">
                      <summary className="cursor-pointer focus-visible:outline focus-visible:outline-[var(--primary)]">
                        Identification limitations ({project.limitations.length}
                        )
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {project.limitations.map((item, i) => (
                          <li className="break-words" key={i}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              ))}
            </div>
            {result.limitations.length > 0 && (
              <p className="mt-3 text-xs text-[var(--text-muted)] break-words">
                {result.limitations.join(" · ")}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
