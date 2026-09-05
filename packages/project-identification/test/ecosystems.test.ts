import { expect, it, describe } from "vitest";

import { identifySnapshot } from "../src/identify.js";
const sha = "a".repeat(40);
async function identify(
  files: Record<string, string>,
  changedPaths?: string[],
) {
  return identifySnapshot({
    snapshotSha: sha,
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
    policyDigest: "policy",
    modelRevision: "model",
    ...(changedPaths ? { changedPaths } : {}),
  });
}
describe("ecosystem declarations and provenance", () => {
  it("reads Maven BOM properties without treating Java target as deployment", async () => {
    const r = await identify({
      "pom.xml":
        "<project><properties><quarkus.version>3.20.2</quarkus.version><maven.compiler.release>21</maven.compiler.release></properties><dependencyManagement><dependencies><dependency><groupId>io.quarkus.platform</groupId><artifactId>quarkus-bom</artifactId><version>${quarkus.version}</version></dependency></dependencies></dependencyManagement></project>",
    });
    expect(r.projects[0]?.technologies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "io.quarkus.platform:quarkus-bom",
          declarations: [expect.objectContaining({ value: "3.20.2" })],
        }),
        expect.objectContaining({
          name: "java",
          declarations: [
            expect.objectContaining({ kind: "configured-target" }),
          ],
        }),
      ]),
    );
  });
  it("preserves Spring Boot parent and unresolved inherited context", async () => {
    const r = await identify({
      "pom.xml":
        "<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.4.2</version></parent></project>",
    });
    expect(r.projects[0]?.limitations).toContain("external-parent-unresolved");
    expect(
      r.projects[0]?.technologies.some(
        (t) => t.name === "org.springframework:spring-core",
      ),
    ).toBe(false);
  });
  it("resolves local parent properties", async () => {
    const r = await identify({
      "pom.xml":
        "<project><artifactId>parent</artifactId><properties><v>1.2.3</v></properties></project>",
      "api/pom.xml":
        "<project><parent><artifactId>parent</artifactId></parent><dependencies><dependency><groupId>x</groupId><artifactId>y</artifactId><version>${v}</version></dependency></dependencies></project>",
    });
    expect(
      r.projects.find((p) => p.root === "api")?.technologies[0]?.declarations[0]
        ?.value,
    ).toBe("1.2.3");
  });
  it("keeps unresolved property and activated profiles conditional", async () => {
    const r = await identify({
      "pom.xml":
        "<project><dependencies><dependency><groupId>x</groupId><artifactId>y</artifactId><version>${missing}</version></dependency></dependencies><profiles><profile><id>prod</id><dependencies><dependency><groupId>x</groupId><artifactId>y</artifactId><version>2.0.0</version></dependency></dependencies></profile></profiles></project>",
    });
    expect(
      r.projects[0]?.technologies[0]?.declarations.map((d) => d.kind),
    ).toEqual(["unknown", "conditional"]);
  });
  it("uses the npm workspace resolution instead of another project version", async () => {
    const r = await identify({
      "apps/a/package.json": '{"dependencies":{"react":"^19.0.0"}}',
      "apps/b/package.json": '{"dependencies":{"react":"^18.0.0"}}',
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/react": { version: "18.3.1" },
          "apps/a/node_modules/react": { version: "19.0.0" },
        },
      }),
    });
    expect(
      r.projects
        .find((p) => p.root === "apps/a")
        ?.technologies[0]?.declarations.at(-1)?.value,
    ).toBe("19.0.0");
    expect(
      r.projects
        .find((p) => p.root === "apps/b")
        ?.technologies[0]?.declarations.at(-1)?.value,
    ).toBe("18.3.1");
  });
  it("selects the pnpm importer", async () => {
    const r = await identify({
      "apps/a/package.json": '{"dependencies":{"react":"^19.0.0"}}',
      "pnpm-lock.yaml":
        'lockfileVersion: "9.0"\nimporters:\n  apps/a:\n    dependencies:\n      react:\n        specifier: ^19.0.0\n        version: 19.1.0(typescript@5.7.0)',
    });
    expect(r.projects[0]?.technologies[0]?.declarations.at(-1)?.value).toBe(
      "19.1.0",
    );
  });
  it("keeps Python requirements and markers", async () => {
    const r = await identify({
      "pyproject.toml":
        '[project]\nrequires-python=">=3.12"\ndependencies=["fastapi>=0.100", "django==5.0; python_version >= \'3.12\'"]',
      ".python-version": "3.12.3",
      "uv.lock": '[[package]]\nname="fastapi"\nversion="0.110.0"',
    });
    expect(
      r.projects[0]?.technologies.find((t) => t.name === "django")
        ?.declarations[0]?.kind,
    ).toBe("conditional");
    expect(r.projects[0]?.limitations).toContain(
      "environment-selection-unknown",
    );
  });
  it("reads Poetry and requirements pins", async () => {
    const r = await identify({
      "pyproject.toml":
        '[tool.poetry.dependencies]\npython="^3.12"\nflask={version="3.1.0"}',
      "requirements.txt": 'flask==3.1.0\ndjango>=5.0; python_version>="3.12"',
    });
    expect(
      r.projects[0]?.technologies.find((t) => t.name === "flask")?.declarations,
    ).toHaveLength(2);
  });
  it("reports Gradle literal and catalog as conditional", async () => {
    const r = await identify({
      "build.gradle.kts":
        'implementation("org.springframework:spring-core:6.2.0")\njava { languageVersion = JavaLanguageVersion.of(21) }',
      "gradle/libs.versions.toml":
        '[versions]\nspring="6.2.0"\n[libraries]\nspring={module="org.springframework:spring-core", version.ref="spring"}',
      "gradle.lockfile":
        "org.springframework:spring-core:6.2.0=compileClasspath",
    });
    expect(r.projects[0]?.status).toBe("partial");
    expect(
      r.projects[0]?.technologies
        .find((t) => t.name === "org.springframework:spring-core")
        ?.declarations.every((d) => d.kind === "conditional"),
    ).toBe(true);
  });
  it("keeps Java and Node projects at the same root", async () => {
    const r = await identify({ "pom.xml": "<project/>", "package.json": "{}" });
    expect(r.projects.map((p) => p.ecosystem)).toEqual(["node", "maven"]);
  });
  it("selects changed ownership and shared configs", async () => {
    const files = {
      "apps/a/package.json": "{}",
      "apps/b/package.json": "{}",
      "pnpm-workspace.yaml": "packages: [apps/*]",
    };
    expect(
      (await identify(files, ["apps/a/index.ts"])).projects.map((p) => p.root),
    ).toEqual(["apps/a"]);
    expect(
      (await identify(files, ["pnpm-workspace.yaml"])).projects,
    ).toHaveLength(2);
  });
  it("invalidates a shared source but reuses results across SHAs", async () => {
    const files = { "package.json": "{}", ".nvmrc": "24" };
    const a = await identify(files),
      b = await identify({ ...files, ".nvmrc": "22" });
    expect(a.projects[0]?.fingerprint).not.toBe(b.projects[0]?.fingerprint);
    const c = await identifySnapshot({
      snapshotSha: "b".repeat(40),
      files: Object.entries(files).map(([path, content]) => ({
        path,
        content,
      })),
      modelRevision: "model",
      policyDigest: "policy",
    });
    expect(a.projects[0]?.fingerprint).toBe(c.projects[0]?.fingerprint);
  });
  it("does not leak malformed source text or registry credentials", async () => {
    const r = await identify({
      "package.json":
        '{"dependencies":{"private":"https://user:secret@example.com/a"}}',
      "tsconfig.json": "SECRET_INVALID",
    });
    expect(JSON.stringify(r)).not.toContain("user:secret");
    expect(JSON.stringify(r)).not.toContain("SECRET_INVALID");
    expect(r.status).toBe("partial");
  });
});
it("reads explicit Node toolchains and package manager", async () => {
  const r = await identify({
    "package.json":
      '{"engines":{"node":">=22"},"volta":{"node":"22.14.0"},"devEngines":{"runtime":{"name":"node","version":"22"}},"packageManager":"pnpm@10.0.0+sha512.foo","peerDependencies":{"react":"19"}}',
    ".nvmrc": "22.14.0",
  });
  expect(
    r.projects[0]?.technologies.find((t) => t.name === "node")?.declarations,
  ).toHaveLength(4);
  expect(
    r.projects[0]?.technologies.find((t) => t.name === "pnpm")?.declarations[0]
      ?.value,
  ).toBe("10.0.0");
});
it("tracks local tsconfig parents", async () => {
  const r = await identify({
    "apps/a/package.json": "{}",
    "apps/a/tsconfig.json": '{"extends":"../../tsconfig.base.json"}',
    "tsconfig.base.json": '{"compilerOptions":{"target":"ES2022"}}',
  });
  expect(r.projects[0]?.sourcePaths).toContain("tsconfig.base.json");
});
it("terminates cyclic Maven parents and properties", async () => {
  const r = await identify({
    "pom.xml":
      "<project><parent><artifactId>a</artifactId><relativePath>a/pom.xml</relativePath></parent><properties><x>${y}</x><y>${x}</y></properties><dependencies><dependency><groupId>g</groupId><artifactId>a</artifactId><version>${x}</version></dependency></dependencies></project>",
    "a/pom.xml":
      "<project><parent><artifactId>p</artifactId></parent></project>",
  });
  expect(r.projects).toHaveLength(2);
  expect(
    r.projects
      .find((p) => p.root === ".")
      ?.technologies.find((t) => t.name === "g:a")?.declarations[0]?.kind,
  ).toBe("unknown");
});
it("bounds projects and oversized files", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 21; i++) files[`app${i}/package.json`] = "{}";
  const r = await identify(files);
  expect(r.projects).toHaveLength(20);
  expect(r.limitations).toContain("project-limit");
  expect((await identify({ "package.json": " ".repeat(65537) })).status).toBe(
    "partial",
  );
});
it("reports unsupported Yarn format", async () => {
  const r = await identify({
    "package.json": '{"dependencies":{"react":"^19.0.0"}}',
    "yarn.lock": "invalid",
  });
  expect(r.projects[0]?.limitations).toContain("source-unreadable:yarn.lock");
});
it.each([
  ["classic", '# yarn lockfile v1\n\nreact@^19.0.0:\n  version "19.1.0"\n'],
  [
    "berry",
    '__metadata:\n  version: 8\n"react@npm:^19.0.0":\n  version: 19.1.0\n',
  ],
])(
  "resolves Yarn %s selectors without choosing another version",
  async (_name, lock) => {
    const r = await identify({
      "package.json": '{"dependencies":{"react":"^19.0.0"}}',
      "yarn.lock": lock,
    });
    expect(r.projects[0]?.technologies[0]?.declarations.at(-1)).toMatchObject({
      value: "19.1.0",
      kind: "locked",
    });
  },
);
it("resolves named pnpm catalogs and invalidates dependents", async () => {
  const files = {
    "apps/a/package.json": '{"dependencies":{"react":"catalog:ui"}}',
    "pnpm-workspace.yaml":
      "packages: [apps/*]\ncatalogs:\n  ui:\n    react: ^19.0.0",
  };
  const a = await identify(files);
  expect(a.projects[0]?.technologies[0]?.declarations.at(-1)?.value).toBe(
    "^19.0.0",
  );
  expect(
    (
      await identify({
        ...files,
        "pnpm-workspace.yaml": files["pnpm-workspace.yaml"].replace(
          "19.0.0",
          "19.1.0",
        ),
      })
    ).projects[0]?.fingerprint,
  ).not.toBe(a.projects[0]?.fingerprint);
});
it("does not assign another Python workspace package to an unrelated member", async () => {
  const r = await identify({
    "apps/api/pyproject.toml": '[project]\ndependencies=["fastapi==0.100.0"]',
    "uv.lock":
      '[[package]]\nname="fastapi"\nversion="0.100.0"\n[[package]]\nname="django"\nversion="5.0.0"',
  });
  expect(r.projects[0]?.technologies.map((t) => t.name)).toEqual(["fastapi"]);
});
it("reads explicit compiler and toolchain declarations without running Maven", async () => {
  const r = await identify({
    "pom.xml":
      "<project><build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId><configuration><release>21</release></configuration></plugin><plugin><artifactId>maven-toolchains-plugin</artifactId><configuration><toolchains><jdk><version>22</version></jdk></toolchains></configuration></plugin></plugins></build></project>",
    "toolchains.xml":
      "<toolchains><toolchain><type>jdk</type><provides><version>23</version></provides></toolchain></toolchains>",
    ".tool-versions": "java 24\nnodejs 22.0.0\npython 3.12.0",
  });
  expect(
    r.projects[0]?.technologies
      .find((t) => t.name === "java")
      ?.declarations.map((d) => d.value),
  ).toEqual(expect.arrayContaining(["21", "22", "23", "24"]));
});
it("inherits the workspace package manager without its unrelated dependencies", async () => {
  const r = await identify(
    {
      "package.json":
        '{"packageManager":"pnpm@10.0.0","dependencies":{"next":"15.0.0"}}',
      "apps/web/package.json": "{}",
    },
    ["apps/web/a.ts"],
  );
  expect(r.projects[0]?.technologies.map((t) => t.name)).toEqual(["pnpm"]);
});
it("rejects a local Maven parent with mismatched coordinates", async () => {
  const r = await identify({
    "pom.xml":
      "<project><artifactId>wrong</artifactId><properties><v>99.0.0</v></properties></project>",
    "api/pom.xml":
      "<project><parent><artifactId>expected</artifactId></parent><dependencies><dependency><groupId>g</groupId><artifactId>a</artifactId><version>${v}</version></dependency></dependencies></project>",
  });
  const p = r.projects.find((x) => x.root === "api");
  expect(p?.limitations).toContain("external-parent-unresolved");
  expect(
    p?.technologies.find((t) => t.name === "g:a")?.declarations[0]?.kind,
  ).toBe("unknown");
});
it("does not promote npm partial versions to exact versions", async () => {
  const r = await identify({
    "package.json": '{"dependencies":{"react":"19","next":"15.2"}}',
  });
  expect(
    r.projects[0]?.technologies.flatMap((t) =>
      t.declarations.map((d) => d.kind),
    ),
  ).toEqual(["declared-range", "declared-range"]);
});
