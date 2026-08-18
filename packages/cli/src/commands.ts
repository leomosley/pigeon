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

const resolveText = async (preferred: string | undefined, message: string): Promise<string> =>
  preferred ||
  requireValue(await p.text({ message, validate: (v) => (!v ? "Required" : undefined) }));

const resolveSecret = async (preferred: string | undefined, message: string): Promise<string> =>
  preferred ||
  requireValue(await p.password({ message, validate: (v) => (!v ? "Required" : undefined) }));

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
  token?: string;
  dryRun?: boolean;
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

  const accountId = await resolveText(
    options.account || process.env.ACCOUNT_ID,
    "Cloudflare account ID"
  );
  const bucket = options.bucket ?? `pigeon-${crypto.randomUUID()}`;
  const token = await resolveSecret(
    options.token || process.env.CLOUDFLARE_API_TOKEN,
    "Cloudflare API token (R2 Edit + API Tokens Write)"
  );
  const cf = new CloudflareClient(token);

  if (options.dryRun) {
    const spinner = p.spinner();
    spinner.start("Validating Cloudflare token and account");
    await cf.verifyAccess(accountId);
    spinner.stop("Token and account verified");
    p.note(
      [
        `Create R2 bucket: ${bucket}`,
        "Enable public r2.dev domain",
        `Set ${options.retentionDays}-day expiry lifecycle`,
        options.withKey
          ? "Prompt for supplied R2 S3 credentials"
          : "Mint bucket-scoped write-only key",
        "Self-test upload, install skill, write ~/.pigeon/config",
      ].join("\n"),
      "Plan (dry run — nothing was changed)"
    );
    p.outro("Dry run complete.");
    return;
  }

  let bucketCreated = false;
  let tokenId: string | undefined;

  const spinner = p.spinner();
  try {
    spinner.start("Creating R2 bucket");
    await cf.createBucket(accountId, bucket);
    bucketCreated = true;
    const publicBaseUrl = await cf.enablePublicDomain(accountId, bucket);
    await cf.setRetention(accountId, bucket, options.retentionDays);
    if (options.withKey && !options.accessKeyId && !options.secretAccessKey) {
      spinner.stop(`Bucket ${bucket} is ready`);
      p.note(
        `Create an Object Read & Write R2 token scoped to ${bucket}, then enter its S3 credentials.`,
        "Cloudflare dashboard"
      );
      options.accessKeyId = await resolveText(options.accessKeyId, "R2 access key ID");
      options.secretAccessKey = await resolveSecret(
        options.secretAccessKey,
        "R2 secret access key"
      );
      spinner.start("Checking supplied credentials");
    }
    spinner.message("Creating scoped upload credentials");
    const keys = await credentials({ ...options, tokenClient: cf, accountId, bucket });
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
    spinner.message("Installing the Pigeon skill");
    const links = await installSkill(home);
    await writeConfig(config, home);
    spinner.stop("Pigeon is ready");
    p.note(
      `${publicBaseUrl}\nArtifacts expire after ${options.retentionDays} days.`,
      "Public route"
    );
    p.note(`Installed the skill at:\n${links.join("\n")}`, "Agent skill");
  } catch (error) {
    spinner.stop("Setup failed");
    await removeSkill(home).catch(() => undefined);
    await rm(configPath(home), { force: true }).catch(() => undefined);
    if (tokenId) await cf.revokeToken(tokenId).catch(() => undefined);
    if (bucketCreated) await cf.deleteBucket(accountId, bucket).catch(() => undefined);
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

export const rotate = async (options: { token?: string } = {}): Promise<void> => {
  const config = await readConfig();
  if (!config.tokenId)
    throw new Error("Externally supplied credentials cannot be rotated by Pigeon");
  const bootstrapToken = await resolveSecret(
    options.token || process.env.CLOUDFLARE_API_TOKEN,
    "Cloudflare API token (API Tokens Write)"
  );
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

export const destroy = async (options: { token?: string; yes?: boolean }): Promise<void> => {
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
  const token = await resolveSecret(
    options.token || process.env.CLOUDFLARE_API_TOKEN,
    "Cloudflare API token (R2 Edit + API Tokens Write)"
  );
  const cf = new CloudflareClient(token);
  await emptyBucket(config);
  await cf.deleteBucket(config.accountId, config.bucket);
  if (config.tokenId) {
    await cf.revokeToken(config.tokenId);
  }
  await removeSkill();
  await rm(configPath(), { force: true });
  p.outro("Pigeon configuration, bucket, key, and skill removed.");
};
