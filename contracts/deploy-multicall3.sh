#!/usr/bin/env bash
#
# deploy-multicall3.sh — Deploy Multicall3 to Polkadot Hub TestNet via Revive
#
# Uses Hardhat + @parity/hardhat-polkadot to compile with resolc and deploy
# through the ETH RPC endpoint (translates to Revive pallet extrinsics).
#
# Usage:
#   export CONTRACT_DEPLOY_SEED="your twelve word mnemonic phrase"
#   ./deploy-multicall3.sh
#
set -euo pipefail

RPC_URL="https://eth-rpc-testnet.polkadot.io"
EXPLORER="https://blockscout-passet-hub.parity-testnet.parity.io"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "${CONTRACT_DEPLOY_SEED:-}" ]; then
  echo "Error: CONTRACT_DEPLOY_SEED env var is required (mnemonic phrase)."
  echo ""
  echo "  export CONTRACT_DEPLOY_SEED=\"your twelve word mnemonic phrase here\""
  exit 1
fi

# Derive secp256k1 key from mnemonic (BIP-44 m/44'/60'/0'/0/0)
echo "--- Deriving deploy key ---"
PRIVATE_KEY=$(cast wallet private-key "$CONTRACT_DEPLOY_SEED")
DEPLOYER=$(cast wallet address "$PRIVATE_KEY")
echo "  EVM deployer: $DEPLOYER"

# Check balance
echo ""
echo "--- Checking balance ---"
BALANCE=$(cast balance "$DEPLOYER" --rpc-url "$RPC_URL" --ether 2>&1)
echo "  Balance: $BALANCE"

# Deploy via Hardhat Ignition + @parity/hardhat-polkadot
echo ""
echo "--- Deploying Multicall3 (Hardhat + resolc → PolkaVM → Revive) ---"
cd "$SCRIPT_DIR"

PRIVATE_KEY="$PRIVATE_KEY" npx hardhat ignition deploy \
  ignition/modules/Multicall3.ts \
  --network polkadotHubTestnet \
  2>&1 | tee /tmp/hardhat-deploy-output.txt

DEPLOY_OUTPUT=$(cat /tmp/hardhat-deploy-output.txt)

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
CHAIN_ID=$(cast call "$ADDRESS" "getChainId()(uint256)" --rpc-url "$RPC_URL" 2>&1 || echo "FAILED")
echo "  getChainId(): $CHAIN_ID"

# Write deployment log
cat > "$SCRIPT_DIR/deployments.json" << EOF
{
  "multicall3": {
    "address": "$ADDRESS",
    "deployer": "$DEPLOYER",
    "network": "polkadot-hub-testnet",
    "chainId": 420420417,
    "rpcUrl": "$RPC_URL",
    "explorer": "$EXPLORER/address/$ADDRESS",
    "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "compiler": "resolc v1.0.0, solc 0.8.30",
    "method": "hardhat ignition + @parity/hardhat-polkadot"
  }
}
EOF

# Copy ABI for the app
mkdir -p "$SCRIPT_DIR/../app/abis"
python3 -c "
import json
with open('artifacts/src/Multicall3.sol/Multicall3.json') as f:
    artifact = json.load(f)
with open('../app/abis/Multicall3.json', 'w') as f:
    json.dump(artifact['abi'], f, indent=2)
"

echo ""
echo "=== Deployment Complete ==="
echo "  Multicall3: $ADDRESS"
echo "  Chain ID:   420420417"
echo "  Explorer:   $EXPLORER/address/$ADDRESS"
echo "  Log:        $SCRIPT_DIR/deployments.json"
echo "  ABI:        $SCRIPT_DIR/../app/abis/Multicall3.json"
