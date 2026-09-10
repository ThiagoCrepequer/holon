#!/usr/bin/env -S node --import tsx
import { parseArgs } from "node:util";

import {
  compileRepositoryConfiguration,
  projectConfigurationGuidance,
  RepositoryConfigurationError,
  sanitizedConfigurationSummary,
} from "@holon/application";
import { configPathSchema } from "@holon/contracts";
import { parseRepositoryConfigurationYaml } from "@holon/repository-config";

import { localConfigurationReader } from "./local-reader.js";

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      ref: { type: "string" },
      path: { type: "string" },
      directory: { type: "string" },
    },
  });
  if (
    positionals[0] !== "config" ||
    !["validate", "explain"].includes(positionals[1] ?? "") ||
    positionals.length !== 2
  )
    throw new RepositoryConfigurationError(
      "usage: holon config validate|explain [--ref SHA] [--path PATH] [--directory DIR]",
    );
  const local = await localConfigurationReader(
    values.directory ?? process.env.INIT_CWD ?? process.cwd(),
    values.ref,
  );
  const identity = {
    installationId: 1,
    repositoryId: 1,
    pullRequestNumber: 1,
    headSha: local.sha,
    baseSha: local.sha,
    runId: `github:1:pr:1:head:${local.sha}:base:${local.sha}`,
  };
  const snapshot = await compileRepositoryConfiguration(
    identity,
    local.reader,
    parseRepositoryConfigurationYaml,
  );
  const output: Record<string, unknown> = {
    mode: local.mode,
    ...sanitizedConfigurationSummary(snapshot),
  };
  if (positionals[1] === "explain") {
    const path = configPathSchema.parse(values.path);
    const guidance = projectConfigurationGuidance(snapshot, [path]);
    output.scope = guidance.scopes.map((scope) => ({
      path: scope.path,
      project:
        scope.project === null
          ? null
          : {
              name: scope.project.name,
              root: scope.project.root,
              compatibility: scope.project.compatibility,
            },
      instructions: scope.instructionOrigins.map((origin) => {
        const entry = guidance.instructions.find(
          (item) => item.origin === origin,
        )!;
        return { origin, path: entry.path, digest: entry.digest };
      }),
    }));
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof RepositoryConfigurationError ? error.message : "Repository configuration: validation_failed"}\n`,
  );
  process.exitCode = 1;
}
