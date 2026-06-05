#!/usr/bin/env node
// Test: query Store.getValues() using ReviveApi.eth_transact with H160 origin
// Usage: node test-query.mjs

import { createClient } from "polkadot-api";
import { Binary, FixedSizeBinary } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";

const { keccak_256 } = await import("@noble/hashes/sha3.js");

const STORE_FACTORY = "0x030296782F4d3046B080BcB017f01837561D9702";

const RPC_ENDPOINTS = [
  "wss://sys.ibp.network/asset-hub-paseo",
  "wss://asset-hub-paseo.dotters.network",
  "wss://asset-hub-paseo-rpc.dwellir.com",
  "wss://paseo-asset-hub-rpc.polkadot.io",
];

const t0 = performance.now();
function log(msg) {
  console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
}

function toHex(bytes) {
  return (
    "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  );
}

function selector(sig) {
  return toHex(keccak_256(new TextEncoder().encode(sig)).slice(0, 4));
}

const SEL_GET_ALL = selector("getAllDeployedStores()");
const SEL_GET_VALUES = selector("getValues()");
const SEL_OWNER = selector("owner()");

function decodeAddressArray(hex) {
  hex = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (hex.length < 128) return [];
  const offset = parseInt(hex.slice(0, 64), 16) * 2;
  const length = parseInt(hex.slice(offset, offset + 64), 16);
  const addrs = [];
  for (let i = 0; i < length; i++) {
    const start = offset + 64 + i * 64;
    addrs.push("0x" + hex.slice(start + 24, start + 64));
  }
  return addrs;
}

function decodeAddress(hex) {
  hex = hex.startsWith("0x") ? hex.slice(2) : hex;
  return "0x" + hex.slice(24, 64);
}

function decodeStringArray(hex) {
  hex = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (hex.length < 128) return [];
  const arrOff = parseInt(hex.slice(0, 64), 16) * 2;
  const length = parseInt(hex.slice(arrOff, arrOff + 64), 16);
  const strs = [];
  for (let i = 0; i < length; i++) {
    const offPos = arrOff + 64 + i * 64;
    const strOff = parseInt(hex.slice(offPos, offPos + 64), 16) * 2;
    const strStart = arrOff + 64 + strOff;
    const strLen = parseInt(hex.slice(strStart, strStart + 64), 16);
    if (strLen === 0) {
      strs.push("");
      continue;
    }
    const strHex = hex.slice(strStart + 64, strStart + 64 + strLen * 2);
    const bytes = new Uint8Array(strLen);
    for (let j = 0; j < strLen; j++)
      bytes[j] = parseInt(strHex.slice(j * 2, j * 2 + 2), 16);
    strs.push(new TextDecoder().decode(bytes));
  }
  return strs;
}

// ReviveApi.eth_transact — takes H160 directly
async function ethTransact(api, contract, data, fromH160) {
  const result = await api.apis.ReviveApi.eth_transact({
    from: FixedSizeBinary.fromHex(fromH160),
    to: FixedSizeBinary.fromHex(contract),
    input: { data: Binary.fromHex(data) },
    authorization_list: [],
    blob_versioned_hashes: [],
    blobs: [],
  });
  if (result.success === false) {
    throw new Error(
      typeof result.value === "object"
        ? JSON.stringify(result.value)
        : String(result.value),
    );
  }
  const d = result.value?.data ?? null;
  if (d === null) throw new Error("no data");
  if (typeof d === "string") return d;
  if (d?.asHex) return d.asHex();
  if (d?.toHex) return d.toHex();
  if (d instanceof Uint8Array) return toHex(d);
  return "0x";
}

async function main() {
  log("Connecting...");
  let client;
  for (const ep of RPC_ENDPOINTS) {
    try {
      log(`  Trying ${ep}...`);
      const provider = getWsProvider(ep);
      client = createClient(provider);
      const block = await Promise.race([
        client.getFinalizedBlock(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("timeout")), 10_000),
        ),
      ]);
      log(`Connected — block #${block.number}`);
      break;
    } catch (err) {
      log(`  Failed: ${err.message}`);
    }
  }
  if (!client) {
    log("All endpoints failed!");
    process.exit(1);
  }

  const api = client.getUnsafeApi();

  // Get all stores via eth_transact (no origin needed, use zero address)
  const ZERO = "0x0000000000000000000000000000000000000000";
  const storesRaw = await ethTransact(api, STORE_FACTORY, SEL_GET_ALL, ZERO);
  const stores = decodeAddressArray(storesRaw);
  log(`Found ${stores.length} stores\n`);

  // Get owner + getValues via eth_transact for first 10 stores
  const count = Math.min(10, stores.length);
  let ok = 0,
    fail = 0;

  for (let i = 0; i < count; i++) {
    const store = stores[i];
    try {
      const ownerRaw = await ethTransact(api, store, SEL_OWNER, ZERO);
      const ownerH160 = decodeAddress(ownerRaw);
      const raw = await ethTransact(api, store, SEL_GET_VALUES, ownerH160);
      const labels = decodeStringArray(raw);
      log(
        `store[${i}] ${store} → owner ${ownerH160} → ✅ ${labels.length} labels: [${labels.slice(0, 3).join(", ")}${labels.length > 3 ? "..." : ""}]`,
      );
      ok++;
    } catch (err) {
      log(`store[${i}] ${store} → ❌ ${err.message.slice(0, 200)}`);
      fail++;
    }
  }

  log(`\nResults: ${ok} ok, ${fail} failed out of ${count}`);
  client.destroy();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
