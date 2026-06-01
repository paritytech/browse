import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  BIP39_EN_WORDLIST,
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  ss58Encode,
} from "@polkadot-labs/hdkd-helpers";
import { Binary, createClient } from "polkadot-api";
import { getPolkadotSigner } from "polkadot-api/signer";
import { getWsProvider } from "polkadot-api/ws-provider/node";

import { GenesisHashToNetworkConfig, type NetworkConfig } from "./network.ts";

export function requireEnv(name: string, hint?: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required.${hint ? " " + hint : ""}`);
    process.exit(1);
  }
  return value;
}

function mnemonicToEntropyUnchecked(mnemonic: string): Uint8Array {
  const words = mnemonic.normalize("NFKD").trim().split(/\s+/);
  const bits = words
    .map((w) => {
      const idx = BIP39_EN_WORDLIST.indexOf(w);
      if (idx === -1)
        throw new Error(`Word "${w}" is not in the BIP39 English wordlist`);
      return idx.toString(2).padStart(11, "0");
    })
    .join("");
  const entropyBits = (words.length * 11 * 32) / 33;
  const entropyBinary = bits.slice(0, entropyBits);
  const entropy = new Uint8Array(entropyBits / 8);
  for (let i = 0; i < entropy.length; i++) {
    entropy[i] = parseInt(entropyBinary.slice(i * 8, i * 8 + 8), 2);
  }
  return entropy;
}

export function getSigner() {
  const mnemonic = process.env.MNEMONIC ?? DEV_PHRASE;
  const derivationPath =
    process.env.DERIVATION_PATH ?? (process.env.MNEMONIC ? "" : "//Alice");

  let entropy: Uint8Array;
  try {
    entropy = mnemonicToEntropy(mnemonic);
  } catch {
    console.warn("⚠️  Mnemonic failed BIP39 checksum, proceeding unchecked");
    entropy = mnemonicToEntropyUnchecked(mnemonic);
  }
  const miniSecret = entropyToMiniSecret(entropy);
  const derive = sr25519CreateDerive(miniSecret);
  const keyPair = derive(derivationPath);
  return {
    signer: getPolkadotSigner(keyPair.publicKey, "Sr25519", keyPair.sign),
    address: ss58Encode(keyPair.publicKey),
  };
}

export function connect(): {
  client: ReturnType<typeof createClient>;
  api: ReturnType<ReturnType<typeof createClient>["getUnsafeApi"]>;
  config: NetworkConfig;
} {
  const genesisHash = requireEnv(
    "GENESIS_HASH",
    "Pick from evm/scripts/network.ts."
  );
  const config = GenesisHashToNetworkConfig[genesisHash];
  if (!config) {
    console.error(
      `No network config for GENESIS_HASH=${genesisHash}. See evm/scripts/network.ts for known networks.`
    );
    process.exit(1);
  }
  const client = createClient(getWsProvider(config.rpcEndpoints));
  return { client, api: client.getUnsafeApi(), config };
}

export async function waitBestBlock(tx: any, signer: any, label: string) {
  return new Promise<any>((resolve, reject) => {
    tx.signSubmitAndWatch(signer).subscribe({
      next: (event: any) => {
        console.log(`  ${event.type}`);
        if (event.type === "txBestBlocksState" && event.found) {
          if (event.ok) resolve(event);
          else
            reject(
              new Error(
                `${label} failed: ${JSON.stringify(event.dispatchError)}`
              )
            );
        }
      },
      error: reject,
    });
  });
}

export async function ensureMapped(api: any, signer: any) {
  console.log("\nMapping account to EVM address (if not already mapped)...");
  await new Promise<void>((resolve) => {
    api.tx.Revive.map_account()
      .signSubmitAndWatch(signer)
      .subscribe({
        next: (event: any) => {
          console.log(`  ${event.type}`);
          if (event.type === "finalized") {
            if (event.ok) console.log("  → mapped");
            else
              console.log(
                `  (already mapped: ${JSON.stringify(event.dispatchError)})`
              );
            resolve();
          }
        },
        error: (err: any) => {
          console.log(
            `  (map_account error — likely already mapped: ${
              err?.message ?? err
            })`
          );
          resolve();
        },
      });
  });
}

export async function deploy(
  api: any,
  signer: any,
  contractName: string,
  bytecodeHex: string
): Promise<string> {
  console.log(`\nDeploying ${contractName}...`);

  const code = Binary.fromHex(bytecodeHex);
  const data = Binary.fromHex("0x");

  const tx = api.tx.Revive.instantiate_with_code({
    value: 0n,
    weight_limit: { ref_time: 10_000_000_000n, proof_size: 1_000_000n },
    storage_deposit_limit: 1_000_000_000_000n,
    code,
    data,
    salt: undefined,
  });

  const event = await waitBestBlock(tx, signer, contractName);

  const instantiated = (event.events ?? []).find(
    (e: any) => e.type === "Revive" && e.value?.type === "Instantiated"
  );
  const contract = instantiated?.value?.value?.contract;
  const address =
    contract && typeof contract === "object" && "asHex" in contract
      ? contract.asHex()
      : String(contract);

  console.log(`  → ${contractName} deployed at ${address}`);
  return address;
}
