import { GetCommand, PutCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./awsClients.js";

const DEVICES_TABLE = () => requireEnv("DEVICES_TABLE");

function requireEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k}`);
  return v;
}

export interface DeviceRecord {
  pk: "DEVICE";
  sk: string;              // deviceId
  apnsToken: string | null;
  bundleId: string;
  appVersion: string;
  registeredAt: string;
  activities: Record<string, {
    activityPushToken: string;
    startedAt: string;
  }>;
}

export async function putDevice(req: {
  deviceId: string;
  apnsToken: string | null;
  bundleId: string;
  appVersion: string;
}): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: DEVICES_TABLE(),
    Key: { pk: "DEVICE", sk: req.deviceId },
    UpdateExpression:
      "SET apnsToken = :t, bundleId = :b, appVersion = :v, registeredAt = :r, " +
      "activities = if_not_exists(activities, :empty)",
    ExpressionAttributeValues: {
      ":t": req.apnsToken,
      ":b": req.bundleId,
      ":v": req.appVersion,
      ":r": new Date().toISOString(),
      ":empty": {},
    },
  }));
}

export async function deleteDevice(deviceId: string): Promise<void> {
  await ddb.send(new DeleteCommand({
    TableName: DEVICES_TABLE(),
    Key: { pk: "DEVICE", sk: deviceId },
  }));
}

export async function addActivity(deviceId: string, activityId: string, pushToken: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: DEVICES_TABLE(),
    Key: { pk: "DEVICE", sk: deviceId },
    UpdateExpression: "SET activities.#aid = :a",
    ExpressionAttributeNames: { "#aid": activityId },
    ExpressionAttributeValues: {
      ":a": { activityPushToken: pushToken, startedAt: new Date().toISOString() },
    },
  }));
}

export async function removeActivity(deviceId: string, activityId: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: DEVICES_TABLE(),
    Key: { pk: "DEVICE", sk: deviceId },
    UpdateExpression: "REMOVE activities.#aid",
    ExpressionAttributeNames: { "#aid": activityId },
  })).catch(() => { /* best-effort */ });
}

export async function getDevice(deviceId: string): Promise<DeviceRecord | null> {
  const r = await ddb.send(new GetCommand({
    TableName: DEVICES_TABLE(),
    Key: { pk: "DEVICE", sk: deviceId },
  }));
  return (r.Item as DeviceRecord | undefined) ?? null;
}
