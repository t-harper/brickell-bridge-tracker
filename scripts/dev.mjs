#!/usr/bin/env node
// Local dev: runs the poller on a 1-min tick in-process, serves the API on :3001,
// and starts the Vite frontend dev server. Uses Floci at AWS_ENDPOINT_URL.
//
// Prereq: `npm run bundle` (produces packages/{poller,api}/bundle/handler.js).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

process.env.AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? "test";
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
process.env.AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
process.env.CURRENT_TABLE = process.env.CURRENT_TABLE ?? "bridge-tracker-current-local";
process.env.HISTORY_BUCKET = process.env.HISTORY_BUCKET ?? "bridge-tracker-history-local";

const pollerPath = resolve(root, "packages/poller/bundle/handler.js");
const apiPath = resolve(root, "packages/api/bundle/handler.js");
if (!existsSync(pollerPath) || !existsSync(apiPath)) {
  console.error("bundles not found. Run: npm run bundle");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const poller = require(pollerPath);
const api = require(apiPath);

async function tick() {
  try {
    const r = await poller.handler();
    console.log(`[poller] ${new Date().toISOString()} status=${r.status} event=${r.eventWritten}`);
  } catch (e) {
    console.error("[poller] error:", e.message);
  }
}
tick();
const pollerInterval = setInterval(tick, 60_000);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const event = {
    rawPath: url.pathname,
    requestContext: { http: { method: req.method ?? "GET" } },
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers: req.headers,
  };
  try {
    const result = await api.handler(event);
    res.statusCode = result.statusCode ?? 200;
    for (const [k, v] of Object.entries(result.headers ?? {})) {
      res.setHeader(k, String(v));
    }
    res.end(result.body ?? "");
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e.message }));
  }
});
server.listen(3001, () => console.log("[api] listening on http://localhost:3001"));

const vite = spawn("npm", ["run", "dev", "--workspace=@bridge-tracker/frontend"], {
  stdio: "inherit",
  env: process.env,
});

function shutdown() {
  clearInterval(pollerInterval);
  server.close();
  vite.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
