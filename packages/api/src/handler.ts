import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getCurrent, getHistory, getStats } from "./routes.js";
import { addActivity, deleteDevice, putDevice, removeActivity } from "./devices.js";

const CORS = {
  "access-control-allow-origin": process.env.CORS_ORIGIN ?? "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { "content-type": "application/json", ...CORS },
    body: JSON.stringify(body),
  };
}

function parseBody<T>(event: APIGatewayProxyEventV2): T | null {
  if (!event.body) return null;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? "/";
  if (method === "OPTIONS") return { statusCode: 204, headers: CORS };

  try {
    // --- bridge reads ---
    if (method === "GET" && (path === "/api/bridges/brickell" || path === "/api/bridges/brickell/status")) {
      const state = await getCurrent();
      if (!state) return json(404, { error: "no state yet" });
      return json(200, state);
    }
    if (method === "GET" && path === "/api/bridges/brickell/history") {
      const days = Number(event.queryStringParameters?.days ?? "7");
      return json(200, { events: await getHistory(days) });
    }
    if (method === "GET" && path === "/api/bridges/brickell/stats") {
      const days = Number(event.queryStringParameters?.days ?? "7");
      return json(200, await getStats(days));
    }
    if (method === "GET" && path === "/api/health") {
      return json(200, { ok: true });
    }

    // --- device + live-activity registration ---
    if (method === "POST" && path === "/api/devices") {
      const body = parseBody<{ deviceId: string; apnsToken: string | null; bundleId: string; appVersion: string }>(event);
      if (!body?.deviceId || !body.bundleId) return json(400, { error: "missing fields" });
      await putDevice(body);
      return json(200, { ok: true });
    }

    const deviceMatch = path.match(/^\/api\/devices\/([^/]+)$/);
    if (method === "DELETE" && deviceMatch) {
      await deleteDevice(deviceMatch[1]);
      return json(200, { ok: true });
    }

    const activityMatch = path.match(/^\/api\/devices\/([^/]+)\/activity$/);
    if (method === "POST" && activityMatch) {
      const body = parseBody<{ activityId: string; activityPushToken: string }>(event);
      if (!body?.activityId || !body.activityPushToken) return json(400, { error: "missing fields" });
      await addActivity(activityMatch[1], body.activityId, body.activityPushToken);
      return json(200, { ok: true });
    }

    const activityDeleteMatch = path.match(/^\/api\/devices\/([^/]+)\/activity\/([^/]+)$/);
    if (method === "DELETE" && activityDeleteMatch) {
      await removeActivity(activityDeleteMatch[1], activityDeleteMatch[2]);
      return json(200, { ok: true });
    }

    return json(404, { error: "not found", path });
  } catch (err) {
    console.error("api error", err);
    return json(500, { error: "internal error", message: (err as Error).message });
  }
};
