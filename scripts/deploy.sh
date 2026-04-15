#!/usr/bin/env bash
#
# deploy.sh — Build and deploy browse to Polkadot via bulletin-deploy
#
# Usage:
#   ./deploy.sh [name]
#
# Defaults to "browse-beta00" if no name given (deploys to browse-beta00.dot).
#
# Prerequisites:
#   - bulletin-deploy: npm install -g bulletin-deploy
#   - MNEMONIC env var set (BIP39 mnemonic)
#   - Funded account: https://faucet.polkadot.io/
#
set -euo pipefail

NAME="${1:-browse-beta00}"
DOMAIN="${NAME}.dot"
BUILD_DIR="./dist"

if [ -z "${MNEMONIC:-}" ]; then
  echo "Error: MNEMONIC env var is required."
  echo ""
  echo "  export MNEMONIC=\"your twelve word mnemonic phrase here\""
  echo ""
  echo "Never put your mnemonic in a file or commit it to git."
  exit 1
fi

echo "==> Building..."
npm run build

echo ""
echo "==> Deploying to ${DOMAIN}"

MNEMONIC="$MNEMONIC" \
NODE_OPTIONS="--max-old-space-size=8192" \
bulletin-deploy "$BUILD_DIR" "$DOMAIN"

echo ""
echo "==> Done! Live at:"
echo "    https://${NAME}.dot.li"
