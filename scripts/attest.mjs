#!/usr/bin/env node
/**
 * attest.mjs — Attest (recommend) an app on the AttestationRegistry.
 *
 * This creates a "browse.favourite.v1" attestation from the given account,
 * which makes the app appear in the Following tab for anyone who has
 * that account as a contact.
 *
 * Usage:
 *   node scripts/attest.mjs <label>            # Attest using //Alice
 *   SEED="//Bob" node scripts/attest.mjs <label>
 *
 * Examples:
 *   node scripts/attest.mjs browse
 *   node scripts/attest.mjs getsome
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, "../app/package.json"));

const { ApiPromise, WsProvider } = require("@polkadot/api");
const { Keyring } = require("@polkadot/keyring");
const {
  cryptoWaitReady,
  decodeAddress,
  keccakAsU8a,
} = require("@polkadot/util-crypto");

const { keccak_256 } = require("@noble/hashes/sha3.js");

const RPC_ENDPOINTS = [
  "wss://sys.ibp.network/asset-hub-paseo",
  "wss://asset-hub-paseo.dotters.network",
  "wss://asset-hub-paseo-rpc.dwellir.com",
];

const ATTESTATION_REGISTRY = "0x4d018C530E01BbC98b042a18A4D4090658BCd8f3";

const SCHEMA_FAVOURITE =
  "0x" +
  Array.from(keccak_256(new TextEncoder().encode("browse.favourite.v1")), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

const SEED = process.env.SEED || "//Alice";

function toHex(bytes) {
  return (
    "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  );
}

function strip(hex) {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function pad32(hex) {
  return strip(hex).padStart(64, "0");
}

function selector(sig) {
  return toHex(keccak_256(new TextEncoder().encode(sig)).slice(0, 4)).slice(2);
}

function namehash(name) {
  let node = new Uint8Array(32);
  if (!name) return toHex(node);
  for (const label of name.split(".").reverse()) {
    const labelHash = keccak_256(new TextEncoder().encode(label));
    const combined = new Uint8Array(64);
    combined.set(node, 0);
    combined.set(labelHash, 32);
    node = new Uint8Array(keccak_256(combined));
  }
  return toHex(node);
}

function nodeToSubject(node) {
  return "0x" + strip(node).padStart(64, "0").slice(24);
}

function deriveEvmAddress(ss58Address) {
  const pubkey = decodeAddress(ss58Address);
  const hash = keccakAsU8a(pubkey);
  return toHex(hash.slice(-20));
}

function encodeAttest(subject, schema, value, expiry) {
  const sel = selector("attest(address,bytes32,bytes32,uint64)");
  return `0x${sel}${pad32(subject)}${pad32(schema)}${pad32(value)}${pad32(BigInt(expiry).toString(16))}`;
}

const label = process.argv[2];
if (!label) {
  console.error("Usage: node scripts/attest.mjs <label>");
  console.error("  e.g. node scripts/attest.mjs browse");
  process.exit(1);
}

const domain = `${label}.dot`;
const node = namehash(domain);
const subject = nodeToSubject(node);

console.log(`Attesting ${domain}`);
console.log(`  subject: ${subject}`);
console.log(`  schema:  ${SCHEMA_FAVOURITE}`);
console.log(`  seed:    ${SEED}`);

// 1. Init crypto & keyring
await cryptoWaitReady();
const keyring = new Keyring({ type: "sr25519" });
const account = keyring.addFromUri(SEED);
const evmAddress = deriveEvmAddress(account.address);
console.log(`  account: ${account.address}`);
console.log(`  evm:     ${evmAddress}`);

// 2. Connect to RPC
let api;
for (const endpoint of RPC_ENDPOINTS) {
  try {
    console.log(`\nConnecting to ${endpoint}...`);
    const provider = new WsProvider(endpoint);
    api = await Promise.race([
      ApiPromise.create({ provider }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 15000),
      ),
    ]);
    console.log("Connected.");
    break;
  } catch (e) {
    console.log(`  Failed: ${e.message}`);
  }
}

if (!api) {
  console.error("Could not connect to any RPC endpoint.");
  process.exit(1);
}

// 3. Map account (idempotent — may already be mapped)
try {
  console.log("\nMapping account...");
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout")), 30000);
    api.tx.revive
      .mapAccount()
      .signAndSend(account, { nonce: -1 }, (result) => {
        if (result.status.isInBlock || result.status.isFinalized) {
          clearTimeout(timeout);
          resolve();
        }
        if (result.status.isDropped || result.status.isInvalid) {
          clearTimeout(timeout);
          resolve();
        }
      })
      .catch(() => {
        clearTimeout(timeout);
        resolve();
      });
  });
  // Brief wait for mapping to be available
  await new Promise((r) => setTimeout(r, 3000));
  console.log("Account mapped.");
} catch {
  console.log("Account mapping skipped (may already be mapped).");
}

// 4. Submit attest tx
const calldata = encodeAttest(
  subject,
  SCHEMA_FAVOURITE,
  "0x" + "00".repeat(32),
  0,
);

console.log(`\nSubmitting attestation...`);

const tx = api.tx.revive.call(
  ATTESTATION_REGISTRY,
  0n,
  { refTime: 500_000_000_000n, proofSize: 5_000_000n },
  100_000_000_000n,
  calldata,
);

const result = await new Promise((resolve) => {
  const timeout = setTimeout(
    () => resolve({ success: false, error: "timeout" }),
    120000,
  );

  tx.signAndSend(account, { nonce: -1 }, (result) => {
    if (result.status.isInBlock || result.status.isFinalized) {
      clearTimeout(timeout);
      const blockHash = result.status.isFinalized
        ? result.status.asFinalized.toHex()
        : result.status.asInBlock.toHex();

      for (const { event } of result.events) {
        if (event.section === "system" && event.method === "ExtrinsicFailed") {
          let errorMsg = "ExtrinsicFailed";
          const error = event.data[0];
          if (error.isModule) {
            try {
              const decoded = api.registry.findMetaError(error.asModule);
              errorMsg = `${decoded.section}.${decoded.name}: ${decoded.docs.join(" ")}`;
            } catch {}
          }
          resolve({ success: false, error: errorMsg, blockHash });
          return;
        }
      }
      resolve({ success: true, blockHash });
    }
    if (result.status.isDropped || result.status.isInvalid) {
      clearTimeout(timeout);
      resolve({ success: false, error: `status: ${result.status.type}` });
    }
  }).catch((err) => {
    clearTimeout(timeout);
    resolve({ success: false, error: err.message });
  });
});

if (result.success) {
  console.log(
    `\nDone! Attestation for ${domain} included in block ${result.blockHash}`,
  );
  console.log(`\nTo test the Following tab, add Alice's address as a contact:`);
  console.log(`  ${account.address}`);
} else {
  console.error(`\nFailed: ${result.error}`);
  if (result.blockHash) console.error(`  Block: ${result.blockHash}`);
}

await api.disconnect();
process.exit(result.success ? 0 : 1);
