#!/usr/bin/env node
// Production server: bootstraps DynamoDB tables + S3 bucket on Floci (idempotent),
// runs the poller on a 1-minute tick in-process, serves /api/* via the API handler,
// and serves the built frontend SPA at /* from packages/frontend/dist.
//
// Single port, configurable via PORT (default 8080). Designed to run inside a
// container fronted by Traefik + oauth2-proxy; same-origin fetch from the SPA
// means no CORS gymnastics.
//
// Prereq: Lambda bundles + frontend dist exist at build time.
import { createRequire } from "node:module";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceInUseException,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const PORT = Number(process.env.PORT ?? 8080);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000);
const FRONTEND_DIR = resolve(root, "packages/frontend/dist");

// When UPSTREAM_API_URL is set, this container is a pure SPA host + /api reverse
// proxy: skip bootstrap + in-process poller + AWS-SDK code paths entirely, and
// stream /api requests to the upstream (real AWS API Gateway in prod).
const UPSTREAM_API_URL = process.env.UPSTREAM_API_URL
  ? process.env.UPSTREAM_API_URL.replace(/\/+$/, "")
  : null;

process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";
process.env.AWS_ENDPOINT_URL ??= "http://bridge-tracker-floci:4566";
process.env.CURRENT_TABLE ??= "bridge-tracker-current-prod";
process.env.DEVICES_TABLE ??= "bridge-tracker-devices-prod";
process.env.HISTORY_BUCKET ??= "bridge-tracker-history-prod";

function endpointConfig() {
  return {
    endpoint: process.env.AWS_ENDPOINT_URL,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  };
}

async function ensureTable(ddb, name, keys) {
  try {
    await ddb.send(new CreateTableCommand({
      TableName: name,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: keys.map((k) => ({ AttributeName: k.name, KeyType: k.type === "HASH" ? "HASH" : "RANGE" })),
      AttributeDefinitions: keys.map((k) => ({ AttributeName: k.name, AttributeType: "S" })),
    }));
    console.log(`[bootstrap] created table ${name}`);
  } catch (err) {
    if (err instanceof ResourceInUseException || err?.name === "ResourceInUseException") {
      // already exists
    } else {
      throw err;
    }
  }
  await waitUntilTableExists({ client: ddb, maxWaitTime: 60 }, { TableName: name });
}

async function ensureBucket(s3, name) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: name }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: name }));
      console.log(`[bootstrap] created bucket ${name}`);
    } catch (err) {
      if (err?.name === "BucketAlreadyOwnedByYou" || err?.name === "BucketAlreadyExists") return;
      throw err;
    }
  }
}

async function bootstrap() {
  const region = process.env.AWS_REGION;
  const ddb = new DynamoDBClient({ region, ...endpointConfig() });
  const s3 = new S3Client({ region, ...endpointConfig() });
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await ensureTable(ddb, process.env.CURRENT_TABLE, [{ name: "pk", type: "HASH" }]);
      await ensureTable(ddb, process.env.DEVICES_TABLE, [
        { name: "pk", type: "HASH" },
        { name: "sk", type: "RANGE" },
      ]);
      await ensureBucket(s3, process.env.HISTORY_BUCKET);
      console.log("[bootstrap] ready");
      return;
    } catch (err) {
      console.warn(`[bootstrap] attempt ${attempt} failed: ${err.message}`);
      if (attempt === 30) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map":  "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico":  "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt":  "text/plain; charset=utf-8",
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?", 1)[0]);
  // Resolve inside FRONTEND_DIR and reject any path that escapes it.
  const candidate = normalize(resolve(FRONTEND_DIR, "." + urlPath));
  if (!candidate.startsWith(FRONTEND_DIR)) {
    res.statusCode = 400;
    return res.end("bad path");
  }
  let filePath = candidate;
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = resolve(filePath, "index.html");
  }
  if (!existsSync(filePath)) {
    // SPA fallback: unknown paths serve index.html so client-side routing works.
    filePath = resolve(FRONTEND_DIR, "index.html");
  }
  const ext = extname(filePath).toLowerCase();
  res.setHeader("content-type", MIME[ext] ?? "application/octet-stream");
  // Hashed assets: long cache; HTML: no cache so the hash-referenced JS/CSS
  // resolves freshly after deploys.
  if (filePath.includes("/assets/")) {
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("cache-control", "no-cache");
  }
  createReadStream(filePath).pipe(res);
}

// Hop-by-hop headers (RFC 7230 §6.1) and a few others that must not be copied
// when proxying to an upstream.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

async function proxyApi(req, res, url) {
  const target = new URL(url.pathname + url.search, UPSTREAM_API_URL);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && v !== undefined) {
      headers[k] = Array.isArray(v) ? v.join(",") : v;
    }
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  const resp = await fetch(target, {
    method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? "half" : undefined,
    redirect: "manual",
  });
  res.statusCode = resp.status;
  for (const [k, v] of resp.headers) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) res.setHeader(k, v);
  }
  if (resp.body) {
    Readable.fromWeb(resp.body).pipe(res);
  } else {
    res.end();
  }
}

async function main() {
  const proxyMode = UPSTREAM_API_URL !== null;
  if (proxyMode) {
    console.log(`[server] proxy mode — /api/* → ${UPSTREAM_API_URL}`);
  } else {
    await bootstrap();
  }

  const require = createRequire(import.meta.url);
  const pollerPath = resolve(root, "packages/poller/bundle/handler.js");
  const apiPath = resolve(root, "packages/api/bundle/handler.js");
  let api = null;
  let pollerInterval = null;
  if (!proxyMode) {
    if (!existsSync(pollerPath) || !existsSync(apiPath)) {
      throw new Error(`Lambda bundles missing (${pollerPath}, ${apiPath}). Rebuild image.`);
    }
    const poller = require(pollerPath);
    api = require(apiPath);

    async function tick() {
      try {
        const r = await poller.handler();
        console.log(`[poller] ${new Date().toISOString()} status=${r.status} event=${r.eventWritten}`);
      } catch (err) {
        console.error("[poller] error:", err.message);
      }
    }
    // fire once on boot so the UI has a value; then interval
    tick();
    pollerInterval = setInterval(tick, POLL_INTERVAL_MS);
  }
  if (!existsSync(FRONTEND_DIR)) {
    throw new Error(`Frontend dist missing at ${FRONTEND_DIR}. Rebuild image.`);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        if (proxyMode) {
          await proxyApi(req, res, url);
          return;
        }
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        const event = {
          rawPath: url.pathname,
          requestContext: { http: { method: req.method ?? "GET" } },
          queryStringParameters: Object.fromEntries(url.searchParams),
          headers: req.headers,
          body: body.length ? body.toString("utf8") : undefined,
          isBase64Encoded: false,
        };
        const result = await api.handler(event);
        res.statusCode = result.statusCode ?? 200;
        for (const [k, v] of Object.entries(result.headers ?? {})) {
          res.setHeader(k, String(v));
        }
        res.end(result.body ?? "");
        return;
      }
      serveStatic(req, res);
    } catch (err) {
      console.error("[server] error:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      } else {
        res.end();
      }
    }
  });
  server.listen(PORT, () => console.log(`[server] listening on :${PORT}`));

  function shutdown(signal) {
    console.log(`[server] ${signal}, shutting down`);
    if (pollerInterval) clearInterval(pollerInterval);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
