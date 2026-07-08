/**
 * Store certificate assets on Bulletin so the host preimage manager can resolve
 * them, then print each asset's CIDv1(raw, blake2b-256) — the exact shape the
 * app resolves (icon CIDs use the same scheme). Mirrors how bulletin-deploy
 * uploads a product icon: one blob per file via TransactionStorage.store_with_cid_config.
 *
 *   MNEMONIC="…" bun evm/scripts/upload-certificate-content.ts [paseo|previewnet]
 *
 * Uploads every asset in ASSETS (badge image + description markdown). Feed the
 * printed contentCid / badgeIconCid into attest-compliance to certify a domain.
 * The signer (//wallet) must be authorized to store on the target Bulletin.
 */

import { readFileSync } from "node:fs";

import { blake2b } from "@noble/hashes/blake2b";
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

// Multibase base32 (lower, no padding) — the "b" CIDv1 alphabet.
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
// CIDv1 prefix for (codec=raw 0x55, multihash=blake2b-256 0xb220, length=32).
const CIDV1_PREFIX = new Uint8Array([0x01, 0x55, 0xa0, 0xe4, 0x02, 0x20]);

// Certificate assets to store. Each is uploaded and its CID printed.
const ASSETS = [
  { label: "badgeIconCid", file: "parity-user-interface-compliance-badge.svg" },
  { label: "contentCid", file: "parity-user-interface-compliance.md" },
];

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

/** Multibase base32 (lower, no padding) of a byte array. */
function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let buf = 0;
  for (const b of bytes) {
    buf = (buf << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(buf >> bits) & 0x1f];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buf << (5 - bits)) & 0x1f];
  return out;
}

/** The CIDv1(raw, blake2b-256) string for a blake2b-256 digest. */
function digestToCid(digest: Uint8Array): string {
  const full = new Uint8Array(CIDV1_PREFIX.length + digest.length);
  full.set(CIDV1_PREFIX);
  full.set(digest, CIDV1_PREFIX.length);
  return `b${base32Encode(full)}`;
}

// Known digest→CID vector from the original upload-certificate-content.ts. Guards
// the base32/prefix encoding: if this drifts, every emitted CID would be wrong.
function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
{
  const ref = digestToCid(
    hexToBytes("0xb5cc1a4d8efe1d0911c1a75e64bddaeee72c9791910d24af95736611e86d3ee8"),
  );
  const expected = "bafk2bzacec24ygsnr37b2cirygtv4zf53lxoolexsgiq2jfpsvzwmepinu7oq";
  if (ref !== expected) {
    throw new Error(`CID encoding self-check failed: ${ref} !== ${expected}`);
  }
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
    for (const asset of ASSETS) {
      const bytes = new Uint8Array(
        readFileSync(
          new URL(`../../certificates/${asset.file}`, import.meta.url),
        ),
      );
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
