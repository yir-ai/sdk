#!/usr/bin/env node
import { mkdir, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { parseModelContractCatalog } from "../dist/shared/catalog.js";

const options = new Map();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!["--output", "--base-url"].includes(flag) || !value || value.startsWith("--") || options.has(flag)) {
    throw new Error("usage: yir-models --output path/to/models.ts [--base-url https://gateway.yir.ai]");
  }
  options.set(flag, value);
}
const output = options.get("--output");
const baseURL = options.get("--base-url") ?? "https://gateway.yir.ai";
if (!output) {
  throw new Error("usage: yir-models --output path/to/models.ts [--base-url https://gateway.yir.ai]");
}
const apiKey = process.env.YIR_API_KEY?.trim();
if (!apiKey) throw new Error("YIR_API_KEY is required at generation time");
const url = new URL(baseURL.replace(/\/+$/, "") + "/v1/models?include=parameters");
if (!(["https:", "http:"].includes(url.protocol) && (url.protocol === "https:" || ["localhost", "127.0.0.1"].includes(url.hostname)))) {
  throw new Error("invalid gateway URL");
}
if (url.username || url.password || url.hash) throw new Error("invalid gateway URL");

const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
if (!response.ok) throw new Error(`model contract request failed: HTTP ${response.status}`);
const catalog = parseModelContractCatalog(await response.json());
if (!/^[a-f0-9]{64}$/.test(catalog.version ?? "")) throw new Error("model contract version missing");
const source = [
  "// Generated from Yir API model contracts. Refresh with yir-models; do not edit by hand.",
  'import type { ModelContractCatalog } from "@yir-ai/sdk/frontend";',
  "",
  `export const models = ${JSON.stringify(catalog, null, 2)} as const satisfies ModelContractCatalog;`,
  "",
].join("\n");
const target = path.resolve(output);
await mkdir(path.dirname(target), { recursive: true });
const temporary = `${target}.${process.pid}.tmp`;
try {
  await writeFile(temporary, source, "utf8");
  await rename(temporary, target);
} catch (error) {
  await unlink(temporary).catch(() => {});
  throw error;
}
console.log(`Wrote ${catalog.models.length} models (version ${catalog.version}) to ${target}`);
