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

// See the long note in packages/api/src/awsClients.ts — we disable HTTP pool
// reuse to avoid stale-socket "socket hang up" errors on warm Lambdas.
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
  { marshallOptions: { removeUndefinedValues: true } },
);

export const s3 = new S3Client({ region, ...sharedClientOpts, ...endpointConfig() });
