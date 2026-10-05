import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
async function files(directory) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map((item) => {
        const filename = `${directory}/${item.name}`;
        return item.isDirectory() ? files(filename) : filename;
      }),
    )
  ).flat();
}
const assets = await files("build/client");
for (const filename of assets.filter((value) => value.endsWith(".js"))) {
  const content = await readFile(filename, "utf8");
  for (const forbidden of [
    "HOLON_SERVER_ONLY_CANARY",
    "identityFor",
    "readAuthorized",
    "cloudflare:workers",
    "better-auth",
    "drizzle-orm",
  ])
    assert(
      !content.includes(forbidden),
      `${filename}: server-only ${forbidden}`,
    );
}
const serverAssets = await files("build/server");
const serverText = (
  await Promise.all(
    serverAssets
      .filter((value) => value.endsWith(".js"))
      .map((filename) => readFile(filename, "utf8")),
  )
).join("");
assert(
  serverText.includes("HOLON_SERVER_ONLY_CANARY"),
  "Server canary was not included: exclusion check would be vacuous",
);
console.log(
  `Browser proof: checked ${assets.length} client assets; no server canary or restricted SDK.`,
);
