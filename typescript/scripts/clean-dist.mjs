import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = path.resolve(packageRoot, "dist");

if (path.dirname(distDirectory) !== packageRoot || path.basename(distDirectory) !== "dist") {
  throw new Error("refusing to clean an unexpected SDK output directory");
}

await rm(distDirectory, { recursive: true, force: true });
