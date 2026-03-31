#!/usr/bin/env bash
#
# deploy-store.sh — Deploy Store to Polkadot Hub TestNet via Revive
#
# Uses Hardhat + @parity/hardhat-polkadot to compile with resolc and deploy
# through the ETH RPC endpoint (translates to Revive pallet extrinsics).
#
# Usage:
#   export MNEMONIC="your twelve word mnemonic phrase"
#   ./deploy-store.sh
#
set -euo pipefail

RPC_URL="https://eth-rpc-testnet.polkadot.io"
EXPLORER="https://blockscout-passet-hub.parity-testnet.parity.io"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "${MNEMONIC:-}" ]; then
  echo "Error: MNEMONIC env var is required."
  echo ""
  echo "  export MNEMONIC=\"your twelve word mnemonic phrase here\""
  echo "  # or: source .env"
  exit 1
fi

# Derive secp256k1 key from mnemonic (BIP-44 m/44'/60'/0'/0/0)
echo "--- Deriving deploy key ---"
PRIVATE_KEY=$(cast wallet private-key "$MNEMONIC")
DEPLOYER=$(cast wallet address "$PRIVATE_KEY")
echo "  EVM deployer: $DEPLOYER"

# Check balance
echo ""
echo "--- Checking balance ---"
BALANCE=$(cast balance "$DEPLOYER" --rpc-url "$RPC_URL" --ether 2>&1)
echo "  Balance: $BALANCE"

# Deploy via Hardhat Ignition + @parity/hardhat-polkadot
echo ""
echo "--- Deploying Store (Hardhat + resolc → PolkaVM → Revive) ---"
cd "$SCRIPT_DIR"

echo "y" | PRIVATE_KEY="$PRIVATE_KEY" npx hardhat ignition deploy \
  ignition/modules/Store.ts \
  --network polkadotHubTestnet \
  2>&1 | tee /tmp/hardhat-deploy-store-output.txt

DEPLOY_OUTPUT=$(cat /tmp/hardhat-deploy-store-output.txt)

# Extract deployed address from Hardhat Ignition output
ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -oE '0x[0-9a-fA-F]{40}' | tail -1)

if [ -z "$ADDRESS" ]; then
  echo ""
  echo "Error: Could not extract deployed address from output"
  exit 1
fi

# Verify the contract
echo ""
echo "--- Verifying deployment ---"
PRODUCT_COUNT=$(cast call "$ADDRESS" "productCount()(uint32)" --rpc-url "$RPC_URL" 2>&1 || echo "FAILED")
echo "  productCount(): $PRODUCT_COUNT"

# Update deployment log
DEPLOYMENTS_FILE="$SCRIPT_DIR/deployments.json"
if [ -f "$DEPLOYMENTS_FILE" ]; then
  python3 -c "
import json
with open('$DEPLOYMENTS_FILE') as f:
    data = json.load(f)
data['store'] = {
    'address': '$ADDRESS',
    'deployer': '$DEPLOYER',
    'network': 'polkadot-hub-testnet',
    'chainId': 420420417,
    'rpcUrl': '$RPC_URL',
    'explorer': '$EXPLORER/address/$ADDRESS',
    'deployedAt': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'compiler': 'resolc v1.0.0, solc 0.8.30',
    'method': 'hardhat ignition + @parity/hardhat-polkadot'
}
with open('$DEPLOYMENTS_FILE', 'w') as f:
    json.dump(data, f, indent=2)
"
fi

echo ""
echo "=== Deployment Complete ==="
echo "  Store:    $ADDRESS"
echo "  Chain ID: 420420417"
echo "  Explorer: $EXPLORER/address/$ADDRESS"
echo "  Log:      $DEPLOYMENTS_FILE"
