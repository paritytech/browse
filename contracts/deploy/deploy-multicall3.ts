/**
 * deploy-multicall3.ts — Deploy Multicall3 to Asset Hub Paseo via Revive pallet
 *
 * Uses polkadot-api with Sr25519 signing. Deploys through Substrate's Revive
 * pallet (instantiate_with_code), not via the ETH RPC compatibility layer.
 *
 * Usage:
 *   CONTRACT_DEPLOY_SEED="your twelve word mnemonic" bun run deploy-multicall3.ts
 */

import { createClient } from "polkadot-api";
import { getPolkadotSigner } from "polkadot-api/signer";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { Binary } from "polkadot-api";
import { paseo } from "@polkadot-api/descriptors";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RPC_URL = "wss://asset-hub-paseo-rpc.n.dwellir.com";
const EXPLORER = "https://blockscout-passet-hub.parity-testnet.parity.io";

// Read the resolc-compiled bytecode from forge output
function loadBytecode(): string {
  const artifactPath = join(
    __dirname,
    "..",
    "out",
    "Multicall3.sol",
    "Multicall3.json"
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
  const bytecode = artifact.bytecode?.object;
  if (!bytecode || bytecode === "0x") {
    throw new Error("No bytecode found. Run `forge build --resolc` first.");
  }
  return bytecode;
}

async function main() {
  const seed = process.env.CONTRACT_DEPLOY_SEED;
  if (!seed) {
    console.error(
      "Error: CONTRACT_DEPLOY_SEED env var is required (mnemonic phrase)."
    );
    console.error("");
    console.error(
      '  CONTRACT_DEPLOY_SEED="your twelve word mnemonic" bun run deploy-multicall3.ts'
    );
    process.exit(1);
  }

  // 1. Load bytecode
  console.log("--- Loading bytecode ---");
  const bytecodeHex = loadBytecode();
  console.log(`  Bytecode size: ${(bytecodeHex.length - 2) / 2} bytes`);

  // 2. Setup keypair from mnemonic
  console.log("\n--- Setting up keypair ---");
  await cryptoWaitReady();
  const keyring = new Keyring({ type: "sr25519" });
  const account = keyring.addFromMnemonic(seed);
  const substrateAddress = account.address;
  console.log(`  Substrate: ${substrateAddress}`);

  const signer = getPolkadotSigner(
    account.publicKey,
    "Sr25519",
    async (input) => account.sign(input)
  );

  // 3. Connect to chain
  console.log(`\n--- Connecting to ${RPC_URL} ---`);
  const client = createClient(getWsProvider(RPC_URL));
  const api = client.getTypedApi(paseo);

  // 4. Get EVM address and check mapping
  console.log("\n--- Resolving EVM address ---");
  const evmAddressBinary = await api.apis.ReviveApi.address(substrateAddress);
  const evmAddress = evmAddressBinary.asHex();
  console.log(`  EVM: ${evmAddress}`);

  // 5. Ensure account is mapped
  console.log("\n--- Ensuring account mapped ---");
  try {
    const mappedAccount = await api.query.Revive.OriginalAccount.getValue(
      Binary.fromHex(evmAddress)
    );
    if (mappedAccount) {
      console.log("  Already mapped");
    } else {
      throw new Error("not mapped");
    }
  } catch {
    console.log("  Submitting map_account()...");
    try {
      await api.tx.Revive.map_account()
        .signSubmitAndWatch(signer)
        .then((events) => {
          return new Promise<void>((resolve, reject) => {
            events.subscribe({
              next: (event: any) => {
                if (event.type === "finalized") {
                  if (event.dispatchError) {
                    reject(
                      new Error(
                        `map_account failed: ${JSON.stringify(
                          event.dispatchError
                        )}`
                      )
                    );
                  } else {
                    resolve();
                  }
                }
              },
              error: reject,
            });
          });
        });
    } catch (err: any) {
      if (err?.message?.includes("AccountAlreadyMapped")) {
        console.log("  Already mapped (caught)");
      } else {
        throw err;
      }
    }
    console.log("  Account mapped");
  }

  // 6. Check balance
  console.log("\n--- Checking balance ---");
  const accountInfo = await (api as any).query.System.Account.getValue(
    substrateAddress
  );
  const free = BigInt(accountInfo.data.free);
  const decimals = 10;
  console.log(`  Balance: ${Number(free) / 10 ** decimals} PAS`);

  if (free < 1_000_000_000n) {
    console.error("Error: Insufficient balance for deployment");
    process.exit(1);
  }

  // 7. Deploy via Revive.instantiate_with_code
  console.log(
    "\n--- Deploying Multicall3 via Revive.instantiate_with_code ---"
  );

  const code = Binary.fromHex(bytecodeHex as `0x${string}`);
  const data = Binary.fromHex("0x"); // no constructor args

  const deployTx = api.tx.Revive.instantiate_with_code({
    value: 0n,
    weight_limit: {
      ref_time: 500_000_000_000n,
      proof_size: 500_000n,
    },
    storage_deposit_limit: 50_000_000_000_000n, // 5 PAS
    code,
    data,
  });

  const { txHash, contractAddress } = await new Promise<{
    txHash: string;
    contractAddress: string;
  }>((resolve, reject) => {
    let hash = "";
    let contract = "";
    deployTx.signSubmitAndWatch(signer).subscribe({
      next: (event: any) => {
        hash = event.txHash?.toString() ?? hash;
        switch (event.type) {
          case "signed":
            console.log("  Signed");
            break;
          case "broadcasted":
            console.log("  Broadcasted");
            break;
          case "txBestBlocksState":
            console.log("  Included in block");
            break;
          case "finalized":
            if (event.dispatchError) {
              reject(
                new Error(
                  `Deploy failed: ${JSON.stringify(event.dispatchError)}`
                )
              );
              return;
            }
            console.log("  Finalized");

            // Extract contract address from Revive.Instantiated event
            if (event.events) {
              for (const ev of event.events) {
                if (ev.type === "Revive" && ev.value?.type === "Instantiated") {
                  const addr = ev.value?.value?.contract;
                  if (addr) {
                    contract =
                      typeof addr.asHex === "function"
                        ? addr.asHex()
                        : `0x${addr}`;
                  }
                }
              }
            }

            resolve({ txHash: hash, contractAddress: contract });
            return;
          case "invalid":
          case "dropped":
            reject(new Error(`Transaction ${event.type}`));
            return;
        }
      },
      error: reject,
    });
  });

  console.log(`  TX: ${txHash}`);

  // 8. Report deployed address
  if (contractAddress) {
    console.log(`\n  ✓ Multicall3 deployed to: ${contractAddress}`);
  } else {
    console.log("\n  Warning: Could not extract contract address from events");
    console.log(`  Check explorer: ${EXPLORER}/tx/${txHash}`);
  }

  // 9. Write deployment log
  const deployLog = {
    multicall3: {
      address: contractAddress || "UNKNOWN — check explorer",
      txHash,
      deployer: substrateAddress,
      evmDeployer: evmAddress,
      network: "asset-hub-paseo",
      rpcUrl: RPC_URL,
      explorer: contractAddress
        ? `${EXPLORER}/address/${contractAddress}`
        : `${EXPLORER}/tx/${txHash}`,
      deployedAt: new Date().toISOString(),
      compiler: "resolc v1.0.0, solc 0.8.30",
      method: "Revive.instantiate_with_code",
    },
  };

  const logPath = join(__dirname, "..", "deployments.json");
  writeFileSync(logPath, JSON.stringify(deployLog, null, 2));
  console.log(`  Deployment log: ${logPath}`);

  // Copy ABI for the app
  const appAbisDir = join(__dirname, "..", "..", "app", "abis");
  mkdirSync(appAbisDir, { recursive: true });
  const artifactPath = join(
    __dirname,
    "..",
    "out",
    "Multicall3.sol",
    "Multicall3.json"
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
  writeFileSync(
    join(appAbisDir, "Multicall3.json"),
    JSON.stringify(artifact.abi, null, 2)
  );
  console.log(`  ABI: ${appAbisDir}/Multicall3.json`);

  console.log("\n=== Deployment Complete ===");
  if (contractAddress) {
    console.log(`  Multicall3: ${contractAddress}`);
    console.log(`  Explorer:   ${EXPLORER}/address/${contractAddress}`);
  }

  client.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error("\nDeployment failed:", err.message ?? err);
  process.exit(1);
});
