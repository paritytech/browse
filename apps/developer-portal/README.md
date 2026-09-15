# Developer Portal

A console for developers to publish the `.dot` domains they own to the browse
[Publisher registry](../../docs/publishing-registry.md).

Each owned domain shows as a product card. Publishing and unpublishing are signed
by the connected user root account, the account that owns the `.dot` token, so
publishing is gated on ownership plus the registry personhood and rate-limit
rules. A dry-run runs before every write to surface those gates as plain
messages, and reads run as dry-run calls that need no signature.

For the certificate-authority side (issuing compliance certifications), see
[ca-portal](../ca-portal/).

## Develop

```sh
bun run dev:paseo        # or dev:previewnet
```

The network comes from `NETWORK_GENESIS_HASH`, defaulting to Paseo.

## Verify

```sh
bun run typecheck
bun run lint
bun run build
```
