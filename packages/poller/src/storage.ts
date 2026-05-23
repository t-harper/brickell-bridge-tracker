import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import {
  BRIDGE_ID,
  type BridgeEvent,
  type BridgeState,
  type BridgeStatus,
  type FL511Bridge,
} from "@bridge-tracker/shared";
import { ddb, s3 } from "./awsClients.js";

// If FL511's claimed last-refresh timestamp is more than this far behind our
// observation, the upstream feed is frozen and "DOWN" / "UP" readings are not
// trustworthy. We promote the bridge to UNKNOWN until the feed catches up.
// Source incident: 2026-05-21/22 — feed pinned at 12:06 AM ET for ~35h while
// we recorded a fake 35h-long DOWN cycle.
const FEED_STALENESS_MS = 15 * 60 * 1000;

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

function pollKey(ts: Date): string {
  const y = ts.getUTCFullYear();
  const m = pad(ts.getUTCMonth() + 1);
  const d = pad(ts.getUTCDate());
  const h = pad(ts.getUTCHours());
  return `polls/brickell/${y}/${m}/${d}/${h}.jsonl`;
}

function eventKey(ts: Date): string {
  const y = ts.getUTCFullYear();
  const m = pad(ts.getUTCMonth() + 1);
  const d = pad(ts.getUTCDate());
  return `events/brickell/${y}/${m}/${d}.jsonl`;
}

async function readCurrent(): Promise<BridgeState | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE(), Key: { pk: BRIDGE_ID } }),
  );
  return (res.Item as BridgeState | undefined) ?? null;
}

async function writeCurrent(state: BridgeState): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE(), Item: state }));
}

async function appendJsonl(key: string, line: unknown): Promise<void> {
  let existing = "";
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }));
    existing = (await res.Body?.transformToString()) ?? "";
  } catch (err) {
    if (!(err instanceof NoSuchKey) && (err as { name?: string }).name !== "NoSuchKey") {
      throw err;
    }
  }
  const next = existing + JSON.stringify(line) + "\n";
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: next,
      ContentType: "application/x-ndjson",
    }),
  );
}

export interface ReconcileResult {
  state: BridgeState;
  eventWritten: BridgeEvent | null;
}

function isFeedStale(incoming: FL511Bridge): boolean {
  if (!incoming.feedLastUpdatedAt) return false;
  const feedMs = new Date(incoming.feedLastUpdatedAt).getTime();
  if (!Number.isFinite(feedMs)) return false;
  const observedMs = new Date(incoming.observedAt).getTime();
  return observedMs - feedMs > FEED_STALENESS_MS;
}

export async function reconcile(
  incoming: FL511Bridge,
  now: Date = new Date(),
): Promise<ReconcileResult> {
  const prev = await readCurrent();

  // When the feed is frozen, we don't trust FL511's reported status — promote
  // to UNKNOWN. eventsToCycles only opens/closes on UP↔DOWN, so transitions
  // through UNKNOWN naturally drop out of the stats window.
  const effectiveStatus: BridgeStatus = isFeedStale(incoming) ? "UNKNOWN" : incoming.status;

  let statusChangedAt = prev?.statusChangedAt ?? incoming.observedAt;
  let eventWritten: BridgeEvent | null = null;

  // Only archive a raw poll snapshot when the status flipped (or this is the
  // first poll ever). Routine polls account for >99% of writes; skipping them
  // cuts our S3 PUT+GET bill by the same factor. The status-change events
  // in events/*.jsonl are what /stats and /history actually read.
  const isStatusChange = prev != null && prev.status !== effectiveStatus;
  const isFirstPoll = !prev;
  let rawSnapshotPointer: string | null = prev?.rawSnapshotPointer ?? null;

  if (isStatusChange || isFirstPoll) {
    const pKey = pollKey(now);
    await appendJsonl(pKey, {
      ts: incoming.observedAt,
      status: effectiveStatus,
      rawStatus: incoming.status,
      feedLastUpdatedAt: incoming.feedLastUpdatedAt,
      metadata: incoming.metadata,
      alerts: incoming.alerts,
      raw: incoming.raw,
    });
    rawSnapshotPointer = `s3://${BUCKET()}/${pKey}`;
  }

  if (isStatusChange) {
    const prevSince = new Date(prev!.statusChangedAt).getTime();
    const nowMs = new Date(incoming.observedAt).getTime();
    const durationSec = Number.isFinite(prevSince)
      ? Math.max(0, Math.round((nowMs - prevSince) / 1000))
      : null;
    const ev: BridgeEvent = {
      ts: incoming.observedAt,
      from: prev!.status,
      to: effectiveStatus,
      durationOfPrevStateSec: durationSec,
    };
    await appendJsonl(eventKey(now), ev);
    statusChangedAt = incoming.observedAt;
    eventWritten = ev;
  } else if (isFirstPoll) {
    statusChangedAt = incoming.observedAt;
  }

  const state: BridgeState = {
    pk: BRIDGE_ID,
    status: effectiveStatus,
    statusChangedAt,
    lastPolledAt: incoming.observedAt,
    feedLastUpdatedAt: incoming.feedLastUpdatedAt,
    metadata: incoming.metadata,
    nearbyAlerts: incoming.alerts,
    rawSnapshotPointer,
  };
  await writeCurrent(state);
  return { state, eventWritten };
}
