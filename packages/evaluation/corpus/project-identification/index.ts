// Synthetic fixtures authored for Holon; repository license. Frozen split v1, 2026-09-05.
export const identificationCorpus = [
  {
    id: "react-exact",
    split: "development",
    files: [
      {
        path: "package.json",
        content: '{"dependencies": {"react": "19.0.0"}}',
      },
    ],
    expected: [
      {
        root: ".",
        name: "react",
        value: "19.0.0",
        kind: "declared-exact",
        category: "framework",
      },
    ],
  },
  {
    id: "next-range",
    split: "development",
    files: [
      {
        path: "package.json",
        content: '{"dependencies": {"next": "^15.0.0"}}',
      },
    ],
    expected: [
      {
        root: ".",
        name: "next",
        value: "^15.0.0",
        kind: "declared-range",
        category: "framework",
      },
    ],
  },
  {
    id: "typescript-compiler",
    split: "development",
    files: [
      {
        path: "package.json",
        content: '{"devDependencies": {"typescript": "5.7.2"}}',
      },
    ],
    expected: [
      {
        root: ".",
        name: "typescript",
        value: "5.7.2",
        kind: "declared-exact",
        category: "compiler",
      },
    ],
  },
  {
    id: "tailwind-range",
    split: "holdout",
    files: [
      {
        path: "package.json",
        content: '{"dependencies": {"tailwindcss": "~4.0.0"}}',
      },
    ],
    expected: [
      {
        root: ".",
        name: "tailwindcss",
        value: "~4.0.0",
        kind: "declared-range",
        category: "framework",
      },
    ],
  },
  {
    id: "node-engine",
    split: "development",
    files: [
      {
        path: "package.json",
        content: '{"engines": {"node": ">=22"}}',
      },
    ],
    expected: [
      {
        root: ".",
        name: "node",
        value: ">=22",
        kind: "configured-runtime",
        category: "runtime",
      },
    ],
  },
  {
    id: "volta",
    split: "development",
    files: [
      {
        path: "package.json",
        content: '{"volta": {"node": "22.14.0"}}',
      },
    ],
    expected: [
      {
        root: ".",
        name: "node",
        value: "22.14.0",
        kind: "configured-runtime",
        category: "runtime",
      },
    ],
  },
  {
    id: "package-manager",
    split: "development",
    files: [
      {
        path: "package.json",
        content: '{"packageManager": "pnpm@10.0.0"}',
      },
    ],
    expected: [
      {
        root: ".",
        name: "pnpm",
        value: "10.0.0",
        kind: "declared-exact",
        category: "package-manager",
      },
    ],
  },
  {
    id: "target-not-runtime",
    split: "holdout",
    files: [
      {
        path: "package.json",
        content: "{}",
      },
      {
        path: "tsconfig.json",
        content: '{"compilerOptions":{"target":"ES2022"}}',
      },
    ],
    expected: [
      {
        root: ".",
        name: "ecmascript",
        value: "ES2022",
        kind: "configured-target",
        category: "language",
      },
    ],
  },
  {
    id: "nvmrc",
    split: "development",
    files: [
      {
        path: "package.json",
        content: "{}",
      },
      {
        path: ".nvmrc",
        content: "22.0.0",
      },
    ],
    expected: [
      {
        root: ".",
        name: "node",
        value: "22.0.0",
        kind: "configured-runtime",
        category: "runtime",
      },
    ],
  },
  {
    id: "duplicate-node",
    split: "development",
    files: [
      {
        path: "package.json",
        content: '{"dependencies":{"react":"18.0.0","react":"19.0.0"}}',
      },
    ],
    expected: [],
  },
  {
    id: "spring-parent",
    split: "development",
    files: [
      {
        path: "pom.xml",
        content:
          "<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.4.2</version></parent></project>",
      },
    ],
    expected: [
      {
        root: ".",
        name: "org.springframework.boot:spring-boot-starter-parent",
        value: "3.4.2",
        kind: "declared-exact",
        category: "framework",
      },
    ],
  },
  {
    id: "quarkus-bom",
    split: "holdout",
    files: [
      {
        path: "pom.xml",
        content:
          "<project><dependencyManagement><dependencies><dependency><groupId>io.quarkus.platform</groupId><artifactId>quarkus-bom</artifactId><version>3.20.2</version></dependency></dependencies></dependencyManagement></project>",
      },
    ],
    expected: [
      {
        root: ".",
        name: "io.quarkus.platform:quarkus-bom",
        value: "3.20.2",
        kind: "declared-exact",
        category: "framework",
      },
    ],
  },
  {
    id: "java-maven.compiler.release",
    split: "development",
    files: [
      {
        path: "pom.xml",
        content:
          "<project><properties><maven.compiler.release>21</maven.compiler.release></properties></project>",
      },
    ],
    expected: [
      {
        root: ".",
        name: "java",
        value: "21",
        kind: "configured-target",
        category: "runtime",
      },
    ],
  },
  {
    id: "java-maven.compiler.source",
    split: "development",
    files: [
      {
        path: "pom.xml",
        content:
          "<project><properties><maven.compiler.source>17</maven.compiler.source></properties></project>",
      },
    ],
    expected: [
      {
        root: ".",
        name: "java",
        value: "17",
        kind: "configured-target",
        category: "runtime",
      },
    ],
  },
  {
    id: "java-maven.compiler.target",
    split: "development",
    files: [
      {
        path: "pom.xml",
        content:
          "<project><properties><maven.compiler.target>11</maven.compiler.target></properties></project>",
      },
    ],
    expected: [
      {
        root: ".",
        name: "java",
        value: "11",
        kind: "configured-target",
        category: "runtime",
      },
    ],
  },
  {
    id: "java-java.version",
    split: "holdout",
    files: [
      {
        path: "pom.xml",
        content:
          "<project><properties><java.version>22</java.version></properties></project>",
      },
    ],
    expected: [
      {
        root: ".",
        name: "java",
        value: "22",
        kind: "configured-target",
        category: "runtime",
      },
    ],
  },
  {
    id: "maven-property",
    split: "development",
    files: [
      {
        path: "pom.xml",
        content:
          "<project><properties><v>1.2.3</v></properties><dependencies><dependency><groupId>g</groupId><artifactId>a</artifactId><version>${v}</version></dependency></dependencies></project>",
      },
    ],
    expected: [
      {
        root: ".",
        name: "g:a",
        value: "1.2.3",
        kind: "declared-exact",
        category: "library",
      },
    ],
  },
  {
    id: "maven-unresolved",
    split: "development",
    files: [
      {
        path: "pom.xml",
        content:
          "<project><dependencies><dependency><groupId>g</groupId><artifactId>a</artifactId><version>${missing}</version></dependency></dependencies></project>",
      },
    ],
    expected: [
      {
        root: ".",
        name: "g:a",
        value: "${missing}",
        kind: "unknown",
        category: "library",
      },
    ],
  },
  {
    id: "compiler-plugin",
    split: "development",
    files: [
      {
        path: "pom.xml",
        content:
          "<project><build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId><configuration><release>21</release></configuration></plugin></plugins></build></project>",
      },
    ],
    expected: [
      {
        root: ".",
        name: "java",
        value: "21",
        kind: "configured-target",
        category: "runtime",
      },
    ],
  },
  {
    id: "xml-entity",
    split: "holdout",
    files: [
      {
        path: "pom.xml",
        content:
          '<!DOCTYPE project [<!ENTITY x SYSTEM "file:///secret">]><project>&x;</project>',
      },
    ],
    expected: [],
  },
  {
    id: "python-requires",
    split: "development",
    files: [
      {
        path: "pyproject.toml",
        content: '[project]\nrequires-python=">=3.12"',
      },
    ],
    expected: [
      {
        root: ".",
        name: "python",
        value: ">=3.12",
        kind: "configured-runtime",
        category: "runtime",
      },
    ],
  },
  {
    id: "python-file",
    split: "development",
    files: [
      {
        path: "pyproject.toml",
        content: "[project]",
      },
      {
        path: ".python-version",
        content: "3.12.3",
      },
    ],
    expected: [
      {
        root: ".",
        name: "python",
        value: "3.12.3",
        kind: "configured-runtime",
        category: "runtime",
      },
    ],
  },
  {
    id: "fastapi-range",
    split: "development",
    files: [
      {
        path: "pyproject.toml",
        content: '[project]\ndependencies=["fastapi>=0.100"]',
      },
    ],
    expected: [
      {
        root: ".",
        name: "fastapi",
        value: ">=0.100",
        kind: "declared-range",
        category: "framework",
      },
    ],
  },
  {
    id: "django-marker",
    split: "holdout",
    files: [
      {
        path: "pyproject.toml",
        content:
          "[project]\ndependencies=[\"django==5.0; python_version >= '3.12'\"]",
      },
    ],
    expected: [
      {
        root: ".",
        name: "django",
        value: "==5.0",
        kind: "conditional",
        category: "framework",
      },
    ],
  },
  {
    id: "poetry-python",
    split: "development",
    files: [
      {
        path: "pyproject.toml",
        content: '[tool.poetry.dependencies]\npython="^3.12"',
      },
    ],
    expected: [
      {
        root: ".",
        name: "python",
        value: "^3.12",
        kind: "configured-runtime",
        category: "runtime",
      },
    ],
  },
  {
    id: "poetry-flask",
    split: "development",
    files: [
      {
        path: "pyproject.toml",
        content: '[tool.poetry.dependencies]\nflask={version="3.1.0"}',
      },
    ],
    expected: [
      {
        root: ".",
        name: "flask",
        value: "3.1.0",
        kind: "declared-exact",
        category: "framework",
      },
    ],
  },
  {
    id: "requirements-pin",
    split: "development",
    files: [
      {
        path: "requirements.txt",
        content: "flask==3.1.0",
      },
    ],
    expected: [
      {
        root: ".",
        name: "flask",
        value: "3.1.0",
        kind: "declared-exact",
        category: "framework",
      },
    ],
  },
  {
    id: "requirements-range",
    split: "holdout",
    files: [
      {
        path: "requirements.txt",
        content: "django>=5.0",
      },
    ],
    expected: [
      {
        root: ".",
        name: "django",
        value: ">=5.0",
        kind: "declared-range",
        category: "framework",
      },
    ],
  },
  {
    id: "python-invalid",
    split: "development",
    files: [
      {
        path: "pyproject.toml",
        content: "[project",
      },
    ],
    expected: [],
  },
  {
    id: "python-script",
    split: "development",
    files: [
      {
        path: "requirements.txt",
        content: "-e ./run.py",
      },
    ],
    expected: [],
  },
  {
    id: "gradle-groovy",
    split: "development",
    files: [
      {
        path: "build.gradle.kts",
        content: 'implementation "g:a:1.2.3"',
      },
    ],
    expected: [
      {
        root: ".",
        name: "g:a",
        value: "1.2.3",
        kind: "conditional",
        category: "library",
      },
    ],
  },
  {
    id: "gradle-kotlin",
    split: "holdout",
    files: [
      {
        path: "build.gradle.kts",
        content: 'implementation("g:a:2.0.0")',
      },
    ],
    expected: [
      {
        root: ".",
        name: "g:a",
        value: "2.0.0",
        kind: "conditional",
        category: "library",
      },
    ],
  },
  {
    id: "gradle-api",
    split: "development",
    files: [
      {
        path: "build.gradle.kts",
        content: 'api("g:a:3.0.0")',
      },
    ],
    expected: [
      {
        root: ".",
        name: "g:a",
        value: "3.0.0",
        kind: "conditional",
        category: "library",
      },
    ],
  },
  {
    id: "gradle-test",
    split: "development",
    files: [
      {
        path: "build.gradle.kts",
        content: 'testImplementation("g:a:4.0.0")',
      },
    ],
    expected: [
      {
        root: ".",
        name: "g:a",
        value: "4.0.0",
        kind: "conditional",
        category: "library",
      },
    ],
  },
  {
    id: "gradle-java",
    split: "development",
    files: [
      {
        path: "build.gradle.kts",
        content: "java { languageVersion = JavaLanguageVersion.of(21) }",
      },
    ],
    expected: [
      {
        root: ".",
        name: "java",
        value: "21",
        kind: "conditional",
        category: "runtime",
      },
    ],
  },
  {
    id: "gradle-dynamic",
    split: "holdout",
    files: [
      {
        path: "build.gradle.kts",
        content: "implementation(resolveVersion())",
      },
    ],
    expected: [],
  },
  {
    id: "gradle-comment",
    split: "development",
    files: [
      {
        path: "build.gradle.kts",
        content: '// implementation("g:a:99.0.0")',
      },
    ],
    expected: [],
  },
  {
    id: "gradle-script",
    split: "development",
    files: [
      {
        path: "build.gradle.kts",
        content: 'exec { commandLine("curl", "example.com") }',
      },
    ],
    expected: [],
  },
  {
    id: "gradle-lock",
    split: "development",
    files: [
      {
        path: "build.gradle",
        content: "",
      },
      {
        path: "gradle.lockfile",
        content: "g:a:1.2.3=compileClasspath",
      },
    ],
    expected: [
      {
        root: ".",
        name: "g:a",
        value: "1.2.3",
        kind: "conditional",
        category: "library",
      },
    ],
  },
  {
    id: "gradle-catalog",
    split: "holdout",
    files: [
      {
        path: "build.gradle",
        content: "",
      },
      {
        path: "gradle/libs.versions.toml",
        content:
          '[versions]\nv="1.2.3"\n[libraries]\na={module="g:a",version.ref="v"}',
      },
    ],
    expected: [
      {
        root: ".",
        name: "g:a",
        value: "1.2.3",
        kind: "conditional",
        category: "library",
      },
    ],
  },
  {
    id: "mixed-root",
    split: "development",
    files: [
      {
        path: "package.json",
        content: '{"dependencies":{"react":"19.0.0"}}',
      },
      {
        path: "pom.xml",
        content:
          "<project><properties><java.version>21</java.version></properties></project>",
      },
    ],
    expected: [
      {
        root: ".",
        name: "react",
        value: "19.0.0",
        kind: "declared-exact",
        category: "framework",
      },
      {
        root: ".",
        name: "java",
        value: "21",
        kind: "configured-target",
        category: "runtime",
      },
    ],
  },
  {
    id: "two-react-projects",
    split: "development",
    files: [
      {
        path: "apps/a/package.json",
        content: '{"dependencies":{"react":"19.0.0"}}',
      },
      {
        path: "apps/b/package.json",
        content: '{"dependencies":{"react":"18.0.0"}}',
      },
    ],
    expected: [
      {
        root: "apps/a",
        name: "react",
        value: "19.0.0",
        kind: "declared-exact",
        category: "framework",
      },
      {
        root: "apps/b",
        name: "react",
        value: "18.0.0",
        kind: "declared-exact",
        category: "framework",
      },
    ],
  },
  {
    id: "node-python",
    split: "development",
    files: [
      {
        path: "web/package.json",
        content: '{"dependencies":{"next":"15.0.0"}}',
      },
      {
        path: "api/requirements.txt",
        content: "flask==3.1.0",
      },
    ],
    expected: [
      {
        root: "web",
        name: "next",
        value: "15.0.0",
        kind: "declared-exact",
        category: "framework",
      },
      {
        root: "api",
        name: "flask",
        value: "3.1.0",
        kind: "declared-exact",
        category: "framework",
      },
    ],
  },
  {
    id: "aggregator-empty",
    split: "holdout",
    files: [
      {
        path: "package.json",
        content: '{"private":true,"workspaces":["apps/*"]}',
      },
      {
        path: "apps/a/package.json",
        content: "{}",
      },
    ],
    expected: [],
  },
] as const;
