import { access, rm } from "node:fs/promises";
import { homedir } from "node:os";
import * as p from "@clack/prompts";
import { configPath, readConfig, writeConfig } from "./config";
import { CloudflareClient } from "./cloudflare";
import { renderEnvironment } from "./environment";
import { emptyBucket, verifyR2 } from "./r2";
import { installSkill, removeSkill } from "./skill";
import type { PigeonConfig } from "./types";

const cancelled = (value: unknown): value is symbol => p.isCancel(value);
const requireValue = <T>(value: T | symbol): T => {
  if (cancelled(value)) throw new Error("Cancelled");
  return value;
};

const credentials = async (options: {
  accessKeyId?: string;
  secretAccessKey?: string;
  tokenClient?: CloudflareClient;
  accountId: string;
  bucket: string;
}): Promise<Pick<PigeonConfig, "accessKeyId" | "secretAccessKey" | "tokenId">> => {
  if (options.accessKeyId || options.secretAccessKey) {
    if (!options.accessKeyId || !options.secretAccessKey) {
      throw new Error("Both --access-key-id and --secret-access-key are required");
    }
    return { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey };
  }
  if (!options.tokenClient) {
    throw new Error("Set CLOUDFLARE_API_TOKEN or pass pre-made R2 credentials");
  }
  return options.tokenClient.createBucketToken(options.accountId, options.bucket);
};

export const init = async (options: {
  account?: string;
  bucket?: string;
  retentionDays: number;
  withKey?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  r2Token?: string;
  tokenToken?: string;
}): Promise<void> => {
  p.intro("pigeon init");
  const home = homedir();
  try {
    await access(configPath(home));
    throw new Error(
      "Pigeon is already configured. Run `pigeon destroy` before initializing again."
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const accountId =
    options.account ??
    requireValue(
      await p.text({
        message: "Cloudflare account ID",
        validate: (v) => (!v ? "Required" : undefined),
      })
    );
  const bucket = options.bucket ?? `pigeon-${crypto.randomUUID()}`;
  const sharedToken = process.env.CLOUDFLARE_API_TOKEN;
  const r2Token = options.r2Token ?? sharedToken;
  if (!r2Token) throw new Error("Set CLOUDFLARE_API_TOKEN or pass --r2-token");
  const r2 = new CloudflareClient(r2Token);
  const tokenToken = options.tokenToken ?? process.env.CLOUDFLARE_TOKEN_TOKEN;
  const tokenClient = tokenToken
    ? new CloudflareClient(tokenToken)
    : sharedToken
      ? new CloudflareClient(sharedToken)
      : undefined;
  let bucketCreated = false;
  let tokenId: string | undefined;

  const spinner = p.spinner();
  try {
    spinner.start("Creating R2 bucket");
    await r2.createBucket(accountId, bucket);
    bucketCreated = true;
    const publicBaseUrl = await r2.enablePublicDomain(accountId, bucket);
    await r2.setRetention(accountId, bucket, options.retentionDays);
    if (options.withKey && !options.accessKeyId && !options.secretAccessKey) {
      spinner.stop(`Bucket ${bucket} is ready`);
      p.note(
        `Create an Object Read & Write R2 token scoped to ${bucket}, then enter its S3 credentials.`,
        "Cloudflare dashboard"
      );
      options.accessKeyId = requireValue(
        await p.text({
          message: "R2 access key ID",
          validate: (v) => (!v ? "Required" : undefined),
        })
      );
      options.secretAccessKey = requireValue(
        await p.password({
          message: "R2 secret access key",
          validate: (v) => (!v ? "Required" : undefined),
        })
      );
      spinner.start("Checking supplied credentials");
    }
    spinner.message("Creating scoped upload credentials");
    const keys = await credentials({ ...options, tokenClient, accountId, bucket });
    tokenId = keys.tokenId;
    const config: PigeonConfig = {
      accountId,
      bucket,
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      publicBaseUrl,
      retentionDays: options.retentionDays,
      ...keys,
    };
    spinner.message("Checking upload access");
    await verifyR2(config);
    await installSkill(home);
    await writeConfig(config, home);
    spinner.stop("Pigeon is ready");
    p.note(
      `${publicBaseUrl}\nArtifacts expire after ${options.retentionDays} days.`,
      "Public route"
    );
  } catch (error) {
    spinner.stop("Setup failed");
    await removeSkill(home).catch(() => undefined);
    await rm(configPath(home), { force: true }).catch(() => undefined);
    if (tokenId && tokenClient) await tokenClient.revokeToken(tokenId).catch(() => undefined);
    if (bucketCreated) await r2.deleteBucket(accountId, bucket).catch(() => undefined);
    throw error;
  }
  p.outro("Ask your agent to share an artifact with Pigeon.");
};

export const env = async (shell: "sh" | "powershell"): Promise<void> => {
  process.stdout.write(`${renderEnvironment(await readConfig(), shell)}\n`);
};

export const doctor = async (): Promise<void> => {
  p.intro("pigeon doctor");
  const config = await readConfig();
  const spinner = p.spinner();
  spinner.start("Testing R2 credentials");
  await verifyR2(config);
  spinner.stop("Upload and cleanup succeeded");
  p.outro(`${config.publicBaseUrl} is reachable.`);
};

export const rotate = async (token?: string): Promise<void> => {
  const config = await readConfig();
  const bootstrapToken =
    token ?? process.env.CLOUDFLARE_TOKEN_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;
  if (!bootstrapToken) throw new Error("Set CLOUDFLARE_TOKEN_TOKEN");
  if (!config.tokenId)
    throw new Error("Externally supplied credentials cannot be rotated by Pigeon");
  const client = new CloudflareClient(bootstrapToken);
  const fresh = await client.createBucketToken(config.accountId, config.bucket);
  try {
    await verifyR2({ ...config, ...fresh });
    await writeConfig({ ...config, ...fresh });
  } catch (error) {
    await client.revokeToken(fresh.tokenId).catch(() => undefined);
    throw error;
  }
  try {
    await client.revokeToken(config.tokenId);
  } catch {
    throw new Error("New credentials are active, but the previous key could not be revoked");
  }
  p.outro("Upload credentials rotated.");
};

export const destroy = async (options: {
  r2Token?: string;
  tokenToken?: string;
  yes?: boolean;
}): Promise<void> => {
  const config = await readConfig();
  if (!options.yes) {
    const confirmed = requireValue(
      await p.confirm({
        message: `Delete ${config.bucket} and every artifact in it?`,
        initialValue: false,
      })
    );
    if (!confirmed) throw new Error("Cancelled");
  }
  const sharedToken = process.env.CLOUDFLARE_API_TOKEN;
  const r2Token = options.r2Token ?? sharedToken;
  if (!r2Token) throw new Error("Set CLOUDFLARE_API_TOKEN or pass --r2-token");
  const tokenToken = config.tokenId
    ? (options.tokenToken ?? process.env.CLOUDFLARE_TOKEN_TOKEN ?? sharedToken)
    : undefined;
  if (config.tokenId && !tokenToken) {
    throw new Error("Set CLOUDFLARE_API_TOKEN or pass --token-token to revoke the managed key");
  }
  const r2 = new CloudflareClient(r2Token);
  await emptyBucket(config);
  await r2.deleteBucket(config.accountId, config.bucket);
  if (config.tokenId && tokenToken) {
    await new CloudflareClient(tokenToken).revokeToken(config.tokenId);
  }
  await removeSkill();
  await rm(configPath(), { force: true });
  p.outro("Pigeon configuration, bucket, key, and skill removed.");
};
