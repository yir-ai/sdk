import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";

test("all public package entry points resolve to built JavaScript and declarations", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    assert.match(target.import, /^\.\/dist\/.+\.js$/);
    assert.match(target.types, /^\.\/dist\/.+\.d\.ts$/);
    await access(new URL(`../${target.types}`, import.meta.url));
    const name = subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
    assert.equal(import.meta.resolve(name), new URL(`../${target.import}`, import.meta.url).href);
    const exports = await import(name);
    assert.ok(Object.keys(exports).length > 0);
  }
  const root = await import("@yir-ai/sdk");
  const contracts = await import("@yir-ai/sdk/model-contracts");
  const vercel = await import("@yir-ai/sdk/vercel");
  assert.equal(root.getModelContract, contracts.getModelContract);
  assert.equal(typeof vercel.createYirAIProvider, "function");
});
