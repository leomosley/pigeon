# Pigeon

Give coding agents a safe route for sharing screenshots and artifacts from any
machine, including headless servers.

Pigeon creates a Cloudflare R2 bucket, enables its public `r2.dev` route, sets a
90-day expiry policy, configures bucket-scoped upload credentials, and installs
an Agent Skill. It is a bootstrapper, not a background service.

## Install

```sh
npx p1geon init --account YOUR_CLOUDFLARE_ACCOUNT_ID
```

Set `CLOUDFLARE_API_TOKEN` to a bootstrap token with Workers R2 Storage Write.
For automatic upload-key creation, set `CLOUDFLARE_TOKEN_TOKEN` to a second token
made from Cloudflare's Create additional tokens template. Bootstrap tokens are
never stored.

To avoid API Tokens Write, create bucket-scoped R2 S3 credentials first:

```sh
npx p1geon init --account YOUR_CLOUDFLARE_ACCOUNT_ID --with-key
```

Agents need `aws-cli` to upload artifacts. See [pigeon.mosley.dev](https://pigeon.mosley.dev)
for full setup guidance.

## Commands

```text
pigeon init      Create route and install skill
pigeon env       Print shell-scoped upload environment
pigeon doctor    Test upload, public read, and cleanup
pigeon rotate    Replace Pigeon-managed upload credentials
pigeon destroy   Remove bucket, key, skill, and config
```

Config lives at `~/.pigeon/config` with mode `0600`. Shared skill source lives at
`~/.agents/skills/pigeon`; Pigeon links Claude's global skill directory when it
can do so without replacing existing files.

## Development

```sh
bun install
bun run typecheck
bun run lint
bun run test
```

Workspace layout:

- `packages/cli` — TypeScript CLI, Cloudflare/R2 integration, Agent Skill.
- `apps/web` — Astro landing page deployed to Vercel.

## Deployment

### npm

Add `NPM_TOKEN` to GitHub Actions secrets. Conventional commits merged to
`main` are versioned by git-cliff; the release workflow publishes
`p1geon` and creates a GitHub release.

### Vercel

1. Import `github.com/leomosley/pigeon` into Vercel.
2. Keep repository root as project root; `vercel.json` supplies build settings.
3. Add `pigeon.mosley.dev` under Project → Domains.
4. Point the prompted DNS record to Vercel.

No runtime environment variables are required by the static site.

## Security

Public artifact URLs are unlisted rather than private. Anyone with a URL can
read it until lifecycle deletion. Never upload secrets. The Cloudflare bucket
item “Write” permission also permits object read, list, overwrite, and delete through S3; it does
not grant bucket administration.

## License

MIT
