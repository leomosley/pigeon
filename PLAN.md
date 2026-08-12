# Pigeon — Plan

## Purpose

Let an AI coding agent running on any machine (including a headless server with
no display) share an artifact with a human by uploading it to Cloudflare R2 and
returning a public URL. Flagship use case: screenshots.

The human problem it solves: an agent works on a remote/headless box the human
can't see. `pigeon` bridges that box to a shareable link.

## Architecture at a glance

- **`pigeon` CLI** — a one-time bootstrapper. It creates the R2 bucket, auths the
  environment to push, and installs the skill. It does NOT push files itself.
- **`pigeon` skill** — instructions the agent follows to capture/produce an
  artifact and upload it using the credentials pigeon configured.
- **Cloudflare R2** — S3-compatible object storage. Public reads via the
  `r2.dev` managed domain; authenticated writes via a bucket-scoped key.

Two separate auth concerns, deliberately kept apart:

1. Creating the bucket (one-time admin action, setup machine only).
2. Pushing objects (repeated, done with a narrow write-only key — never the
   human's admin login).

## Decisions

| Area             | Decision                                                      |
| ---------------- | ------------------------------------------------------------- |
| CLI language     | TypeScript + Bun (single binary via `bun build --compile`)    |
| Landing page     | Astro + TypeScript + TailwindCSS                              |
| Monorepo         | Turborepo + Bun, scope `@leomosley`                           |
| Config format    | TOML at `~/.pigeon/config` (chmod 600)                        |
| Public reads     | `r2.dev` dev URL (frictionless; rate-limited, non-production) |
| Push tool        | `aws-cli` (skill sources creds from `pigeon env`)             |
| Credential store | `~/.pigeon/config` only — never mutate `~/.aws/credentials`   |
| Skill scope      | General "share an artifact" primitive; screenshot is flagship |
| Multi-machine    | Init-per-machine; each mints its own revocable write-only key |
| Object expiry    | Lifecycle auto-delete after 90 days (`--retention-days`)      |
| Bucket creds     | Auto-mint scoped key; `--with-key` escape hatch for low priv  |
| Deploy (web)     | Vercel (git integration; no Terraform infra)                  |

## Prerequisite (setup machine, one-time)

`CLOUDFLARE_API_TOKEN` + account ID. Token permissions:

- **R2 Admin** — create bucket, set lifecycle, enable public domain.
- **API Tokens Write** — mint the scoped push key.

Low-privilege alternative: `pigeon init --with-key <r2-write-key>` skips minting
and takes a pre-made R2 write key, avoiding the API-Tokens-Write permission.

## CLI command surface

```
pigeon init      create bucket + enable r2.dev + mint bucket-scoped write-only key
                 + 90-day lifecycle rule + write config + self-test upload
                 + install skill + symlink into detected agent dirs
                 flags: --account --bucket --retention-days(=90) --with-key
pigeon env       print `export AWS_ACCESS_KEY_ID=… …` lines for the skill to source
pigeon rotate    mint a fresh key, revoke the old one
pigeon destroy   revoke key + delete bucket + remove skill/symlinks + config
pigeon doctor    verify config + creds + public URL end-to-end
```

`pigeon push` is deliberately absent — pushing lives in the skill via `aws s3 cp`.
`pigeon env` is the glue that makes that one-liner work without touching `~/.aws`.

## `pigeon init` flow (all verified against Cloudflare docs)

```
1. POST /accounts/{acct}/r2/buckets                          name: pigeon-<uuid>
2. PUT  .../buckets/{bucket}/domains/managed {enabled:true}  → public_base_url
3. PUT  .../buckets/{bucket}/lifecycle                       delete after retention_days
4. POST create-token (perm: "Workers R2 Storage Bucket Item Write",
                      scoped to this bucket only)
5. access_key_id = token.id ; secret_access_key = sha256(token.value)
6. write ~/.pigeon/config (TOML, chmod 600)
7. self-test: PutObject a probe object → GET public URL → delete probe
8. install ~/.agents/skills/pigeon/SKILL.md
   + symlink into detected agent dirs (opencode, claude, cursor, …)
```

## Config (`~/.pigeon/config`, chmod 600)

```toml
account_id        = "..."
bucket            = "pigeon-<uuid>"
endpoint          = "https://<account_id>.r2.cloudflarestorage.com"
public_base_url   = "https://pub-<hash>.r2.dev"
access_key_id     = "..."   # bucket-scoped, write-only
secret_access_key = "..."
retention_days    = 90
```

## Skill (`pigeon`) — general artifact share

1. Have a file to share. Flagship recipe: capture a screenshot, cross-platform:
   - macOS: `screencapture -x`
   - Windows: PowerShell `CopyFromScreen`
   - Linux Wayland: `grim`
   - Linux X11: `maim` → `scrot` → `import`
   - Headless: `chromium --headless --screenshot` (for URLs / web apps)
2. Upload with the credentials pigeon configured:
   ```sh
   eval "$(pigeon env)"
   key="$(uuidgen).png"
   aws s3 cp "$file" "s3://<bucket>/$key" \
     --endpoint-url "$PIGEON_ENDPOINT" --content-type image/png
   echo "https://pub-<hash>.r2.dev/$key"
   ```
3. Give the human the returned URL.

Content-Type is set explicitly so `r2.dev` links render inline in the browser
instead of forcing a download.

## Security posture

- Bootstrap token is never persisted; only a bucket-scoped, write-only key lands
  in the config.
- Public access is read-only. Object keys are UUIDs for uniqueness/obscurity.
- 90-day auto-expiry keeps the bucket clean and costs bounded.
- `pigeon destroy` fully reverses everything (key, bucket, skill, config).

## Verified Cloudflare facts

- S3 push creds can be minted programmatically: the Create Token API returns a
  token whose `id` is the Access Key ID and whose `sha256(value)` is the Secret
  Access Key.
- Public reads via `PUT .../buckets/{bucket}/domains/managed {enabled:true}`,
  which returns the `pub-<hash>.r2.dev` domain in its response.
- `PutObject` is supported by the R2 S3 API, including `Content-Type`.
- Lifecycle rules via `PutBucketLifecycleConfiguration` are supported.

## Project skeleton (to scaffold)

Monorepo (Turborepo + Bun):

```
pigeon/
  apps/
    web/            Astro + TS + Tailwind landing page
  packages/
    cli/            the pigeon CLI (commander, @clack/prompts, chalk, ora, zod)
  scripts/
  .github/
    workflows/
      ci.yml        typecheck + lint (web + cli)
      release.yml   npm publish + git-cliff changelog + GitHub release (cli)
    CODEOWNERS
    dependabot.yml  (terraform block dropped — no infra)
  .vscode/
  package.json      root workspace
  turbo.json
  tsconfig.json
  bunfig.toml
  cliff.toml        changelog config for the CLI release
  .prettierrc.astro .prettierignore .gitignore
  README.md LICENSE CONTRIBUTING.md
```

No Terraform `infra/` — the landing page deploys to Vercel via its git
integration. Source code for `apps/web` and `packages/cli` is added after the
skeleton (this plan produces the skeleton, not the implementation).
