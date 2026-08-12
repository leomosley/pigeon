import { expect, test } from "bun:test";
import { renderEnvironment } from "../src/environment";
import type { PigeonConfig } from "../src/types";

const config = {
  accountId: "account",
  bucket: "pigeon-test",
  endpoint: "https://account.r2.cloudflarestorage.com",
  publicBaseUrl: "https://pub-test.r2.dev",
  accessKeyId: "access",
  secretAccessKey: "sec'ret",
  retentionDays: 90,
} satisfies PigeonConfig;

test("renders POSIX-safe exports", () => {
  expect(renderEnvironment(config, "sh")).toContain(`AWS_SECRET_ACCESS_KEY='sec'"'"'ret'`);
  expect(renderEnvironment(config, "sh")).toContain("PIGEON_BUCKET='pigeon-test'");
});

test("renders PowerShell-safe assignments", () => {
  expect(renderEnvironment(config, "powershell")).toContain(
    `$env:AWS_SECRET_ACCESS_KEY = 'sec''ret'`
  );
});
