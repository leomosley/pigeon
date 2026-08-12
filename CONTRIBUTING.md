# Contributing

Leo Mosley (`@leomosley`) is the lead maintainer and final reviewer for Pigeon.

Open an issue or discussion before starting a large change. Small fixes can go
directly to a pull request. Pull requests require passing CI, focused scope, and
maintainer review.

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

By participating, you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities through the process in [.github/SECURITY.md](.github/SECURITY.md),
not through public issues.
