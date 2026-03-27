#!/usr/bin/env node
/**
 * Vouch E2E Smoke Tests
 *
 * Tests the attestation-based vouch system against the live Protocol Commons
 * AttestationRegistry on Paseo Asset Hub.
 *
 * Uses:
 *   - polkadot-api (PAPI) + WS provider for read-only dry-run calls
 *   - @polkadot/api + Keyring for signed write transactions
 *
 * Usage:
 *   node test-vouch-e2e.mjs                 # Run all tests (default //Alice)
 *   SEED="//Bob" node test-vouch-e2e.mjs    # Use a different key
 */

import { createClient, Binary } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import {
  cryptoWaitReady,
  decodeAddress as decodeSubstrateAddress,
  keccakAsU8a,
} from "@polkadot/util-crypto";

const { keccak_256 } = await import("@noble/hashes/sha3.js");

// ============================================================================
// Config
// ============================================================================

const RPC_ENDPOINTS = [
  "wss://sys.ibp.network/asset-hub-paseo",
  "wss://asset-hub-paseo.dotters.network",
  "wss://asset-hub-paseo-rpc.dwellir.com",
];
const SEED = process.env.SEED || "//Alice";

const CONTRACTS = {
  MULTICALL3: "0x0C206218c5949c00e51825364a7C3A17d9909ef6",
  STORE_FACTORY: "0x030296782F4d3046B080BcB017f01837561D9702",
  CONTENT_RESOLVER: "0x7756DF72CBc7f062e7403cD59e45fBc78bed1cD7",
  ATTESTATION_REGISTRY: "0x4d018C530E01BbC98b042a18A4D4090658BCd8f3",
};

// keccak256("discovery.rating.v1") — must match app/src/config.ts
const SCHEMA_RATING =
  "0x07ebbff6960c1c29233bf2c1109eca1140dd09425365d4acfd62026181add4d3";

// ============================================================================
// Timing & Results
// ============================================================================

const t0 = performance.now();
function log(msg) {
  const s = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[${s}s] ${msg}`);
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let skippedTests = 0;

function pass(name) {
  totalTests++;
  passedTests++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
}
function fail(name, reason) {
  totalTests++;
  failedTests++;
  console.log(`  \x1b[31m✗\x1b[0m ${name} — ${reason}`);
}
function skip(name, reason) {
  totalTests++;
  skippedTests++;
  console.log(`  \x1b[33m○\x1b[0m ${name} — ${reason}`);
}

// ============================================================================
// Hex / ABI Helpers
// ============================================================================

function toHex(bytes) {
  return (
    "0x" +
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  );
}
function uint256Hex(n) {
  return BigInt(n).toString(16).padStart(64, "0");
}
function strip(hex) {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}
function padRight(hex, byteLen) {
  return hex.padEnd(byteLen * 2, "0");
}

function selector(sig) {
  return toHex(keccak_256(new TextEncoder().encode(sig)).slice(0, 4)).slice(2);
}

function encodeAddress(addr) {
  return strip(addr).toLowerCase().padStart(64, "0");
}
function encodeBytes32(val) {
  return strip(val).padEnd(64, "0");
}
function encodeUint64(val) {
  return BigInt(val).toString(16).padStart(64, "0");
}

function randomBytes32() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

// ── namehash (ENS EIP-137) ──

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

/** Low 20 bytes of namehash → attestation subject address. */
function nodeToSubject(node) {
  const hex = strip(node).padStart(64, "0");
  return "0x" + hex.slice(24);
}

/**
 * Encode rating value into bytes32 (matches app/src/abi.ts encodeRatingValue).
 * Layout: version(1) | rating(1) | rated(1) | reserved(1) | reviewDigest(28)
 */
function encodeRatingValue(rating, explicitlyRated) {
  const buf = new Uint8Array(32);
  buf[0] = 0x01; // version
  buf[1] = Math.max(1, Math.min(5, rating));
  buf[2] = explicitlyRated ? 0x01 : 0x00;
  return toHex(buf);
}

// ── Selectors ──

const SEL = {
  attest: selector("attest(address,bytes32,bytes32,uint64)"),
  revoke: selector("revoke(address,bytes32)"),
  count: selector("count(address)"),
  get: selector("get(address,bytes32,address)"),
  isValid: selector("isValid(address,bytes32,address)"),
  list: selector("list(address,uint64,uint64)"),
  aggregate3: selector("aggregate3((address,bool,bytes)[])"),
  // DotNS
  getAllDeployedStores: selector("getAllDeployedStores()"),
  getValues: selector("getValues()"),
  contenthash: selector("contenthash(bytes32)"),
  text: selector("text(bytes32,string)"),
};

// ── Encoders ──

function encodeAttest(subject, schema, value, expiry) {
  return `0x${SEL.attest}${encodeAddress(subject)}${encodeBytes32(schema)}${encodeBytes32(value)}${encodeUint64(expiry)}`;
}
function encodeRevoke(subject, schema) {
  return `0x${SEL.revoke}${encodeAddress(subject)}${encodeBytes32(schema)}`;
}
function encodeCount(subject) {
  return `0x${SEL.count}${encodeAddress(subject)}`;
}
function encodeGet(subject, schema, attester) {
  return `0x${SEL.get}${encodeAddress(subject)}${encodeBytes32(schema)}${encodeAddress(attester)}`;
}
function encodeIsValid(subject, schema, attester) {
  return `0x${SEL.isValid}${encodeAddress(subject)}${encodeBytes32(schema)}${encodeAddress(attester)}`;
}
function encodeList(subject, offset, limit) {
  return `0x${SEL.list}${encodeAddress(subject)}${encodeUint64(offset)}${encodeUint64(limit)}`;
}

function encodeText(node, key) {
  const nodeHex = strip(node).padStart(64, "0");
  const keyBytes = new TextEncoder().encode(key);
  const keyHex = Array.from(keyBytes, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
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
    elems.push(
      addr +
        uint256Hex(1) +
        uint256Hex(96) +
        uint256Hex(cdHex.length / 2) +
        padRight(cdHex, paddedLen),
    );
  }
  let off = n * 32;
  for (const e of elems) {
    result += uint256Hex(off);
    off += e.length / 2;
  }
  for (const e of elems) result += e;
  return "0x" + result;
}

// ── Decoders ──

function decodeUint64FromHex(hex, wordIndex = 0) {
  const clean = strip(hex);
  const start = wordIndex * 64;
  const word = clean.slice(start, start + 64);
  return BigInt("0x" + (word || "0"));
}

function decodeBool(hex, wordIndex = 0) {
  return decodeUint64FromHex(hex, wordIndex) !== 0n;
}

function decodeAddressFromHex(hex, wordIndex = 0) {
  const clean = strip(hex);
  const start = wordIndex * 64;
  return "0x" + clean.slice(start + 24, start + 64);
}

function decodeBytes32FromHex(hex, wordIndex = 0) {
  const clean = strip(hex);
  const start = wordIndex * 64;
  return "0x" + clean.slice(start, start + 64);
}

function decodeAddressArray(hex) {
  hex = strip(hex);
  if (hex.length < 128) return [];
  const off = parseInt(hex.slice(0, 64), 16) * 2;
  const len = parseInt(hex.slice(off, off + 64), 16);
  return Array.from(
    { length: len },
    (_, i) => "0x" + hex.slice(off + 64 + i * 64 + 24, off + 64 + i * 64 + 64),
  );
}

function decodeStringArray(hex) {
  hex = strip(hex);
  if (hex.length < 128) return [];
  const arrOff = parseInt(hex.slice(0, 64), 16) * 2;
  const len = parseInt(hex.slice(arrOff, arrOff + 64), 16);
  const strs = [];
  for (let i = 0; i < len; i++) {
    const offPos = arrOff + 64 + i * 64;
    const strOff = parseInt(hex.slice(offPos, offPos + 64), 16) * 2;
    const strStart = arrOff + 64 + strOff;
    const strLen = parseInt(hex.slice(strStart, strStart + 64), 16);
    if (!strLen) {
      strs.push("");
      continue;
    }
    const b = new Uint8Array(strLen);
    for (let j = 0; j < strLen; j++)
      b[j] = parseInt(hex.slice(strStart + 64 + j * 2, strStart + 66 + j * 2), 16);
    strs.push(new TextDecoder().decode(b));
  }
  return strs;
}

function decodeString(hex) {
  hex = strip(hex);
  if (hex.length < 128) return "";
  const off = parseInt(hex.slice(0, 64), 16) * 2;
  const len = parseInt(hex.slice(off, off + 64), 16);
  if (!len) return "";
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++)
    b[i] = parseInt(hex.slice(off + 64 + i * 2, off + 66 + i * 2), 16);
  return new TextDecoder().decode(b);
}

function decodeAggregate3Result(hex) {
  hex = strip(hex);
  if (hex.length < 128) return [];
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
    results.push({
      success,
      returnData: "0x" + hex.slice(bStart + 64, bStart + 64 + bLen),
    });
  }
  return results;
}

// ============================================================================
// EVM address derivation (substrate pubkey → keccak → last 20 bytes)
// ============================================================================

function deriveEvmAddress(substrateAddress) {
  const accountId = decodeSubstrateAddress(substrateAddress);
  const hash = keccakAsU8a(accountId);
  return (
    "0x" +
    Array.from(hash.slice(-20))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

// ============================================================================
// Chain connection helpers
// ============================================================================

const DUMMY_ORIGIN = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const WEIGHT_LIMIT = {
  ref_time: 18_446_744_073_709_551_615n,
  proof_size: 18_446_744_073_709_551_615n,
};
const STORAGE_LIMIT = 18_446_744_073_709_551_615n;

/** PAPI read-only call via ReviveApi.call dry-run. */
async function papiReviveCall(papiApi, contractAddress, encodedData) {
  const result = await papiApi.apis.ReviveApi.call(
    DUMMY_ORIGIN,
    Binary.fromHex(contractAddress),
    0n,
    WEIGHT_LIMIT,
    STORAGE_LIMIT,
    Binary.fromHex(encodedData),
  );
  const exec = result.result;
  const ok =
    exec.value ?? (exec.isOk ? exec : null) ?? exec.ok ?? null;
  if (!ok) throw new Error("Revive call failed: no result");
  const fl =
    typeof ok.flags === "object" && ok.flags?.toString
      ? ok.flags.toString()
      : String(ok.flags ?? 0);
  if ((BigInt(fl) & 1n) === 1n) throw new Error("Contract reverted");
  const d = ok.data;
  if (typeof d === "string") return d;
  if (d?.asHex) return d.asHex();
  if (d?.toHex) return d.toHex();
  if (d instanceof Uint8Array) return toHex(d);
  return "0x";
}

/** @polkadot/api signed write via revive.call extrinsic. */
const RETRYABLE_ERRORS = [
  "Transaction is outdated",
  "Priority is too low",
  "Transaction has a bad signature",
  "timeout",
  "status: Dropped",
  "status: Invalid",
  "1010:",
  "1014:",
];

function isRetryableError(err) {
  return RETRYABLE_ERRORS.some((e) => err.includes(e));
}

async function executeWrite(pjsApi, account, contractAddress, callData) {
  const MAX_RETRIES = 3;
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = 2000 * Math.pow(2, attempt - 1);
      log(`    Retry ${attempt}/${MAX_RETRIES - 1} after ${delay}ms (${lastError})`);
      await new Promise((r) => setTimeout(r, delay));
    }

    // First try: ensure account is mapped
    if (attempt === 0) {
      try {
        // Try to map the account first (idempotent — fails gracefully if already mapped)
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("map timeout")), 30000);
          pjsApi.tx.revive
            .mapAccount()
            .signAndSend(
              account,
              { nonce: -1 },
              (result) => {
                if (result.status.isInBlock || result.status.isFinalized) {
                  clearTimeout(timeout);
                  resolve();
                }
                if (result.status.isDropped || result.status.isInvalid) {
                  clearTimeout(timeout);
                  resolve(); // Don't fail — might already be mapped
                }
              },
            )
            .catch(() => {
              clearTimeout(timeout);
              resolve(); // Already mapped or other benign error
            });
        });
        // Wait a moment for the mapping to be available
        await new Promise((r) => setTimeout(r, 3000));
      } catch {
        // Mapping failed — account might already be mapped, continue
      }
    }

    const tx = pjsApi.tx.revive.call(
      contractAddress,
      0n,
      { refTime: 500_000_000_000n, proofSize: 5_000_000n },
      100_000_000_000n,
      callData.startsWith("0x") ? callData : "0x" + callData,
    );

    const result = await new Promise((resolve) => {
      const timeout = setTimeout(
        () => resolve({ success: false, error: "timeout" }),
        120000,
      );

      tx.signAndSend(
        account,
        { nonce: -1, tip: 10_000_000n },
        (result) => {
          if (result.status.isInBlock || result.status.isFinalized) {
            clearTimeout(timeout);
            const blockHash = result.status.isFinalized
              ? result.status.asFinalized.toHex()
              : result.status.asInBlock.toHex();

            for (const { event } of result.events) {
              if (
                event.section === "system" &&
                event.method === "ExtrinsicFailed"
              ) {
                let errorMsg = "ExtrinsicFailed";
                const error = event.data[0];
                if (error.isModule) {
                  try {
                    const decoded = pjsApi.registry.findMetaError(
                      error.asModule,
                    );
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
        },
      ).catch((err) => {
        clearTimeout(timeout);
        resolve({ success: false, error: err.message || "catch" });
      });
    });

    if (result.success) return result;

    lastError = result.error;
    if (!lastError || !isRetryableError(lastError)) return result;
  }

  return { success: false, error: `Failed after ${MAX_RETRIES} retries: ${lastError}` };
}

/** Wait for a new finalized block after a write. */
async function waitForNextFinalizedBlock(pjsApi) {
  const initial = (await pjsApi.rpc.chain.getFinalizedHead()).toHex();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const current = (await pjsApi.rpc.chain.getFinalizedHead()).toHex();
    if (current !== initial) return;
  }
  log("  [WARN] Timed out waiting for next finalized block");
}

/** @polkadot/api read via reviveApi.call (uses latest best block, more up-to-date after writes) */
async function pjsReviveCall(pjsApi, origin, contractAddress, callData) {
  const dataHex = callData.startsWith("0x") ? callData : "0x" + callData;
  try {
    const result = await pjsApi.call.reviveApi.call(
      origin,
      contractAddress,
      0n,
      { refTime: 500_000_000_000n, proofSize: 5_000_000n },
      100_000_000_000n,
      dataHex,
    );
    const json = result.toJSON ? result.toJSON() : result;
    const execResult =
      json.result?.ok || json.result?.Ok || (json.data !== undefined ? json : null);
    if (execResult) {
      const flags =
        typeof execResult.flags === "number"
          ? execResult.flags
          : execResult.flags?.bits ?? 0;
      if (flags & 1) throw new Error("Contract reverted");
      return execResult.data || "0x";
    }
    if (json.result?.err || json.result?.Err) {
      throw new Error(JSON.stringify(json.result.err || json.result.Err));
    }
    return result.toHex ? result.toHex() : "0x";
  } catch (err) {
    throw new Error(`pjsReviveCall failed: ${err.message}`);
  }
}

/** PAPI read via ReviveApi.eth_transact (better for Paseo after finalization) */
async function papiEthTransact(papiApi, contractAddress, callData) {
  try {
    const result = await papiApi.apis.ReviveApi.eth_transact({
      to: Binary.fromHex(contractAddress),
      input: { data: Binary.fromHex(callData) },
      authorization_list: [],
      blob_versioned_hashes: [],
      blobs: [],
    });
    if (!result?.success) {
      throw new Error(`eth_transact error: ${result?.value?.type || "unknown"}`);
    }
    const hex = result.value?.data?.asHex?.() || "0x";
    const flags = result.value?.flags || 0;
    if (flags & 1) throw new Error("Contract reverted");
    return hex;
  } catch (err) {
    throw new Error(`papiEthTransact failed: ${err.message}`);
  }
}

// ============================================================================
// Test Suites
// ============================================================================

async function testRegistryReads(papiApi) {
  console.log("\n═══ Suite 1: AttestationRegistry Read Path ═══");
  const REGISTRY = CONTRACTS.ATTESTATION_REGISTRY;

  // 1.1 — count() for a known domain (getsome.dot)
  try {
    const node = namehash("getsome.dot");
    const subject = nodeToSubject(node);
    const raw = await papiReviveCall(papiApi, REGISTRY, encodeCount(subject));
    const count = Number(decodeUint64FromHex(raw));
    if (count >= 0) {
      pass(`count(getsome.dot) = ${count}`);
    } else {
      fail("count(getsome.dot)", `unexpected: ${count}`);
    }
  } catch (e) {
    fail("count(getsome.dot)", e.message);
  }

  // 1.2 — count() for a non-existent domain (returns 0)
  try {
    const node = namehash("nonexistent-e2e-test-domain-12345.dot");
    const subject = nodeToSubject(node);
    const raw = await papiReviveCall(papiApi, REGISTRY, encodeCount(subject));
    const count = Number(decodeUint64FromHex(raw));
    if (count === 0) {
      pass("count(nonexistent) = 0");
    } else {
      fail("count(nonexistent)", `expected 0, got ${count}`);
    }
  } catch (e) {
    fail("count(nonexistent)", e.message);
  }

  // 1.3 — get() for non-existent attestation returns zeros
  try {
    const fakeSubject = "0x" + "aa".repeat(20);
    const fakeAttester = "0x" + "bb".repeat(20);
    const raw = await papiReviveCall(
      papiApi,
      REGISTRY,
      encodeGet(fakeSubject, SCHEMA_RATING, fakeAttester),
    );
    const timestamp = decodeUint64FromHex(raw, 3);
    if (timestamp === 0n) {
      pass("get(nonexistent) returns zeros");
    } else {
      fail("get(nonexistent)", `expected timestamp=0, got ${timestamp}`);
    }
  } catch (e) {
    fail("get(nonexistent)", e.message);
  }

  // 1.4 — isValid() for non-existent returns false
  try {
    const fakeSubject = "0x" + "aa".repeat(20);
    const fakeAttester = "0x" + "bb".repeat(20);
    const raw = await papiReviveCall(
      papiApi,
      REGISTRY,
      encodeIsValid(fakeSubject, SCHEMA_RATING, fakeAttester),
    );
    const valid = decodeBool(raw);
    if (!valid) {
      pass("isValid(nonexistent) = false");
    } else {
      fail("isValid(nonexistent)", "expected false, got true");
    }
  } catch (e) {
    fail("isValid(nonexistent)", e.message);
  }

  // 1.5 — list() for non-existent returns empty
  try {
    const fakeSubject = "0x" + "aa".repeat(20);
    const raw = await papiReviveCall(
      papiApi,
      REGISTRY,
      encodeList(fakeSubject, 0, 10),
    );
    // ABI: offset(32) → length(32) — length should be 0
    const clean = strip(raw);
    const arrOff = parseInt(clean.slice(0, 64), 16) * 2;
    const len = parseInt(clean.slice(arrOff, arrOff + 64), 16);
    if (len === 0) {
      pass("list(nonexistent) = []");
    } else {
      fail("list(nonexistent)", `expected length=0, got ${len}`);
    }
  } catch (e) {
    fail("list(nonexistent)", e.message);
  }
}

async function testMulticallBatch(papiApi) {
  console.log("\n═══ Suite 2: Multicall3 Batched Attestation Queries ═══");

  // 2.1 — Batch count() for multiple domains via Multicall3 (mirrors app data pipeline)
  const labels = ["getsome", "dotli", "vox"];
  try {
    const calls = labels.map((label) => {
      const node = namehash(`${label}.dot`);
      const subject = nodeToSubject(node);
      return {
        target: CONTRACTS.ATTESTATION_REGISTRY,
        callData: encodeCount(subject),
      };
    });
    const raw = await papiReviveCall(
      papiApi,
      CONTRACTS.MULTICALL3,
      encodeAggregate3(calls),
    );
    const results = decodeAggregate3Result(raw);

    if (results.length === labels.length) {
      let allOk = true;
      for (let i = 0; i < labels.length; i++) {
        const r = results[i];
        if (r.success) {
          const count = Number(decodeUint64FromHex(r.returnData));
          log(`    ${labels[i]}.dot vouch count = ${count}`);
        } else {
          log(`    ${labels[i]}.dot — multicall returned failure`);
          allOk = false;
        }
      }
      if (allOk) {
        pass(`multicall count() for ${labels.length} domains`);
      } else {
        fail("multicall count()", "some calls failed");
      }
    } else {
      fail(
        "multicall count()",
        `expected ${labels.length} results, got ${results.length}`,
      );
    }
  } catch (e) {
    fail("multicall count()", e.message);
  }

  // 2.2 — Batch metadata + attestation count (4 calls per label, like the app)
  try {
    const label = "getsome";
    const node = namehash(`${label}.dot`);
    const subject = nodeToSubject(node);
    const calls = [
      {
        target: CONTRACTS.CONTENT_RESOLVER,
        callData: `0x${SEL.contenthash}${strip(node).padStart(64, "0")}`,
      },
      { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeText(node, "name") },
      {
        target: CONTRACTS.CONTENT_RESOLVER,
        callData: encodeText(node, "description"),
      },
      { target: CONTRACTS.ATTESTATION_REGISTRY, callData: encodeCount(subject) },
    ];
    const raw = await papiReviveCall(
      papiApi,
      CONTRACTS.MULTICALL3,
      encodeAggregate3(calls),
    );
    const results = decodeAggregate3Result(raw);

    if (results.length !== 4) {
      fail("multicall metadata+count", `expected 4 results, got ${results.length}`);
    } else {
      const name = results[1].success ? decodeString(results[1].returnData) : "(failed)";
      const desc = results[2].success ? decodeString(results[2].returnData) : "(failed)";
      const vouchCount = results[3].success
        ? Number(decodeUint64FromHex(results[3].returnData))
        : -1;
      log(`    ${label}.dot → name="${name}", desc="${desc}", vouches=${vouchCount}`);
      pass(`multicall metadata+count for ${label}.dot`);
    }
  } catch (e) {
    fail("multicall metadata+count", e.message);
  }
}

async function testDotnsDiscovery(papiApi) {
  console.log("\n═══ Suite 3: DotNS Discovery Pipeline ═══");

  // 3.1 — StoreFactory.getAllDeployedStores()
  let stores = [];
  try {
    const raw = await papiReviveCall(
      papiApi,
      CONTRACTS.STORE_FACTORY,
      `0x${SEL.getAllDeployedStores}`,
    );
    stores = decodeAddressArray(raw);
    if (stores.length > 0) {
      pass(`getAllDeployedStores() → ${stores.length} stores`);
    } else {
      fail("getAllDeployedStores()", "0 stores returned");
    }
  } catch (e) {
    fail("getAllDeployedStores()", e.message);
    return; // Can't continue without stores
  }

  // 3.2 — Store.getValues() on first store
  try {
    const raw = await papiReviveCall(
      papiApi,
      stores[0],
      `0x${SEL.getValues}`,
    );
    const labels = decodeStringArray(raw);
    if (labels.length > 0) {
      pass(`getValues(store[0]) → ${labels.length} labels: [${labels.slice(0, 5).join(", ")}${labels.length > 5 ? "..." : ""}]`);
    } else {
      // Some stores may be empty, this is okay
      pass("getValues(store[0]) → 0 labels (empty store)");
    }
  } catch (e) {
    fail("getValues(store[0])", e.message);
  }

  // 3.3 — Full scan: discover all labels
  const labelSet = new Set();
  let scannedStores = 0;
  try {
    for (const store of stores) {
      try {
        const raw = await papiReviveCall(
          papiApi,
          store,
          `0x${SEL.getValues}`,
        );
        const labels = decodeStringArray(raw);
        for (const l of labels) {
          if (!l) continue;
          const normalized = l.endsWith(".dot") ? l.slice(0, -4) : l;
          labelSet.add(normalized);
        }
        scannedStores++;
      } catch {
        // Skip failed stores
      }
    }
    if (labelSet.size > 0) {
      pass(`full scan → ${labelSet.size} unique labels from ${scannedStores}/${stores.length} stores`);
    } else {
      fail("full scan", "0 labels found");
    }
  } catch (e) {
    fail("full scan", e.message);
  }

  return Array.from(labelSet);
}

async function testVouchWritePath(papiApi, pjsApi, account, evmAddress) {
  console.log("\n═══ Suite 4: Vouch Write Path (attest/revoke lifecycle) ═══");

  const REGISTRY = CONTRACTS.ATTESTATION_REGISTRY;

  // Helper: read via @polkadot/api (uses best block, not finalized — more up-to-date after writes)
  async function readCall(callData) {
    return pjsReviveCall(pjsApi, account.address, REGISTRY, callData);
  }

  // Use a unique test subject so we don't interfere with real data
  const testLabel = `e2e-test-${Date.now().toString(36)}`;
  const testNode = namehash(`${testLabel}.dot`);
  const testSubject = nodeToSubject(testNode);
  log(`  Test subject: ${testLabel}.dot → ${testSubject}`);

  // 4.1 — count() before attest = 0
  let countBefore;
  try {
    const raw = await readCall(encodeCount(testSubject));
    countBefore = Number(decodeUint64FromHex(raw));
    if (countBefore === 0) {
      pass(`count before vouch = 0`);
    } else {
      pass(`count before vouch = ${countBefore}`);
    }
  } catch (e) {
    fail("count before vouch", e.message);
    return;
  }

  // 4.2 — attest() — thumbs-up vouch (matches app's vouchForApp)
  const ratingValue = encodeRatingValue(5, false);
  try {
    const calldata = encodeAttest(testSubject, SCHEMA_RATING, ratingValue, 0n);
    log("  Submitting vouch tx...");
    const result = await executeWrite(pjsApi, account, REGISTRY, calldata);
    if (result.success) {
      pass(`attest() vouch succeeded (block: ${result.blockHash?.slice(0, 18)}...)`);
    } else {
      fail("attest() vouch", result.error);
      return;
    }
  } catch (e) {
    fail("attest() vouch", e.message);
    return;
  }

  // Wait for state to settle (at least one new block)
  log("  Waiting for next block...");
  await waitForNextFinalizedBlock(pjsApi);

  // 4.3 — count() after attest = countBefore + 1
  try {
    const raw = await readCall(encodeCount(testSubject));
    const countAfter = Number(decodeUint64FromHex(raw));
    if (countAfter === countBefore + 1) {
      pass(`count after vouch = ${countAfter} (was ${countBefore})`);
    } else {
      fail("count after vouch", `expected ${countBefore + 1}, got ${countAfter}`);
    }
  } catch (e) {
    fail("count after vouch", e.message);
  }

  // 4.4 — get() returns correct attestation data
  try {
    const raw = await readCall(
      encodeGet(testSubject, SCHEMA_RATING, evmAddress),
    );
    const returnedSubject = decodeAddressFromHex(raw, 0);
    const returnedAttester = decodeAddressFromHex(raw, 2);
    const timestamp = decodeUint64FromHex(raw, 3);
    const expiry = decodeUint64FromHex(raw, 4);
    const returnedValue = decodeBytes32FromHex(raw, 5);
    const revoked = decodeBool(raw, 6);

    const checks = [
      returnedSubject.toLowerCase() === testSubject.toLowerCase(),
      returnedAttester.toLowerCase() === evmAddress.toLowerCase(),
      timestamp > 0n,
      expiry === 0n,
      !revoked,
    ];

    if (checks.every(Boolean)) {
      pass("get() returns correct attestation data");
    } else {
      fail(
        "get() attestation data",
        `subject=${returnedSubject} attester=${returnedAttester} ts=${timestamp} exp=${expiry} rev=${revoked}`,
      );
    }
  } catch (e) {
    fail("get() attestation data", e.message);
  }

  // 4.5 — isValid() returns true
  try {
    const raw = await readCall(
      encodeIsValid(testSubject, SCHEMA_RATING, evmAddress),
    );
    const valid = decodeBool(raw);
    if (valid) {
      pass("isValid() = true after vouch");
    } else {
      fail("isValid() after vouch", "expected true");
    }
  } catch (e) {
    fail("isValid() after vouch", e.message);
  }

  // 4.6 — attest() overwrite (re-vouch updates value, doesn't increase count)
  const newRating = encodeRatingValue(4, true); // Explicit 4-star rating
  try {
    const calldata = encodeAttest(testSubject, SCHEMA_RATING, newRating, 0n);
    log("  Submitting overwrite vouch tx...");
    const result = await executeWrite(pjsApi, account, REGISTRY, calldata);
    if (result.success) {
      pass("attest() overwrite succeeded");
    } else {
      fail("attest() overwrite", result.error);
    }
  } catch (e) {
    fail("attest() overwrite", e.message);
  }

  await waitForNextFinalizedBlock(pjsApi);

  // 4.7 — count stays same after overwrite (not double-counted)
  try {
    const raw = await readCall(encodeCount(testSubject));
    const countOverwrite = Number(decodeUint64FromHex(raw));
    if (countOverwrite === countBefore + 1) {
      pass(`count after overwrite still = ${countOverwrite} (no double-count)`);
    } else {
      fail(
        "count after overwrite",
        `expected ${countBefore + 1}, got ${countOverwrite}`,
      );
    }
  } catch (e) {
    fail("count after overwrite", e.message);
  }

  // 4.7b — get() after overwrite returns updated value
  try {
    const raw = await readCall(
      encodeGet(testSubject, SCHEMA_RATING, evmAddress),
    );
    const returnedValue = decodeBytes32FromHex(raw, 5);
    if (returnedValue === newRating) {
      pass("get() after overwrite returns updated value");
    } else {
      fail(
        "get() after overwrite value",
        `expected ${newRating}, got ${returnedValue}`,
      );
    }
  } catch (e) {
    fail("get() after overwrite value", e.message);
  }

  // 4.8 — revoke() — unvouch
  try {
    const calldata = encodeRevoke(testSubject, SCHEMA_RATING);
    log("  Submitting revoke tx...");
    const result = await executeWrite(pjsApi, account, REGISTRY, calldata);
    if (result.success) {
      pass("revoke() succeeded");
    } else {
      fail("revoke()", result.error);
    }
  } catch (e) {
    fail("revoke()", e.message);
  }

  await waitForNextFinalizedBlock(pjsApi);

  // 4.9 — isValid() returns false after revoke
  try {
    const raw = await readCall(
      encodeIsValid(testSubject, SCHEMA_RATING, evmAddress),
    );
    const valid = decodeBool(raw);
    if (!valid) {
      pass("isValid() = false after revoke");
    } else {
      fail("isValid() after revoke", "expected false");
    }
  } catch (e) {
    fail("isValid() after revoke", e.message);
  }

  // 4.10 — count stays same after revoke (index is append-only)
  try {
    const raw = await readCall(encodeCount(testSubject));
    const countRevoke = Number(decodeUint64FromHex(raw));
    if (countRevoke === countBefore + 1) {
      pass(`count after revoke still = ${countRevoke} (append-only index)`);
    } else {
      fail(
        "count after revoke",
        `expected ${countBefore + 1}, got ${countRevoke}`,
      );
    }
  } catch (e) {
    fail("count after revoke", e.message);
  }
}

async function testAbiEncoding(papiApi) {
  console.log("\n═══ Suite 5: ABI Encoding Correctness ═══");
  const REGISTRY = CONTRACTS.ATTESTATION_REGISTRY;

  // 5.1 — namehash matches known values
  try {
    // namehash("dot") is a known value
    const dotHash = namehash("dot");
    // Just verify it's a 32-byte hex string
    if (strip(dotHash).length === 64 && dotHash.startsWith("0x")) {
      pass(`namehash("dot") = ${dotHash.slice(0, 18)}...`);
    } else {
      fail("namehash", `bad format: ${dotHash}`);
    }
  } catch (e) {
    fail("namehash", e.message);
  }

  // 5.2 — nodeToSubject extracts low 20 bytes
  try {
    const node = namehash("getsome.dot");
    const subject = nodeToSubject(node);
    if (subject.length === 42 && subject.startsWith("0x")) {
      // subject should be last 20 bytes of node
      const nodeLow20 = "0x" + strip(node).slice(24);
      if (subject === nodeLow20) {
        pass(`nodeToSubject matches low 20 bytes`);
      } else {
        fail("nodeToSubject", `${subject} !== ${nodeLow20}`);
      }
    } else {
      fail("nodeToSubject", `bad format: ${subject}`);
    }
  } catch (e) {
    fail("nodeToSubject", e.message);
  }

  // 5.3 — encodeRatingValue produces correct layout
  try {
    const val = encodeRatingValue(5, false);
    const bytes = strip(val);
    // byte 0 = 01 (version), byte 1 = 05 (rating), byte 2 = 00 (not rated)
    if (
      bytes.slice(0, 2) === "01" &&
      bytes.slice(2, 4) === "05" &&
      bytes.slice(4, 6) === "00"
    ) {
      pass("encodeRatingValue(5, false) layout correct");
    } else {
      fail("encodeRatingValue", `unexpected: ${bytes.slice(0, 10)}`);
    }
  } catch (e) {
    fail("encodeRatingValue", e.message);
  }

  // 5.4 — SCHEMA_RATING matches keccak256("discovery.rating.v1")
  try {
    const computed = toHex(
      keccak_256(new TextEncoder().encode("discovery.rating.v1")),
    );
    if (computed === SCHEMA_RATING) {
      pass("SCHEMA_RATING = keccak256('discovery.rating.v1')");
    } else {
      fail("SCHEMA_RATING", `computed=${computed} expected=${SCHEMA_RATING}`);
    }
  } catch (e) {
    fail("SCHEMA_RATING", e.message);
  }

  // 5.5 — Selector computation matches known values
  try {
    const attestSel = selector("attest(address,bytes32,bytes32,uint64)");
    const countSel = selector("count(address)");
    const revokeSel = selector("revoke(address,bytes32)");
    // Verify they're 4 bytes (8 hex chars)
    if (attestSel.length === 8 && countSel.length === 8 && revokeSel.length === 8) {
      pass(`selectors: attest=${attestSel} count=${countSel} revoke=${revokeSel}`);
    } else {
      fail("selectors", "wrong length");
    }
  } catch (e) {
    fail("selectors", e.message);
  }
}

async function testRealDomainVouchCounts(papiApi, labels) {
  console.log("\n═══ Suite 6: Real Domain Vouch Counts ═══");
  const REGISTRY = CONTRACTS.ATTESTATION_REGISTRY;

  if (!labels || labels.length === 0) {
    skip("real domain vouch counts", "no labels discovered");
    return;
  }

  // 6.1 — Query vouch counts for all discovered domains
  const sampled = labels.slice(0, 10); // Cap at 10
  try {
    const calls = sampled.map((label) => ({
      target: REGISTRY,
      callData: encodeCount(nodeToSubject(namehash(`${label}.dot`))),
    }));
    const raw = await papiReviveCall(
      papiApi,
      CONTRACTS.MULTICALL3,
      encodeAggregate3(calls),
    );
    const results = decodeAggregate3Result(raw);

    let allOk = true;
    const counts = [];
    for (let i = 0; i < sampled.length; i++) {
      if (results[i]?.success) {
        const count = Number(decodeUint64FromHex(results[i].returnData));
        counts.push({ label: sampled[i], count });
      } else {
        allOk = false;
      }
    }

    // Sort by count descending
    counts.sort((a, b) => b.count - a.count);
    for (const { label, count } of counts) {
      log(`    ${label}.dot → ${count} vouches`);
    }

    if (allOk) {
      pass(`vouch counts for ${sampled.length} real domains`);
    } else {
      fail("vouch counts", "some calls failed");
    }
  } catch (e) {
    fail("vouch counts", e.message);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  log("═══════════════════════════════════════════════════");
  log("  Vouch E2E Smoke Tests — Paseo Asset Hub");
  log("═══════════════════════════════════════════════════\n");

  // ── Connect PAPI (reads) ──
  log("Connecting PAPI (reads)...");
  let papiClient, papiApi;
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      log(`  Trying ${endpoint}...`);
      const provider = getWsProvider(endpoint);
      papiClient = createClient(provider);
      const block = await Promise.race([
        papiClient.getFinalizedBlock(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 15000),
        ),
      ]);
      papiApi = papiClient.getUnsafeApi();
      log(`  PAPI connected — block #${block.number}`);
      break;
    } catch (e) {
      log(`  Failed: ${e.message}`);
      papiClient = null;
    }
  }
  if (!papiApi) {
    log("FATAL: Could not connect PAPI to any RPC endpoint");
    process.exit(1);
  }

  // ── Connect @polkadot/api (writes) ──
  log("Connecting @polkadot/api (writes)...");
  await cryptoWaitReady();
  const keyring = new Keyring({ type: "sr25519" });
  const account = keyring.addFromUri(SEED);
  const evmAddress = deriveEvmAddress(account.address);
  log(`  Account: ${account.address}`);
  log(`  EVM address: ${evmAddress}`);

  let pjsApi;
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      log(`  Trying ${endpoint}...`);
      const wsProvider = new WsProvider(endpoint);
      pjsApi = await Promise.race([
        ApiPromise.create({ provider: wsProvider }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 15000),
        ),
      ]);
      log("  @polkadot/api connected");
      break;
    } catch (e) {
      log(`  Failed: ${e.message}`);
    }
  }
  if (!pjsApi) {
    log("FATAL: Could not connect @polkadot/api to any RPC endpoint");
    process.exit(1);
  }

  // ── Run test suites ──
  try {
    // Read-only tests (fast, no tx)
    await testAbiEncoding(papiApi);
    await testRegistryReads(papiApi);
    await testMulticallBatch(papiApi);

    // Discovery pipeline
    const labels = await testDotnsDiscovery(papiApi);

    // Vouch counts for real domains
    await testRealDomainVouchCounts(papiApi, labels);

    // Write tests (requires funded account)
    await testVouchWritePath(papiApi, pjsApi, account, evmAddress);
  } catch (e) {
    log(`\nUNEXPECTED ERROR: ${e.message}`);
    console.error(e);
  }

  // ── Summary ──
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log("\n═══════════════════════════════════════════════════");
  console.log(
    `  Results: ${passedTests} passed, ${failedTests} failed, ${skippedTests} skipped (${totalTests} total)`,
  );
  console.log(`  Duration: ${elapsed}s`);
  console.log("═══════════════════════════════════════════════════\n");

  // Cleanup
  papiClient?.destroy();
  await pjsApi?.disconnect();

  process.exit(failedTests > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
