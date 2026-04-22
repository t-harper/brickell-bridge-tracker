import { createSign } from "node:crypto";
import http2 from "node:http2";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const HOST = "https://api.push.apple.com";

export interface APNsConfig {
  teamId: string;
  keyId: string;
  bundleId: string;
  privateKeyPEM: string;
}

let cached: { config: APNsConfig; loadedAt: number } | null = null;
let tokenCache: { jwt: string; issuedAt: number } | null = null;

function endpointConfig() {
  const endpoint = process.env.AWS_ENDPOINT_URL;
  if (!endpoint) return {};
  return {
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
  };
}

async function loadConfig(): Promise<APNsConfig | null> {
  const teamId = process.env.APNS_TEAM_ID;
  const keyId = process.env.APNS_KEY_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  const secretArn = process.env.APNS_KEY_SECRET_ARN;
  if (!teamId || !keyId || !bundleId || !secretArn) return null;

  if (cached && Date.now() - cached.loadedAt < 10 * 60_000) return cached.config;

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    ...endpointConfig(),
  });
  const r = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const privateKeyPEM = r.SecretString;
  if (!privateKeyPEM) return null;

  const config: APNsConfig = { teamId, keyId, bundleId, privateKeyPEM };
  cached = { config, loadedAt: Date.now() };
  return config;
}

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function sign(config: APNsConfig): string {
  if (tokenCache && Date.now() - tokenCache.issuedAt < 50 * 60_000) return tokenCache.jwt;
  const header = { alg: "ES256", kid: config.keyId };
  const payload = { iss: config.teamId, iat: Math.floor(Date.now() / 1000) };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign("SHA256");
  signer.update(data);
  signer.end();
  const sig = signer.sign({ key: config.privateKeyPEM, dsaEncoding: "ieee-p1363" });
  const jwt = `${data}.${b64url(sig)}`;
  tokenCache = { jwt, issuedAt: Date.now() };
  return jwt;
}

export interface LiveActivityPushPayload {
  event: "update" | "end";
  contentState: Record<string, unknown>;
  attributesType?: string;
  attributes?: Record<string, unknown>;
  staleDate?: number;
}

export async function sendLiveActivityPush(
  pushToken: string,
  payload: LiveActivityPushPayload,
): Promise<{ ok: boolean; status: number; reason?: string }> {
  const config = await loadConfig();
  if (!config) return { ok: false, status: 0, reason: "APNs not configured" };

  const body = JSON.stringify({
    aps: {
      timestamp: Math.floor(Date.now() / 1000),
      event: payload.event,
      "content-state": payload.contentState,
      ...(payload.staleDate ? { "stale-date": payload.staleDate } : {}),
      ...(payload.attributesType ? { "attributes-type": payload.attributesType } : {}),
      ...(payload.attributes ? { attributes: payload.attributes } : {}),
    },
  });

  return new Promise((resolve) => {
    const client = http2.connect(HOST);
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${pushToken}`,
      "apns-topic": `${config.bundleId}.push-type.liveactivity`,
      "apns-push-type": "liveactivity",
      "apns-priority": "10",
      "authorization": `bearer ${sign(config)}`,
      "content-type": "application/json",
    });
    let status = 0;
    let respBody = "";
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.on("data", (chunk) => { respBody += chunk; });
    req.on("end", () => {
      client.close();
      const ok = status >= 200 && status < 300;
      let reason: string | undefined;
      if (!ok && respBody) {
        try { reason = JSON.parse(respBody).reason; } catch { reason = respBody; }
      }
      resolve({ ok, status, reason });
    });
    req.on("error", (err) => {
      client.close();
      resolve({ ok: false, status: 0, reason: err.message });
    });
    req.setTimeout(8000, () => {
      req.close();
      client.close();
      resolve({ ok: false, status: 0, reason: "timeout" });
    });
    req.end(body);
  });
}
