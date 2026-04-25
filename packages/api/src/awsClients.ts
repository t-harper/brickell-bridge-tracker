import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent as HttpsAgent } from "node:https";

function endpointConfig() {
  const endpoint = process.env.AWS_ENDPOINT_URL;
  if (!endpoint) return {};
  return {
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
  };
}

const region = process.env.AWS_REGION ?? "us-east-1";

// Warm Lambdas reuse pooled keep-alive sockets that S3 has already closed on
// its side. SDK v3's adaptive retry DOES NOT reliably catch the resulting
// mid-request "socket hang up" (it's classified as non-retryable once bytes
// have been written). Simplest reliable fix: don't pool sockets. One TLS
// handshake per request (~50ms) vs intermittent 500s is the right trade at
// this volume.
const requestHandler = new NodeHttpHandler({
  httpsAgent: new HttpsAgent({ keepAlive: false }),
});
const sharedClientOpts = {
  requestHandler,
  maxAttempts: 5,
  retryMode: "adaptive" as const,
};

export const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region, ...sharedClientOpts, ...endpointConfig() }),
);
export const s3 = new S3Client({ region, ...sharedClientOpts, ...endpointConfig() });
