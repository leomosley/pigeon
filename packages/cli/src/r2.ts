import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { PigeonConfig } from "./types";

export const r2Client = (config: PigeonConfig): S3Client =>
  new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const verifyR2 = async (config: PigeonConfig): Promise<void> => {
  const client = r2Client(config);
  const key = `.pigeon/doctor-${crypto.randomUUID()}.txt`;
  const put = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: "pigeon can fly",
    ContentType: "text/plain; charset=utf-8",
  });
  // A freshly minted R2 token is briefly rejected while it propagates to the
  // S3 endpoint, so retry the first write past that eventual-consistency window.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await client.send(put);
      break;
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (attempt >= 9 || (name !== "Unauthorized" && name !== "AccessDenied")) throw error;
      await wait(1_000);
    }
  }
  try {
    const url = `${config.publicBaseUrl}/${key}`;
    let response: Response | undefined;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await fetch(url);
      if (response.ok) break;
      await wait(1_000);
    }
    if (!response?.ok || (await response.text()) !== "pigeon can fly") {
      throw new Error(`Public artifact check failed at ${url}`);
    }
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    client.destroy();
  }
};

export const emptyBucket = async (config: PigeonConfig): Promise<void> => {
  const client = r2Client(config);
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: config.bucket, ContinuationToken: continuationToken })
    );
    const objects = page.Contents?.flatMap(({ Key }) => (Key ? [{ Key }] : [])) ?? [];
    if (objects.length > 0) {
      const deleted = await client.send(
        new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: objects } })
      );
      if (deleted.Errors?.length) {
        throw new Error(`Could not delete ${deleted.Errors.map(({ Key }) => Key).join(", ")}`);
      }
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  client.destroy();
};
