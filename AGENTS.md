# AGENTS.md

Guidance for AI agents working in this repo.

## Project

Pigeon is a Cloudflare R2 artifact-sharing bootstrapper. The `packages/cli`
package creates an R2 bucket, enables its public `r2.dev` route, sets a
retention lifecycle, mints a bucket-scoped write-only upload key, and installs the
Pigeon agent skills. Two skills ship together: `pigeon` (upload an artifact via a
direct SigV4 PUT and return its public URL) and `take-screenshot` (capture a
screen/window/page, learning the working method per platform, then share it via
`pigeon`). They are written to `~/.agents/skills/<name>` and linked into every
agent detected on the machine (currently Claude Code and opencode).
`apps/web` is the Astro landing page.

## Checks (run from repo root)

```sh
bun run --cwd packages/cli typecheck
bun run --cwd packages/cli lint
bun run --cwd packages/cli test
```

Formatting is Prettier; run `bunx prettier --write <files>` before committing.

## Cloudflare credentials (for live CLI testing)

The CLI needs a Cloudflare **Account ID** and **one API token**. Put them in
`.env` at the repo root (git-ignored):

```sh
ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
```

The token must carry **both** permissions:

| Group   | Item               | Access | Enables                                        |
| ------- | ------------------ | ------ | ---------------------------------------------- |
| Account | Workers R2 Storage | Edit   | create/delete bucket, public domain, lifecycle |
| User    | API Tokens         | Write  | mint/revoke the bucket-scoped upload key       |

Create it at <https://dash.cloudflare.com/profile/api-tokens> → Create Custom
Token, scope Account Resources to the specific account. A single combined token
is used everywhere — `--token` (or `CLOUDFLARE_API_TOKEN`) covers both concerns.

### Running the CLI against Cloudflare

Load `.env`, then invoke the CLI with Bun:

```sh
set -a; source .env; set +a
bun run --cwd packages/cli dev init --dry-run   # validate token + account, no changes
bun run --cwd packages/cli dev init             # real run: creates resources
bun run --cwd packages/cli dev doctor           # upload/read/cleanup self-test
bun run --cwd packages/cli dev destroy --yes    # tear everything down
```

Always use `--dry-run` first. It runs read-only Cloudflare calls to confirm the
token and account are valid, then prints the plan without mutating anything.

### Notes / gotchas

- `init` refuses to run if `~/.pigeon/config` already exists; run `destroy`
  first (or remove the file) to re-test.
- The scoped-key resource string in `cloudflare.ts` assumes the bucket lives in
  the **default** jurisdiction. Non-default (e.g. EU) buckets will fail token
  minting.
- `--with-key` skips minting and instead takes pre-made R2 S3 credentials
  (`--access-key-id` / `--secret-access-key`); only Workers R2 Storage · Edit is
  needed in that mode.
