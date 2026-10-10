import { readFile, writeFile } from "node:fs/promises";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
await writeFile(
  new URL("../src/server/package-version.ts", import.meta.url),
  `// Generated from package.json by scripts/generate-package-version.mjs.
export const PACKAGE_VERSION = ${JSON.stringify(version)};
`,
);
