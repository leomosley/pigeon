import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import type { PigeonConfig } from "./types";

const configSchema = z.object({
  account_id: z.string().min(1),
  bucket: z.string().min(3),
  endpoint: z.url(),
  public_base_url: z.url(),
  access_key_id: z.string().min(1),
  secret_access_key: z.string().min(1),
  retention_days: z.number().int().positive(),
  token_id: z.string().min(1).optional(),
});

export const pigeonDir = (home = homedir()): string => join(home, ".pigeon");
export const configPath = (home = homedir()): string => join(pigeonDir(home), "config");

export const readConfig = async (home = homedir()): Promise<PigeonConfig> => {
  const raw = configSchema.parse(parse(await readFile(configPath(home), "utf8")));
  return {
    accountId: raw.account_id,
    bucket: raw.bucket,
    endpoint: raw.endpoint,
    publicBaseUrl: raw.public_base_url,
    accessKeyId: raw.access_key_id,
    secretAccessKey: raw.secret_access_key,
    retentionDays: raw.retention_days,
    tokenId: raw.token_id,
  };
};

export const writeConfig = async (config: PigeonConfig, home = homedir()): Promise<void> => {
  const path = configPath(home);
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const values: Record<string, string | number> = {
    account_id: config.accountId,
    bucket: config.bucket,
    endpoint: config.endpoint,
    public_base_url: config.publicBaseUrl,
    access_key_id: config.accessKeyId,
    secret_access_key: config.secretAccessKey,
    retention_days: config.retentionDays,
  };
  if (config.tokenId) values.token_id = config.tokenId;
  await writeFile(temporaryPath, stringify(values), { mode: 0o600 });
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
};
