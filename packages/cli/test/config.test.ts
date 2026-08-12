import { chmod, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { configPath, readConfig, writeConfig } from "../src/config";
import type { PigeonConfig } from "../src/types";

const config: PigeonConfig = {
  accountId: "account",
  bucket: "pigeon-test",
  endpoint: "https://account.r2.cloudflarestorage.com",
  publicBaseUrl: "https://pub-test.r2.dev",
  accessKeyId: "access",
  secretAccessKey: "secret",
  retentionDays: 90,
  tokenId: "token",
};

describe("config", () => {
  test("round-trips TOML and limits file permissions", async () => {
    const home = await mkdtemp(join(tmpdir(), "pigeon-"));
    await chmod(home, 0o700);
    await writeConfig(config, home);
    expect(await readConfig(home)).toEqual(config);
    expect((await stat(configPath(home))).mode & 0o777).toBe(0o600);
  });
});
