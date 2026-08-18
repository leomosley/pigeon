#!/usr/bin/env node
import { Command, Option } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { destroy, doctor, env, init, rotate } from "./commands";

const program = new Command()
  .name("pigeon")
  .description("Give coding agents a route for sharing artifacts from any machine.")
  .version(packageJson.version)
  .showSuggestionAfterError();

program
  .command("init")
  .description("Create an R2 route and install the Pigeon agent skill")
  .option("--account <id>", "Cloudflare account ID (env ACCOUNT_ID)")
  .option("--bucket <name>", "bucket name; defaults to pigeon-<uuid>")
  .option("--retention-days <days>", "days before artifacts expire", (value) => Number(value), 90)
  .option(
    "--token <token>",
    "Cloudflare API token with R2 Edit + API Tokens Write (env CLOUDFLARE_API_TOKEN)"
  )
  .option("--with-key", "supply pre-made R2 S3 credentials instead of minting a key")
  .option("--access-key-id <id>", "pre-made R2 access key ID (implies --with-key)")
  .option("--secret-access-key <secret>", "pre-made R2 secret access key (implies --with-key)")
  .option("--dry-run", "validate token and account, then print the plan without changing anything")
  .action(init);

program
  .command("env")
  .description("Print shell exports for the configured upload route")
  .addOption(
    new Option("--shell <shell>", "output shell syntax").choices(["sh", "powershell"]).default("sh")
  )
  .action(({ shell }: { shell: "sh" | "powershell" }) => env(shell));

program.command("doctor").description("Test upload, read, and cleanup access").action(doctor);
program
  .command("rotate")
  .description("Replace Pigeon-managed upload credentials")
  .option(
    "--token <token>",
    "Cloudflare API token with API Tokens Write (env CLOUDFLARE_API_TOKEN)"
  )
  .action(rotate);
program
  .command("destroy")
  .description("Remove the bucket, key, skill, and local configuration")
  .option(
    "--token <token>",
    "Cloudflare API token with R2 Edit + API Tokens Write (env CLOUDFLARE_API_TOKEN)"
  )
  .option("--yes", "skip destructive confirmation")
  .action(destroy);

if (process.argv.length === 2) program.help();
program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`pigeon: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
