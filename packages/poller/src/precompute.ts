import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  BRIDGE_ID,
  type BridgeEvent,
  type BridgeState,
  buildPrecomputedAggregates,
  denoiseEvents,
} from "@bridge-tracker/shared";
import { ddb, s3 } from "./awsClients.js";

const TZ = "America/New_York";
const WINDOW_DAYS = 7;
const MIN_DURATION_SEC = 60;
export const PRECOMPUTED_KEY = "precomputed/brickell/aggregates.json";

function requireEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k}`);
  return v;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function eventKeyForDate(d: Date): string {
  return `events/brickell/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}.jsonl`;
}

function daysBack(n: number, from: Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() - i);
    d.setUTCHours(0, 0, 0, 0);
    out.push(d);
  }
  return out;
}

async function readJsonl<T>(bucket: string, key: string): Promise<T[]> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
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

export async function writePrecomputedAggregates(now: Date = new Date()): Promise<void> {
  const bucket = requireEnv("HISTORY_BUCKET");
  const table = requireEnv("CURRENT_TABLE");

  // Read days+1 day-files so the leading-segment math is well-defined, then
  // trim to the window after denoise.
  const dates = daysBack(WINDOW_DAYS + 1, now);
  const [batches, currentRes] = await Promise.all([
    Promise.all(dates.map((d) => readJsonl<BridgeEvent>(bucket, eventKeyForDate(d)))),
    ddb.send(new GetCommand({ TableName: table, Key: { pk: BRIDGE_ID } })),
  ]);
  const current = (currentRes.Item as BridgeState | undefined) ?? null;
  const all = batches.flat();
  const denoised = denoiseEvents(all, MIN_DURATION_SEC);
  const windowStartMs = now.getTime() - WINDOW_DAYS * 86400 * 1000;
  const windowEvents = denoised.filter(
    (e) => new Date(e.ts).getTime() >= windowStartMs,
  );

  const aggregates = buildPrecomputedAggregates({
    events: windowEvents,
    current,
    windowDays: WINDOW_DAYS,
    minDurationSec: MIN_DURATION_SEC,
    tz: TZ,
    now,
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: PRECOMPUTED_KEY,
      Body: JSON.stringify(aggregates),
      ContentType: "application/json",
      CacheControl: "max-age=15",
    }),
  );
}
