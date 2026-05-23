import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { BridgeEvent, BridgeState } from "@bridge-tracker/shared";
import { ddb } from "./awsClients.js";
import { sendLiveActivityPush } from "./apns.js";

const DEVICES_TABLE = () => process.env.DEVICES_TABLE;

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

  const devices = await scanDevices();
  const contentState = {
    status: state.status,
    statusChangedAt: state.statusChangedAt,
    lastPolledAt: state.lastPolledAt,
  };
  const staleDate = Math.floor(Date.now() / 1000) + 15 * 60;
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
