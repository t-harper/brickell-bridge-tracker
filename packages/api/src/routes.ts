import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import {
  BRIDGE_ID,
  type BridgeCycle,
  type BridgeEvent,
  type BridgeState,
  type BridgeStats,
  type PrecomputedAggregates,
  buildStats,
  denoiseEvents,
  eventsToCycles,
  statsFromPrecomputed,
} from "@bridge-tracker/shared";
import { ddb, s3 } from "./awsClients.js";

const TZ = "America/New_York";
const PRECOMPUTED_KEY = "precomputed/brickell/aggregates.json";
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_MIN_DURATION_SEC = 60;

const TABLE = () => requireEnv("CURRENT_TABLE");
const BUCKET = () => requireEnv("HISTORY_BUCKET");

function requireEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k}`);
  return v;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function eventKeyForDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  return `events/brickell/${y}/${m}/${day}.jsonl`;
}

function daysBack(n: number, from: Date = new Date()): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() - i);
    d.setUTCHours(0, 0, 0, 0);
    out.push(d);
  }
  return out;
}

async function readJsonl<T>(key: string): Promise<T[]> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }));
    const body = (await res.Body?.transformToString()) ?? "";
    return body
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as T);
  } catch (err) {
    if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") {
      return [];
    }
    throw err;
  }
}

async function readPrecomputed(): Promise<PrecomputedAggregates | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET(), Key: PRECOMPUTED_KEY }),
    );
    const body = (await res.Body?.transformToString()) ?? "";
    return JSON.parse(body) as PrecomputedAggregates;
  } catch (err) {
    if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") {
      return null;
    }
    throw err;
  }
}

export async function getCurrent(): Promise<BridgeState | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE(), Key: { pk: BRIDGE_ID } }),
  );
  return (res.Item as BridgeState | undefined) ?? null;
}

// Read days+1 day-files so denoise has a leading neighbor for events near
// the window edge, then trim to the requested window after denoise.
async function readEventsForWindow(days: number): Promise<{
  events: BridgeEvent[];
  windowStartMs: number;
}> {
  const clamped = Math.min(Math.max(days, 1), 90);
  const dates = daysBack(clamped + 1);
  const batches = await Promise.all(
    dates.map((d) => readJsonl<BridgeEvent>(eventKeyForDate(d))),
  );
  const all = batches.flat();
  const windowStartMs = Date.now() - clamped * 86400 * 1000;
  return { events: all, windowStartMs };
}

function trimToWindow(events: BridgeEvent[], windowStartMs: number): BridgeEvent[] {
  return events.filter((e) => new Date(e.ts).getTime() >= windowStartMs);
}

function isDefaultWindow(days: number, minDurationSec: number): boolean {
  return days === DEFAULT_WINDOW_DAYS && minDurationSec === DEFAULT_MIN_DURATION_SEC;
}

export async function getHistory(
  days: number,
  minDurationSec: number,
): Promise<BridgeEvent[]> {
  const { events, windowStartMs } = await readEventsForWindow(days);
  const denoised = denoiseEvents(events, minDurationSec);
  return trimToWindow(denoised, windowStartMs).sort((a, b) =>
    a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0,
  );
}

export async function getStats(
  days: number,
  minDurationSec: number,
): Promise<BridgeStats> {
  const clamped = Math.min(Math.max(days, 1), 90);
  // Default-window queries hit the precomputed JSON (1 S3 GET) plus the live
  // current state (1 DDB GET). The poller refreshes the JSON every minute.
  if (isDefaultWindow(clamped, minDurationSec)) {
    const [pre, current] = await Promise.all([readPrecomputed(), getCurrent()]);
    if (pre) {
      return statsFromPrecomputed({ pre, current, tz: TZ, now: new Date() });
    }
  }
  // Fallback: live compute (also handles non-default windows + edge cases
  // before the first precompute has run).
  const [current, { events, windowStartMs }] = await Promise.all([
    getCurrent(),
    readEventsForWindow(clamped),
  ]);
  const denoised = denoiseEvents(events, minDurationSec);
  const windowEvents = trimToWindow(denoised, windowStartMs);
  return buildStats({
    current,
    events: windowEvents,
    windowDays: clamped,
    minDurationSec,
    tz: TZ,
    now: new Date(),
  });
}

export async function getCycles(
  days: number,
  limit: number,
  minDurationSec: number,
): Promise<BridgeCycle[]> {
  const clampedLimit = Math.min(Math.max(limit, 1), 500);
  const clampedDays = Math.min(Math.max(days, 1), 90);
  if (isDefaultWindow(clampedDays, minDurationSec)) {
    const pre = await readPrecomputed();
    if (pre) {
      return pre.cycles.slice(0, clampedLimit);
    }
  }
  const [current, { events, windowStartMs }] = await Promise.all([
    getCurrent(),
    readEventsForWindow(clampedDays),
  ]);
  const denoised = denoiseEvents(events, minDurationSec);
  const windowEvents = trimToWindow(denoised, windowStartMs);
  const cycles = eventsToCycles(windowEvents, current);
  return cycles.reverse().slice(0, clampedLimit);
}
