/**
 * Store certificate assets on Bulletin so the host preimage manager can resolve
 * them, then print each asset's CIDv1(raw, blake2b-256) — the exact shape the
 * app resolves (icon CIDs use the same scheme). Mirrors how bulletin-deploy
 * uploads a product icon: one blob per file via TransactionStorage.store_with_cid_config.
 *
 *   MNEMONIC="…" bun evm/scripts/upload-certificate-content.ts [paseo|previewnet]
 *
 * Uploads every asset in CERTIFICATE_ASSETS (badge image + description markdown). Feed the
 * printed contentCid / badgeIconCid into attest-compliance to certify a domain.
 * The signer (//wallet) must be authorized to store on the target Bulletin.
 */

import { blake2b } from "@noble/hashes/blake2.js";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  entropyToMiniSecret,
  mnemonicToEntropy,
  ss58Encode,
} from "@polkadot-labs/hdkd-helpers";
import {
  isKnownGenesis,
  type NetworkGenesis,
  PASEONEXTV2_ASSETHUB_GENESIS,
  PREVIEWNET_ASSETHUB_GENESIS,
} from "@parity/browse-sdk/config";
import { Binary, createClient, Enum } from "polkadot-api";
import { getPolkadotSigner } from "polkadot-api/signer";
import { getWsProvider } from "polkadot-api/ws-provider/node";

import {
  CERTIFICATE_ASSETS,
  digestToCid,
  readCertificateFile,
} from "./certificate-cids.ts";

// Raw codec, the shape the host preimage bridge resolves (icon CIDs too).
const RAW_CODEC = 0x55n;

// The account that signs the store. Must be authorized on the Bulletin chain.
const SIGNER_PATH = "//wallet";

const BULLETIN_RPC_BY_GENESIS: Partial<Record<NetworkGenesis, string>> = {
  [PASEONEXTV2_ASSETHUB_GENESIS]: "wss://paseo-bulletin-next-rpc.polkadot.io",
  [PREVIEWNET_ASSETHUB_GENESIS]: "wss://previewnet.substrate.dev/bulletin",
};

const GENESIS_BY_ALIAS: Record<string, NetworkGenesis> = {
  paseo: PASEONEXTV2_ASSETHUB_GENESIS,
  previewnet: PREVIEWNET_ASSETHUB_GENESIS,
};

function resolveGenesis(): NetworkGenesis {
  const envGenesis = process.env.NETWORK_GENESIS_HASH;
  if (envGenesis) {
    if (!isKnownGenesis(envGenesis)) {
      console.error(`Unknown NETWORK_GENESIS_HASH: ${envGenesis}`);
      process.exit(1);
    }
    return envGenesis;
  }
  const alias = (process.argv[2] ?? "paseo").toLowerCase();
  const genesis = GENESIS_BY_ALIAS[alias];
  if (!genesis) {
    console.error(
      `Unknown network alias '${alias}'. Use: ${Object.keys(GENESIS_BY_ALIAS).join(", ")}`,
    );
    process.exit(1);
  }
  return genesis;
}

function toHex(bytes: Uint8Array): string {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function main(): Promise<void> {
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    console.error("MNEMONIC env is required to store certificate content");
    process.exit(1);
  }
  const genesis = resolveGenesis();
  const bulletinRpc = BULLETIN_RPC_BY_GENESIS[genesis];
  if (!bulletinRpc) {
    console.error(`No Bulletin RPC configured for network ${genesis}`);
    process.exit(1);
  }

  const derive = sr25519CreateDerive(
    entropyToMiniSecret(mnemonicToEntropy(mnemonic)),
  );
  const kp = derive(SIGNER_PATH);
  const signer = getPolkadotSigner(kp.publicKey, "Sr25519", kp.sign);

  console.log(`network:  ${genesis}`);
  console.log(`bulletin: ${bulletinRpc}`);
  console.log(`signer:   ${ss58Encode(kp.publicKey, 42)} (${SIGNER_PATH})\n`);

  const client = createClient(getWsProvider(bulletinRpc));
  const cids: Record<string, string> = {};
  let failures = 0;
  try {
    const api = client.getUnsafeApi();
    for (const asset of CERTIFICATE_ASSETS) {
      const bytes = readCertificateFile(asset.file);
      const digest = blake2b(bytes, { dkLen: 32 });
      const cid = digestToCid(digest);
      cids[asset.label] = cid;
      console.log(`${asset.label}: ${asset.file}`);
      console.log(`  bytes:  ${bytes.length}`);
      console.log(`  digest: ${toHex(digest)}`);
      console.log(`  cid:    ${cid}`);

      const tx = api.tx.TransactionStorage.store_with_cid_config({
        cid: { codec: RAW_CODEC, hashing: Enum("Blake2b256") },
        data: Binary.fromHex(toHex(bytes)),
      });
      try {
        await new Promise<void>((resolve, reject) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sub = tx.signSubmitAndWatch(signer).subscribe({
            next: (e: any) => {
              if (e.type === "txBestBlocksState" && e.found) {
                sub.unsubscribe();
                if (e.ok) resolve();
                else
                  reject(
                    new Error(
                      `store failed: ${JSON.stringify(e.dispatchError ?? {})}`,
                    ),
                  );
              }
            },
            error: reject,
          });
        });
        console.log(`  → stored ✅\n`);
      } catch (err) {
        const msg = (err as Error).message;
        // A duplicate CID (already stored) is benign; anything else — notably a
        // "Payment" invalid (signer can't cover the storage deposit) — is fatal.
        if (/already|exist|duplicate/i.test(msg)) {
          console.log(`  → already stored ✅\n`);
        } else {
          failures++;
          console.log(`  → store FAILED: ${msg}\n`);
        }
      }
    }

    if (failures > 0) {
      console.error(
        `${failures} asset(s) failed to store. A "Payment" invalid means the ` +
          `${SIGNER_PATH} signer isn't funded/authorized on this Bulletin chain.`,
      );
      process.exitCode = 1;
      return;
    }

    console.log("Attest with:");
    console.log(
      `  NETWORK_GENESIS_HASH=${genesis} bun run attest:compliance <domain> "${cids.contentCid}" "${cids.badgeIconCid}" "<name>"`,
    );
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
