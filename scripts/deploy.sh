#!/usr/bin/env bash
#
# deploy.sh — Deploy browse to Polkadot via DotNS
#
# Usage:
#   ./deploy.sh [name]
#
# Defaults to "browse" if no name given (deploys to browse.dot.li).
#
# Prerequisites:
#   - dotns CLI installed: cd dotns-sdk/packages/cli && bun install && bun run build && npm link
#   - DOTNS_MNEMONIC env var set (BIP39 mnemonic)
#   - Funded account: https://faucet.polkadot.io/
#   - jq installed
#
set -euo pipefail

NAME="${1:-browse}"
BUILD_DIR="./dist"
BULLETIN_RPC="${DOTNS_BULLETIN_RPC:-wss://paseo-bulletin-rpc.polkadot.io}"

if [ -z "${DOTNS_MNEMONIC:-}" ]; then
  echo "Error: DOTNS_MNEMONIC env var is required."
  echo ""
  echo "  export DOTNS_MNEMONIC=\"your twelve word mnemonic phrase here\""
  echo ""
  echo "Never put your mnemonic in a file or commit it to git."
  exit 1
fi

# Bulletin commands need explicit --rpc to the Bulletin chain.
# Domain commands (lookup, register, content) use the dotns CLI's built-in
# Asset Hub default (wss://asset-hub-paseo-rpc.n.dwellir.com) — don't override.
MNEMONIC_ARG=(--mnemonic "$DOTNS_MNEMONIC")
BULLETIN_AUTH=("${MNEMONIC_ARG[@]}" --rpc "$BULLETIN_RPC")

# 1. Build
echo "==> Building..."
npm run build

echo ""
echo "==> Deploying to ${NAME}.dot"

# 2. Authorize account for Bulletin TransactionStorage
echo ""
echo "--- Step 1: Authorize account for Bulletin ---"
ADDRESS=$(dotns account address "${MNEMONIC_ARG[@]}")
echo "Account: $ADDRESS"

dotns bulletin authorize "$ADDRESS" "${BULLETIN_AUTH[@]}" || {
  echo "(already authorized — continuing)"
}

# 3. Upload to Bulletin
echo ""
echo "--- Step 2: Upload to Bulletin ---"
RESULT=$(dotns bulletin upload "$BUILD_DIR" --json --parallel "${BULLETIN_AUTH[@]}")
CID=$(echo "$RESULT" | jq -r '.cid')
echo "CID: $CID"

# 4. Register domain (if needed)
echo ""
echo "--- Step 3: Register domain (if needed) ---"

LOOKUP=$(dotns lookup name "$NAME" --json "${MNEMONIC_ARG[@]}" 2>&1 || true)
EXISTS=$(echo "$LOOKUP" | jq -r '.exists' 2>/dev/null || echo "false")

if [ "$EXISTS" != "true" ]; then
  echo "Registering ${NAME}.dot ..."
  dotns register domain --name "$NAME" "${MNEMONIC_ARG[@]}"
else
  echo "${NAME}.dot already registered — skipping"
fi

# 5. Set contenthash
echo ""
echo "--- Step 4: Set contenthash ---"
dotns content set "$NAME" "$CID" "${MNEMONIC_ARG[@]}"

echo ""
echo "==> Done! Live at:"
echo "    https://${NAME}.dot.li"
