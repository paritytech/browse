#!/usr/bin/env node
// Standalone test: connect to Paseo Asset Hub via smoldot, query DotNS contracts.
// Tests progressive loading: stream labels from stores, batch metadata via Multicall3.
// Usage: node test-chain.mjs

import { start } from "smoldot";
import { getSmProvider } from "polkadot-api/sm-provider";
import { createClient } from "polkadot-api";
import { Binary } from "polkadot-api";
import { readFileSync } from "fs";

const { keccak_256 } = await import("@noble/hashes/sha3.js");

// ── Config ──────────────────────────────────────────────────

const CONTRACTS = {
  MULTICALL3:        "0x0C206218c5949c00e51825364a7C3A17d9909ef6",
  STORE_FACTORY:     "0x030296782F4d3046B080BcB017f01837561D9702",
  CONTENT_RESOLVER:  "0x7756DF72CBc7f062e7403cD59e45fBc78bed1cD7",
};

const DUMMY_ORIGIN = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const WEIGHT_LIMIT = { ref_time: 18446744073709551615n, proof_size: 18446744073709551615n };
const STORAGE_LIMIT = 18446744073709551615n;
const CHUNK_SIZE = 30;

// ── Timing ──────────────────────────────────────────────────

const t0 = performance.now();
function log(msg) {
  const s = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[${s}s] ${msg}`);
}
function secs(from) { return ((performance.now() - from) / 1000).toFixed(1); }

// ── Hex / ABI ───────────────────────────────────────────────

function toHex(bytes) {
  return "0x" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
function uint256Hex(n) { return BigInt(n).toString(16).padStart(64, "0"); }
function padRight(hex, byteLen) { return hex.padEnd(byteLen * 2, "0"); }
function strip(hex) { return hex.startsWith("0x") ? hex.slice(2) : hex; }

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

function selector(sig) {
  return toHex(keccak_256(new TextEncoder().encode(sig)).slice(0, 4)).slice(2);
}

const SEL = {
  getAllDeployedStores: selector("getAllDeployedStores()"),
  getValues: selector("getValues()"),
  contenthash: selector("contenthash(bytes32)"),
  text: selector("text(bytes32,string)"),
  aggregate3: selector("aggregate3((address,bool,bytes)[])"),
};

function encodeContenthash(node) {
  return `0x${SEL.contenthash}${strip(node).padStart(64, "0")}`;
}
function encodeText(node, key) {
  const nodeHex = strip(node).padStart(64, "0");
  const keyBytes = new TextEncoder().encode(key);
  const keyHex = Array.from(keyBytes, b => b.toString(16).padStart(2, "0")).join("");
  const paddedLen = Math.ceil(keyBytes.length / 32) * 32;
  return `0x${SEL.text}${nodeHex}${uint256Hex(64)}${uint256Hex(keyBytes.length)}${padRight(keyHex, paddedLen)}`;
}
function encodeAggregate3(calls) {
  const n = calls.length;
  let result = SEL.aggregate3 + uint256Hex(32) + uint256Hex(n);
  const elems = [];
  for (const { target, callData } of calls) {
    const addr = strip(target).toLowerCase().padStart(64, "0");
    const cdHex = strip(callData);
    const paddedLen = Math.ceil(cdHex.length / 2 / 32) * 32;
    elems.push(addr + uint256Hex(1) + uint256Hex(96) + uint256Hex(cdHex.length / 2) + padRight(cdHex, paddedLen));
  }
  let off = n * 32;
  for (const e of elems) { result += uint256Hex(off); off += e.length / 2; }
  for (const e of elems) result += e;
  return "0x" + result;
}

// ── ABI decoders ────────────────────────────────────────────

function decodeAddressArray(hex) {
  hex = strip(hex); if (hex.length < 128) return [];
  const off = parseInt(hex.slice(0, 64), 16) * 2;
  const len = parseInt(hex.slice(off, off + 64), 16);
  return Array.from({ length: len }, (_, i) => "0x" + hex.slice(off + 64 + i * 64 + 24, off + 64 + i * 64 + 64));
}
function decodeStringArray(hex) {
  hex = strip(hex); if (hex.length < 128) return [];
  const arrOff = parseInt(hex.slice(0, 64), 16) * 2;
  const len = parseInt(hex.slice(arrOff, arrOff + 64), 16);
  const strs = [];
  for (let i = 0; i < len; i++) {
    const offPos = arrOff + 64 + i * 64;
    const strOff = parseInt(hex.slice(offPos, offPos + 64), 16) * 2;
    const strStart = arrOff + 64 + strOff;
    const strLen = parseInt(hex.slice(strStart, strStart + 64), 16);
    if (!strLen) { strs.push(""); continue; }
    const b = new Uint8Array(strLen);
    for (let j = 0; j < strLen; j++) b[j] = parseInt(hex.slice(strStart + 64 + j * 2, strStart + 66 + j * 2), 16);
    strs.push(new TextDecoder().decode(b));
  }
  return strs;
}
function decodeBytes(hex) {
  hex = strip(hex); if (hex.length < 128) return "0x";
  const off = parseInt(hex.slice(0, 64), 16) * 2;
  const len = parseInt(hex.slice(off, off + 64), 16) * 2;
  return "0x" + hex.slice(off + 64, off + 64 + len);
}
function decodeString(hex) {
  hex = strip(hex); if (hex.length < 128) return "";
  const off = parseInt(hex.slice(0, 64), 16) * 2;
  const len = parseInt(hex.slice(off, off + 64), 16);
  if (!len) return "";
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++) b[i] = parseInt(hex.slice(off + 64 + i * 2, off + 66 + i * 2), 16);
  return new TextDecoder().decode(b);
}
function decodeAggregate3Result(hex) {
  hex = strip(hex); if (hex.length < 128) return [];
  const aOff = parseInt(hex.slice(0, 64), 16) * 2;
  const len = parseInt(hex.slice(aOff, aOff + 64), 16);
  const results = [];
  for (let i = 0; i < len; i++) {
    const oPos = aOff + 64 + i * 64;
    const eOff = parseInt(hex.slice(oPos, oPos + 64), 16) * 2;
    const eStart = aOff + 64 + eOff;
    const success = parseInt(hex.slice(eStart, eStart + 64), 16) !== 0;
    const bOff = parseInt(hex.slice(eStart + 64, eStart + 128), 16) * 2;
    const bStart = eStart + bOff;
    const bLen = parseInt(hex.slice(bStart, bStart + 64), 16) * 2;
    results.push({ success, returnData: "0x" + hex.slice(bStart + 64, bStart + 64 + bLen) });
  }
  return results;
}

// ── ReviveApi call ──────────────────────────────────────────

async function reviveCall(api, addr, data) {
  const result = await api.apis.ReviveApi.call(
    DUMMY_ORIGIN, Binary.fromHex(addr), 0n, WEIGHT_LIMIT, STORAGE_LIMIT, Binary.fromHex(data),
  );
  const exec = result.result;
  const ok = exec.value ?? (exec.isOk ? exec : null) ?? exec.ok ?? null;
  if (!ok) throw new Error("no result");
  const fl = typeof ok.flags === "object" && ok.flags?.toString ? ok.flags.toString() : String(ok.flags ?? 0);
  if ((BigInt(fl) & 1n) === 1n) throw new Error("reverted");
  const d = ok.data;
  if (typeof d === "string") return d;
  if (d?.asHex) return d.asHex();
  if (d?.toHex) return d.toHex();
  if (d instanceof Uint8Array) return toHex(d);
  return "0x";
}

// ── Multicall3 (for metadata only — Store.getValues() doesn't work via MC3) ──

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function multicall(api, calls) {
  if (!calls.length) return [];
  const results = [];
  for (const batch of chunk(calls, CHUNK_SIZE)) {
    const raw = await reviveCall(api, CONTRACTS.MULTICALL3, encodeAggregate3(batch));
    results.push(...decodeAggregate3Result(raw));
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  log("Starting smoldot...");
  const smoldot = start({ maxLogLevel: 3 });

  const relaySpec = readFileSync(new URL("./chain-specs/paseo.json", import.meta.url), "utf-8");
  const paraSpec = readFileSync(new URL("./chain-specs/asset-hub-paseo.json", import.meta.url), "utf-8");

  const relayChain = await smoldot.addChain({ chainSpec: relaySpec });
  const paraChain = await smoldot.addChain({ chainSpec: paraSpec, potentialRelayChains: [relayChain] });
  const client = createClient(getSmProvider(paraChain));

  log("Waiting for finalized block...");
  const syncStart = performance.now();
  const block = await client.getFinalizedBlock();
  log(`Synced! Block #${block.number} (${secs(syncStart)}s)`);

  const api = client.getUnsafeApi();

  // ═══════════════════════════════════════════════════════════
  // Step 1: Get all stores
  // ═══════════════════════════════════════════════════════════
  const t1 = performance.now();
  const storesRaw = await reviveCall(api, CONTRACTS.STORE_FACTORY, `0x${SEL.getAllDeployedStores}`);
  const stores = decodeAddressArray(storesRaw);
  log(`Step 1: ${stores.length} stores (${secs(t1)}s)`);

  // ═══════════════════════════════════════════════════════════
  // Step 2: Sequential getValues() with progressive streaming
  //   NOTE: Multicall3 can't batch these — Revive nested calls
  //   return empty for Store.getValues(). Must call directly.
  //
  //   Progressive: as soon as we find labels, fire metadata
  //   queries immediately while continuing to scan stores.
  // ═══════════════════════════════════════════════════════════
  const t2 = performance.now();
  log(`Step 2: Scanning ${stores.length} stores for labels (sequential)...`);

  const allLabels = new Set();
  let storesWithData = 0;
  let firstLabelAt = null;
  const pendingMeta = []; // labels awaiting metadata fetch

  for (let i = 0; i < stores.length; i++) {
    try {
      const raw = await reviveCall(api, stores[i], `0x${SEL.getValues}`);
      const labels = decodeStringArray(raw);
      if (labels.length > 0) {
        storesWithData++;
        const newLabels = [];
        for (const l of labels) {
          if (!l) continue;
          const normalized = l.endsWith(".dot") ? l.slice(0, -4) : l;
          if (!allLabels.has(normalized)) {
            allLabels.add(normalized);
            newLabels.push(normalized);
          }
        }
        if (newLabels.length > 0) {
          if (!firstLabelAt) firstLabelAt = secs(t2);
          log(`  store[${i}]: +${newLabels.length} labels → [${newLabels.join(", ")}]`);
          pendingMeta.push(...newLabels);
        }
      }
    } catch { /* skip failed stores */ }

    // Progress every 50 stores
    if ((i + 1) % 50 === 0) {
      log(`  ... scanned ${i + 1}/${stores.length} stores`);
    }
  }
  log(`Step 2 done: ${allLabels.size} labels from ${storesWithData} stores (${secs(t2)}s, first at ${firstLabelAt}s)`);

  // ═══════════════════════════════════════════════════════════
  // Step 3: Batch metadata via Multicall3
  // ═══════════════════════════════════════════════════════════
  const labels = [...allLabels];
  if (labels.length === 0) {
    log("No labels found. Done.");
    client.destroy();
    await smoldot.terminate();
    return;
  }

  const t3 = performance.now();
  const metaCalls = [];
  for (const label of labels) {
    const node = namehash(`${label}.dot`);
    metaCalls.push(
      { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeContenthash(node) },
      { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeText(node, "name") },
      { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeText(node, "description") },
    );
  }
  log(`Step 3: Multicall metadata — ${metaCalls.length} calls (${labels.length} labels x 3)...`);
  const metaResults = await multicall(api, metaCalls);

  for (let i = 0; i < labels.length; i++) {
    const ch = metaResults[i * 3]?.success ? decodeBytes(metaResults[i * 3].returnData) : "0x";
    const name = metaResults[i * 3 + 1]?.success ? decodeString(metaResults[i * 3 + 1].returnData) : "";
    const desc = metaResults[i * 3 + 2]?.success ? decodeString(metaResults[i * 3 + 2].returnData) : "";
    const live = ch !== "0x";
    log(`  ${labels[i]}.dot — ${live ? "LIVE" : "----"} ${desc || "(no desc)"}`);
  }
  log(`Step 3 done (${secs(t3)}s)`);

  // ═══════════════════════════════════════════════════════════
  log(`\n══ TIMING SUMMARY ══`);
  log(`Smoldot sync:           ${secs(syncStart)}s`);
  log(`Step 1 (stores):        ${secs(t1)}s`);
  log(`Step 2 (getValues):     ${secs(t2)}s  (first label at ${firstLabelAt}s)`);
  log(`Step 3 (metadata MC3):  ${secs(t3)}s`);
  log(`Total:                  ${secs(t0)}s`);

  log(`\n══ PROGRESSIVE UX STRATEGY ══`);
  log(`After sync, user sees skeleton cards.`);
  log(`Step 1 takes ~1s → show "${stores.length} stores found" status.`);
  log(`Step 2: labels arrive at ${firstLabelAt}s → immediately render card with label only.`);
  log(`Step 3: metadata fills in within ${secs(t3)}s → update cards with description + live status.`);
  log(`User sees first real content at sync + 1s + ${firstLabelAt}s = ~${(parseFloat(secs(syncStart)) + 1 + parseFloat(firstLabelAt || "0")).toFixed(0)}s total.`);

  client.destroy();
  await smoldot.terminate();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
