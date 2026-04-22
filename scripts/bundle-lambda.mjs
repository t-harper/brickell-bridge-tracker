#!/usr/bin/env node
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, createWriteStream, existsSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const [, , pkg] = process.argv;
if (!pkg) {
  console.error("usage: bundle-lambda.mjs <poller|api>");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pkgDir = resolve(root, "packages", pkg);
const outDir = resolve(pkgDir, "bundle");
const zipPath = resolve(pkgDir, "bundle.zip");

if (existsSync(outDir)) rmSync(outDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(pkgDir, "src/handler.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: resolve(outDir, "handler.js"),
  sourcemap: "inline",
  external: [],
  logLevel: "info",
});

// bundle dir sits inside a package with "type":"module"; override for CJS.
writeFileSync(resolve(outDir, "package.json"), JSON.stringify({ type: "commonjs" }));

if (existsSync(zipPath)) rmSync(zipPath);
execSync(`cd ${outDir} && zip -q -r ${zipPath} .`, { stdio: "inherit" });
console.log(`wrote ${zipPath}`);
