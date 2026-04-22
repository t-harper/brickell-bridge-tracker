import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import {
  BRIDGE_ID,
  type BridgeEvent,
  type BridgeState,
  type BridgeStats,
} from "@bridge-tracker/shared";
import { ddb, s3 } from "./awsClients.js";

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

export async function getCurrent(): Promise<BridgeState | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE(), Key: { pk: BRIDGE_ID } }),
  );
  return (res.Item as BridgeState | undefined) ?? null;
}

export async function getHistory(days: number): Promise<BridgeEvent[]> {
  const dates = daysBack(Math.min(Math.max(days, 1), 90));
  const batches = await Promise.all(dates.map((d) => readJsonl<BridgeEvent>(eventKeyForDate(d))));
  return batches
    .flat()
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

export async function getStats(days: number): Promise<BridgeStats> {
  const [current, events] = await Promise.all([getCurrent(), getHistory(days)]);
  const opens = events.filter((e) => e.to === "UP").length;
  const upDurations = events
    .filter((e) => e.from === "UP" && typeof e.durationOfPrevStateSec === "number")
    .map((e) => e.durationOfPrevStateSec as number);
  const avg = upDurations.length
    ? Math.round(upDurations.reduce((a, b) => a + b, 0) / upDurations.length)
    : null;
  const longest = upDurations.length ? Math.max(...upDurations) : null;
  const now = Date.now();
  const sinceSec = current
    ? Math.max(0, Math.round((now - new Date(current.statusChangedAt).getTime()) / 1000))
    : 0;
  return {
    windowDays: days,
    opens,
    avgOpenDurationSec: avg,
    longestOpenDurationSec: longest,
    currentStatus: current?.status ?? "UNKNOWN",
    currentStatusSinceSec: sinceSec,
  };
}
