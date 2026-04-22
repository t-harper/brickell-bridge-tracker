import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";

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

export const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region, ...endpointConfig() }),
  { marshallOptions: { removeUndefinedValues: true } },
);

export const s3 = new S3Client({ region, ...endpointConfig() });
