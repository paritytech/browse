#!/usr/bin/env bash
#
# Usage:
#   ./deploy.sh [domain] [modality]
#
# modality: "spa" (default) deploys to <domain>.dot
#           "widget"        deploys to widget.<domain>.dot
#
# Prerequisites:
#   - bulletin-deploy: npm install -g bulletin-deploy
#   - MNEMONIC env var set (BIP39 mnemonic)
#   - Funded account: https://faucet.polkadot.io/
#
set -euo pipefail

DOMAIN="${1:-browse-beta00}"
MODALITY="${2:-spa}"

case "$MODALITY" in
  spa)
    FULL_DOMAIN="${DOMAIN}.dot"
    ;;
  widget)
    FULL_DOMAIN="widget.${DOMAIN}.dot"
    ;;
  *)
    echo "Error: unknown modality '$MODALITY'. Use 'spa' or 'widget'."
    exit 1
    ;;
esac

BUILD_SCRIPT="build:${MODALITY}"
BUILD_DIR="./dist/${MODALITY}"

if [ -z "${MNEMONIC:-}" ]; then
  echo "Error: MNEMONIC env var is required."
  echo ""
  echo "  export MNEMONIC=\"your twelve word mnemonic phrase here\""
  echo ""
  echo "Never put your mnemonic in a file or commit it to git."
  exit 1
fi

echo "==> Building..."
npm run "$BUILD_SCRIPT"

echo ""
echo "==> Deploying to ${FULL_DOMAIN}"

MNEMONIC="$MNEMONIC" \
NODE_OPTIONS="--max-old-space-size=8192" \
bulletin-deploy "$BUILD_DIR" "$FULL_DOMAIN"

echo ""
echo "==> Done! Live at:"
echo "    https://${FULL_DOMAIN}.li"
