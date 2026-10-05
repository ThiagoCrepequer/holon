import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const temporary = await mkdtemp(join(tmpdir(), "holon-i18n-proof-"));
try {
  for (const locale of ["en", "pt-BR"]) {
    const directory = join(temporary, locale);
    await mkdir(directory);
    let catalog = await readFile(`app/locales/${locale}/messages.po`, "utf8");
    if (locale === "pt-BR")
      catalog = catalog.replace('msgstr "Prova de leitura"', 'msgstr ""');
    await writeFile(join(directory, "messages.po"), catalog);
  }
  const configuration = join(temporary, "lingui.config.ts");
  await writeFile(
    configuration,
    `import original from ${JSON.stringify(resolve("lingui.config.ts"))};\nexport default { ...original, catalogs: [{ path: ${JSON.stringify(join(temporary, "{locale}", "messages"))}, include: [${JSON.stringify(resolve("app"))}] }] };\n`,
  );
  const result = spawnSync(
    resolve("node_modules/.bin/lingui"),
    ["check", "missing", "--mode", "catalog", "--config", configuration],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    1,
    "Completeness gate accepted a missing pt-BR translation",
  );
  assert.match(result.stdout + result.stderr, /1 missing translation/);
  console.log(
    "i18n negative proof: missing target translation rejected without fallback.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
