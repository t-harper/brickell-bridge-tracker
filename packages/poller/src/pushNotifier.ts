import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import type {
  BridgeEvent,
  BridgeState,
  PrecomputedAggregates,
} from "@bridge-tracker/shared";
import { ddb, s3 } from "./awsClients.js";
import { sendLiveActivityPush } from "./apns.js";
import { PRECOMPUTED_KEY } from "./precompute.js";

const DEVICES_TABLE = () => process.env.DEVICES_TABLE;
const HISTORY_BUCKET = () => process.env.HISTORY_BUCKET;

async function readPrecomputed(): Promise<PrecomputedAggregates | null> {
  const bucket = HISTORY_BUCKET();
  if (!bucket) return null;
  try {
    const r = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: PRECOMPUTED_KEY }),
    );
    const body = (await r.Body?.transformToString()) ?? "";
    return JSON.parse(body) as PrecomputedAggregates;
  } catch (err) {
    if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") {
      return null;
    }
    throw err;
  }
}

// Same math as liveStateFields() in shared/aggregate.ts. Inlined here to avoid
// exporting an internal helper just to call it once.
function predictionsFor(
  state: BridgeState,
  pre: PrecomputedAggregates | null,
): { predictedNextOpenAt: string | null; predictedNextCloseAt: string | null } {
  if (!pre) return { predictedNextOpenAt: null, predictedNextCloseAt: null };
  const sinceMs = new Date(state.statusChangedAt).getTime();
  const isUp = state.status === "UP";
  const medianGap = pre.breakdown.medianGapBetweenOpensSec;
  const avgOpenDur = pre.avgOpenDurationSec;
  return {
    predictedNextOpenAt:
      !isUp && medianGap != null
        ? new Date(sinceMs + medianGap * 1000).toISOString()
        : null,
    predictedNextCloseAt:
      isUp && avgOpenDur != null
        ? new Date(sinceMs + avgOpenDur * 1000).toISOString()
        : null,
  };
}

// Mirror of staleDate(for:stats:) in LiveActivityController.swift: stay fresh
// until the predicted next change (plus 10 min slack), but never grey out sooner
// than a 30-minute floor. The on-device countdown keeps ticking without a push,
// so the stale date is a backstop for a missed update, not a refresh timer.
function computeStaleDate(
  state: BridgeState,
  predictions: { predictedNextOpenAt: string | null; predictedNextCloseAt: string | null },
): number {
  const nowSec = Math.floor(Date.now() / 1000);
  const floor = nowSec + 30 * 60;
  const predictedISO =
    state.status === "UP"
      ? predictions.predictedNextCloseAt
      : state.status === "DOWN"
        ? predictions.predictedNextOpenAt
        : null;
  if (!predictedISO) return floor;
  const predictedSec = Math.floor(new Date(predictedISO).getTime() / 1000) + 10 * 60;
  return Math.max(predictedSec, floor);
}

interface DeviceRecord {
  pk: "DEVICE";
  sk: string;
  apnsToken: string | null;
  activities?: Record<string, { activityPushToken: string; startedAt: string }>;
}

async function scanDevices(): Promise<DeviceRecord[]> {
  const table = DEVICES_TABLE();
  if (!table) return [];
  const out: DeviceRecord[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: table,
      ExclusiveStartKey: startKey,
    }));
    for (const item of r.Items ?? []) out.push(item as DeviceRecord);
    startKey = r.LastEvaluatedKey;
  } while (startKey);
  return out;
}

export async function pushLiveActivityUpdates(state: BridgeState, event: BridgeEvent | null): Promise<void> {
  if (!DEVICES_TABLE()) return;
  if (!process.env.APNS_KEY_PARAM_NAME) return;

  const [devices, pre] = await Promise.all([scanDevices(), readPrecomputed()]);
  const predictions = predictionsFor(state, pre);
  const contentState = {
    status: state.status,
    statusChangedAt: state.statusChangedAt,
    lastPolledAt: state.lastPolledAt,
    ...predictions,
  };
  const staleDate = computeStaleDate(state, predictions);
  const eventType: "update" | "end" = event ? "update" : "update";

  const pushes = devices.flatMap((device) =>
    Object.entries(device.activities ?? {}).map(async ([activityId, act]) => {
      const r = await sendLiveActivityPush(act.activityPushToken, {
        event: eventType,
        contentState,
        staleDate,
      });
      if (!r.ok) {
        console.warn(`LA push failed device=${device.sk} activity=${activityId} status=${r.status} reason=${r.reason}`);
        // Clean up stale tokens on auth/dead-token errors (410 = BadDeviceToken in APNs).
        if (r.status === 410 || r.reason === "BadDeviceToken" || r.reason === "ExpiredProviderToken") {
          await ddb.send(new UpdateCommand({
            TableName: DEVICES_TABLE()!,
            Key: { pk: "DEVICE", sk: device.sk },
            UpdateExpression: "REMOVE activities.#aid",
            ExpressionAttributeNames: { "#aid": activityId },
          })).catch(() => undefined);
        }
      }
    })
  );
  await Promise.allSettled(pushes);
}
