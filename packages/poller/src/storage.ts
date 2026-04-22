import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import {
  BRIDGE_ID,
  type BridgeEvent,
  type BridgeState,
  type FL511Bridge,
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

export async function reconcile(
  incoming: FL511Bridge,
  now: Date = new Date(),
): Promise<ReconcileResult> {
  const pKey = pollKey(now);
  await appendJsonl(pKey, {
    ts: incoming.observedAt,
    status: incoming.status,
    metadata: incoming.metadata,
    alerts: incoming.alerts,
    raw: incoming.raw,
  });
  const rawSnapshotPointer = `s3://${BUCKET()}/${pKey}`;

  const prev = await readCurrent();
  let statusChangedAt = prev?.statusChangedAt ?? incoming.observedAt;
  let eventWritten: BridgeEvent | null = null;

  if (prev && prev.status !== incoming.status) {
    const prevSince = new Date(prev.statusChangedAt).getTime();
    const nowMs = new Date(incoming.observedAt).getTime();
    const durationSec = Number.isFinite(prevSince)
      ? Math.max(0, Math.round((nowMs - prevSince) / 1000))
      : null;
    const ev: BridgeEvent = {
      ts: incoming.observedAt,
      from: prev.status,
      to: incoming.status,
      durationOfPrevStateSec: durationSec,
    };
    await appendJsonl(eventKey(now), ev);
    statusChangedAt = incoming.observedAt;
    eventWritten = ev;
  } else if (!prev) {
    statusChangedAt = incoming.observedAt;
  }

  const state: BridgeState = {
    pk: BRIDGE_ID,
    status: incoming.status,
    statusChangedAt,
    lastPolledAt: incoming.observedAt,
    metadata: incoming.metadata,
    nearbyAlerts: incoming.alerts,
    rawSnapshotPointer,
  };
  await writeCurrent(state);
  return { state, eventWritten };
}
