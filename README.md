# Pigeon

Give coding agents a safe route for sharing screenshots and artifacts from any
machine, including headless servers.

Pigeon creates a Cloudflare R2 bucket, enables its public `r2.dev` route, sets a
90-day expiry policy, configures bucket-scoped upload credentials, and installs
an Agent Skill. It is a bootstrapper, not a background service.

## Install

```sh
p1geon init --account YOUR_CLOUDFLARE_ACCOUNT_ID
```

### Create your Cloudflare token (step by step)

Pigeon needs **one** Cloudflare API token carrying **two** permissions. Follow
these exactly:

1. Go to <https://dash.cloudflare.com/profile/api-tokens>.
2. Click **Create Token**.
3. Scroll to the bottom and, next to **Create Custom Token**, click **Get started**
   (do not use a template).
4. In **Token name**, type `p1geon`.
5. Under **Permissions**, set the first row of dropdowns to:
   **Account** → **Workers R2 Storage** → **Edit**.
6. Click **+ Add more** and set the second row to:
   **User** → **API Tokens** → **Write**.

   You should end up with exactly:

   | Group   | Item               | Access |
   | ------- | ------------------ | ------ |
   | Account | Workers R2 Storage | Edit   |
   | User    | API Tokens         | Write  |

7. Under **Account Resources**, leave **Include** and pick **your account**
   (not "All accounts").
8. Leave **Client IP Address Filtering** and **TTL** blank.
9. Click **Continue to summary**, then **Create Token**.
10. **Copy the token now** — Cloudflare shows it only once.

**Find your Account ID:** in the dashboard, open **R2 Object Storage** → the
**Account ID** is in the right sidebar (it's also in the URL after
`dash.cloudflare.com/`).

**Use them:** run the command above and paste the token when prompted, or set
`CLOUDFLARE_API_TOKEN` in your environment first. The token is never stored.

Add `--dry-run` to validate the token and account and print the plan without
creating anything.

To avoid granting API Tokens Write, create bucket-scoped R2 S3 credentials first
and hand them to Pigeon (only Workers R2 Storage · Edit is then required):

```sh
p1geon init --account YOUR_CLOUDFLARE_ACCOUNT_ID --with-key
```

Agents need `aws-cli` to upload artifacts. See [pigeon.mosley.dev](https://pigeon.mosley.dev)
for full setup guidance.

## Commands

```text
p1geon init      Create route and install skill
p1geon env       Print shell-scoped upload environment
p1geon doctor    Test upload, public read, and cleanup
p1geon skills    Reinstall the agent skills, overwriting what is on disk
p1geon rotate    Replace Pigeon-managed upload credentials
p1geon destroy   Remove bucket, key, skill, and config
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
2. Set Root Directory to `apps/web`; its `vercel.json` supplies build settings.
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
