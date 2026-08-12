# Contributing

Requires Bun 1.2 or newer.

```sh
bun install
bun run typecheck
bun run lint
bun run test
```

Use conventional commits. Keep Cloudflare integration tests mocked; never add
credentials or live account IDs to fixtures. Changes to public CLI behavior
must update the website docs and README in the same pull request.
