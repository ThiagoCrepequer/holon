import { expect, it } from "vitest";

import {
  matchingConfigurationRules,
  selectConfiguredProject,
} from "../src/configuration-scope.js";
it("selects the deepest segment ancestor and does not invent inheritance", () => {
  const projects = [
    { name: "root", root: "." },
    { name: "api", root: "apps/api" },
    { name: "nested", root: "apps/api/auth" },
  ];
  expect(
    selectConfiguredProject("apps/api/auth/login.ts", projects)?.name,
  ).toBe("nested");
  expect(selectConfiguredProject("apps/api-client/a.ts", projects)?.name).toBe(
    "root",
  );
  expect(selectConfiguredProject("Apps/api/a.ts", projects)?.name).toBe("root");
});
it("composes every matching rule in declaration order", () => {
  const rules = [
    { paths: ["**/*.ts"] },
    { paths: ["apps/api/**"] },
    { paths: ["*.java"] },
  ];
  expect(matchingConfigurationRules("apps/api/main.ts", rules)).toEqual(
    rules.slice(0, 2),
  );
});
