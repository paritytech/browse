/**
 * Store the certificate description on Bulletin so the host preimage manager can
 * resolve it. Mirrors how bulletin-deploy uploads the product icon: a single
 * CIDv1(raw, blake2b-256) blob via TransactionStorage.store_with_cid_config.
 *
 *   MNEMONIC="…" bun evm/scripts/upload-certificate-content.ts [paseo|previewnet]
 *
 * The signer (//wallet) must be authorized to store on the target Bulletin.
 */

import { readFileSync } from "node:fs";

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
  PASEO_ASSETHUB_NEXT_V2_GENESIS,
  PREVIEWNET_ASSETHUB_GENESIS,
} from "@parity/browse-sdk/config";
import { Binary, createClient, Enum } from "polkadot-api";
import { getPolkadotSigner } from "polkadot-api/signer";
import { getWsProvider } from "polkadot-api/ws-provider/node";

// Raw codec, the shape the host preimage bridge resolves (icon CIDs too).
const RAW_CODEC = 0x55n;

// Keep in sync with CERTIFICATE.contentCid in app/src/lib/certificates.ts. The
// digest is the blake2b-256 embedded in that CID, used as a drift guard below.
const EXPECTED_CID =
  "bafk2bzacec24ygsnr37b2cirygtv4zf53lxoolexsgiq2jfpsvzwmepinu7oq";
const EXPECTED_DIGEST =
  "0xb5cc1a4d8efe1d0911c1a75e64bddaeee72c9791910d24af95736611e86d3ee8";

// The account that signs the store. Must be authorized on the Bulletin chain.
const SIGNER_PATH = "//wallet";

const BULLETIN_RPC_BY_GENESIS: Partial<Record<NetworkGenesis, string>> = {
  [PASEO_ASSETHUB_NEXT_V2_GENESIS]: "wss://paseo-bulletin-next-rpc.polkadot.io",
  [PREVIEWNET_ASSETHUB_GENESIS]: "wss://previewnet.substrate.dev/bulletin",
};

const GENESIS_BY_ALIAS: Record<string, NetworkGenesis> = {
  paseo: PASEO_ASSETHUB_NEXT_V2_GENESIS,
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
    console.error("MNEMONIC env is required to store the certificate content");
    process.exit(1);
  }
  const genesis = resolveGenesis();
  const bulletinRpc = BULLETIN_RPC_BY_GENESIS[genesis];
  if (!bulletinRpc) {
    console.error(`No Bulletin RPC configured for network ${genesis}`);
    process.exit(1);
  }

  const bytes = new Uint8Array(
    readFileSync(
      new URL(
        "../../certificates/parity-user-interface-compliance.md",
        import.meta.url,
      ),
    ),
  );
  const digest = toHex(blake2b(bytes, { dkLen: 32 }));
  console.log(`network:  ${genesis}`);
  console.log(`bulletin: ${bulletinRpc}`);
  console.log(`bytes:    ${bytes.length}`);
  console.log(`cid:      ${EXPECTED_CID}`);
  console.log(`digest:   ${digest}`);

  // Guard against drift: if the markdown changed, its digest no longer matches
  // the configured CID and the modal would still fail to resolve it.
  if (digest !== EXPECTED_DIGEST) {
    console.error(
      `Digest mismatch: markdown hashes to ${digest} but the configured CID embeds ${EXPECTED_DIGEST}. ` +
        `Regenerate CERTIFICATE.contentCid (and EXPECTED_* here) from the current markdown.`,
    );
    process.exit(1);
  }

  const derive = sr25519CreateDerive(
    entropyToMiniSecret(mnemonicToEntropy(mnemonic)),
  );
  const kp = derive(SIGNER_PATH);
  const signer = getPolkadotSigner(kp.publicKey, "Sr25519", kp.sign);
  console.log(`signer:   ${ss58Encode(kp.publicKey, 42)} (${SIGNER_PATH})\n`);

  const client = createClient(getWsProvider(bulletinRpc));
  try {
    const api = client.getUnsafeApi();
    const tx = api.tx.TransactionStorage.store_with_cid_config({
      cid: { codec: RAW_CODEC, hashing: Enum("Blake2b256") },
      data: Binary.fromHex(toHex(bytes)),
    });
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
                  `store failed in block: ${JSON.stringify(e.dispatchError ?? {})}`,
                ),
              );
          }
        },
        error: reject,
      });
    });
    console.log("✅ Certificate content stored on Bulletin.");
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
