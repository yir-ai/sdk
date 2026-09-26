import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.resolve(packageRoot, ".tmp/scratch");
const pnpm = process.env.npm_execpath;
assert.ok(pnpm, "Run through pnpm run test:package");
await mkdir(scratch, { recursive: true });
const directory = await mkdtemp(path.join(scratch, "sdk-package-"));
const resolvedDirectory = await realpath(directory);
const resolvedScratch = await realpath(scratch);
assert.equal(path.dirname(resolvedDirectory), resolvedScratch);

const runPnpm = (args, cwd) => /\.[cm]?js$/i.test(pnpm)
  ? execFileSync(process.execPath, [pnpm, ...args], { cwd, stdio: "inherit" })
  : execFileSync(pnpm, args, { cwd, stdio: "inherit" });
try {
  runPnpm(["pack", "--pack-destination", directory], packageRoot);
  const archives = (await readdir(directory)).filter(name => name.endsWith(".tgz"));
  assert.equal(archives.length, 1, "Expected exactly one package archive");
  const consumer = path.join(directory, "consumer");
  await mkdir(consumer);
  for (const name of ["package.json", "smoke.mjs", "smoke.ts", "tsconfig.json"]) {
    await copyFile(path.join(packageRoot, "tests/package-consumer", name), path.join(consumer, name));
  }
  // Install the actual archive and its runtime dependencies. A fresh CI runner
  // may need registry metadata even after a frozen-lockfile install. Prefer the
  // cache without requiring it; no lifecycle hooks, workspace links or publish.
  runPnpm(["--ignore-workspace", "add", "--prefer-offline", "--ignore-scripts", path.join(directory, archives[0])], consumer);
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer, stdio: "inherit" });
  execFileSync(process.execPath, [path.join(packageRoot, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], { cwd: consumer, stdio: "inherit" });
  console.log("Installed SDK archive: runtime exports and consumer TypeScript passed.");
} finally {
  // Only remove this invocation's verified scratch child, never a shared output.
  assert.equal(await realpath(directory), resolvedDirectory);
  assert.equal(path.dirname(resolvedDirectory), resolvedScratch);
  await rm(resolvedDirectory, { recursive: true, force: true });
}
