// Minimal ABI helpers for DotNS + Multicall3 contract calls.
// Extends the pattern from dotli/src/abi.ts with Multicall3 encoding.

import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  decode as decodeContentHashLib,
  getCodec,
} from "@ensdomains/content-hash";

// ── Hex helpers ─────────────────────────────────────────────

function toHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function uint256Hex(n: number | bigint): string {
  return BigInt(n).toString(16).padStart(64, "0");
}

function padRight(hex: string, byteLen: number): string {
  return hex.padEnd(byteLen * 2, "0");
}

function stripPrefix(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function hexToBytes(hex: string): Uint8Array {
  const h = stripPrefix(hex);
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ── namehash (ENS EIP-137) — copied from dotli/src/abi.ts ──

export function namehash(name: string): `0x${string}` {
  let node = new Uint8Array(32);
  if (name === "") return toHex(node);
  const labels = name.split(".").reverse();
  for (const label of labels) {
    const labelHash = keccak_256(new TextEncoder().encode(label));
    const combined = new Uint8Array(64);
    combined.set(node, 0);
    combined.set(labelHash, 32);
    node = new Uint8Array(keccak_256(combined));
  }
  return toHex(node);
}

// ── Selectors ───────────────────────────────────────────────

function computeSelector(sig: string): string {
  const hash = keccak_256(new TextEncoder().encode(sig));
  return toHex(hash.slice(0, 4)).slice(2);
}

const SEL = {
  getAllDeployedStores: computeSelector("getAllDeployedStores()"),
  getValues: computeSelector("getValues()"),
  contenthash: computeSelector("contenthash(bytes32)"),
  text: computeSelector("text(bytes32,string)"),
  aggregate3: computeSelector("aggregate3((address,bool,bytes)[])"),
  // AttestationRegistry
  attestCount: computeSelector("count(address)"),
  attestList: computeSelector("list(address,uint64,uint64)"),
  attestGetBatch: computeSelector(
    "getBatch((address,bytes32,address)[])",
  ),
  attest: computeSelector("attest(address,bytes32,bytes32,uint64)"),
  revoke: computeSelector("revoke(address,bytes32)"),
  isValid: computeSelector("isValid(address,bytes32,address)"),
  owner: computeSelector("owner()"),
} as const;

// ── Encoders ────────────────────────────────────────────────

export function encodeGetAllDeployedStores(): `0x${string}` {
  return `0x${SEL.getAllDeployedStores}`;
}

export function encodeOwner(): `0x${string}` {
  return `0x${SEL.owner}`;
}

export function encodeGetValues(): `0x${string}` {
  return `0x${SEL.getValues}`;
}

export function encodeContenthash(node: `0x${string}`): `0x${string}` {
  return `0x${SEL.contenthash}${stripPrefix(node).padStart(64, "0")}`;
}

export function encodeText(node: `0x${string}`, key: string): `0x${string}` {
  // text(bytes32, string)
  // head: node(32) + offset_to_string(32)
  // tail: string_length(32) + string_data(padded to 32)
  const nodeHex = stripPrefix(node).padStart(64, "0");
  const offset = uint256Hex(64); // 0x40 — two head slots

  const keyBytes = new TextEncoder().encode(key);
  const keyHex = Array.from(keyBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const paddedKeyLen = Math.ceil(keyBytes.length / 32) * 32;
  const keyEncoded = uint256Hex(keyBytes.length) + padRight(keyHex, paddedKeyLen);

  return `0x${SEL.text}${nodeHex}${offset}${keyEncoded}`;
}

export interface MulticallTarget {
  target: string;
  callData: `0x${string}`;
}

export function encodeAggregate3(calls: MulticallTarget[]): `0x${string}` {
  const n = calls.length;

  // Top-level: selector + offset to array param (0x20)
  let result = SEL.aggregate3 + uint256Hex(32);

  // Array: length
  result += uint256Hex(n);

  // Encode each element: (address, bool, bytes)
  const encodedElements: string[] = [];
  for (const call of calls) {
    const addr = stripPrefix(call.target).toLowerCase().padStart(64, "0");
    const allow = uint256Hex(1); // allowFailure = true
    const bytesOffset = uint256Hex(96); // 0x60 — three head slots

    const callDataHex = stripPrefix(call.callData);
    const callDataBytes = callDataHex.length / 2;
    const paddedLen = Math.ceil(callDataBytes / 32) * 32;
    const bytesEncoded = uint256Hex(callDataBytes) + padRight(callDataHex, paddedLen);

    encodedElements.push(addr + allow + bytesOffset + bytesEncoded);
  }

  // Element offsets: relative to start of offset area (right after length)
  let currentOffset = n * 32;
  for (const elem of encodedElements) {
    result += uint256Hex(currentOffset);
    currentOffset += elem.length / 2; // hex chars → bytes
  }

  // Element data
  for (const elem of encodedElements) {
    result += elem;
  }

  return `0x${result}`;
}

// ── Decoders ────────────────────────────────────────────────

export function decodeAddress(data: `0x${string}`): string {
  const hex = stripPrefix(data);
  return "0x" + hex.slice(24, 64);
}

export function decodeAddressArray(data: `0x${string}`): string[] {
  const hex = stripPrefix(data);
  if (hex.length < 128) return [];

  // ABI: offset(32) → array: length(32) + address(32) each
  const offset = parseInt(hex.slice(0, 64), 16) * 2;
  const length = parseInt(hex.slice(offset, offset + 64), 16);
  const addresses: string[] = [];

  for (let i = 0; i < length; i++) {
    const start = offset + 64 + i * 64;
    addresses.push("0x" + hex.slice(start + 24, start + 64));
  }

  return addresses;
}

export function decodeStringArray(data: `0x${string}`): string[] {
  const hex = stripPrefix(data);
  if (hex.length < 128) return [];

  // ABI: offset(32) → array: length(32) + string_offsets + string_data
  const arrayOffset = parseInt(hex.slice(0, 64), 16) * 2;
  const length = parseInt(hex.slice(arrayOffset, arrayOffset + 64), 16);
  const strings: string[] = [];

  for (let i = 0; i < length; i++) {
    const offsetPos = arrayOffset + 64 + i * 64;
    const strOffset = parseInt(hex.slice(offsetPos, offsetPos + 64), 16) * 2;
    const strStart = arrayOffset + 64 + strOffset;
    const strLen = parseInt(hex.slice(strStart, strStart + 64), 16);

    if (strLen === 0) {
      strings.push("");
      continue;
    }

    const strHex = hex.slice(strStart + 64, strStart + 64 + strLen * 2);
    strings.push(new TextDecoder().decode(hexToBytes(strHex)));
  }

  return strings;
}

export function decodeBytes(data: `0x${string}`): `0x${string}` {
  const hex = stripPrefix(data);
  if (hex.length < 128) return "0x";
  const offset = parseInt(hex.slice(0, 64), 16) * 2;
  const length = parseInt(hex.slice(offset, offset + 64), 16) * 2;
  return `0x${hex.slice(offset + 64, offset + 64 + length)}`;
}

export function decodeString(data: `0x${string}`): string {
  const hex = stripPrefix(data);
  if (hex.length < 128) return "";
  const offset = parseInt(hex.slice(0, 64), 16) * 2;
  const strLen = parseInt(hex.slice(offset, offset + 64), 16);
  if (strLen === 0) return "";
  const strHex = hex.slice(offset + 64, offset + 64 + strLen * 2);
  return new TextDecoder().decode(hexToBytes(strHex));
}

export interface AggregateResult {
  success: boolean;
  returnData: `0x${string}`;
}

export function decodeAggregate3Result(data: `0x${string}`): AggregateResult[] {
  const hex = stripPrefix(data);
  if (hex.length < 128) return [];

  // Return type: (bool, bytes)[]
  const arrayOffset = parseInt(hex.slice(0, 64), 16) * 2;
  const length = parseInt(hex.slice(arrayOffset, arrayOffset + 64), 16);
  const results: AggregateResult[] = [];

  for (let i = 0; i < length; i++) {
    const offsetPos = arrayOffset + 64 + i * 64;
    const elemOffset = parseInt(hex.slice(offsetPos, offsetPos + 64), 16) * 2;
    const elemStart = arrayOffset + 64 + elemOffset;

    // (bool success, bytes returnData)
    const success = parseInt(hex.slice(elemStart, elemStart + 64), 16) !== 0;
    const bytesOffset = parseInt(hex.slice(elemStart + 64, elemStart + 128), 16) * 2;
    const bytesStart = elemStart + bytesOffset;
    const bytesLen = parseInt(hex.slice(bytesStart, bytesStart + 64), 16) * 2;
    const returnData = hex.slice(bytesStart + 64, bytesStart + 64 + bytesLen);

    results.push({
      success,
      returnData: `0x${returnData}`,
    });
  }

  return results;
}

// ── Attestation helpers ─────────────────────────────────────

/** Derive the attestation subject address from a DotNS namehash (low 20 bytes). */
export function nodeToSubject(node: `0x${string}`): `0x${string}` {
  const hex = stripPrefix(node).padStart(64, "0");
  return `0x${hex.slice(24)}`;
}

/** Encode AttestationRegistry.attest(address subject, bytes32 schema, bytes32 value, uint64 expiry) */
export function encodeAttest(
  subject: `0x${string}`,
  schema: `0x${string}`,
  value: `0x${string}`,
  expiry: bigint,
): `0x${string}` {
  return `0x${SEL.attest}${stripPrefix(subject).padStart(64, "0")}${stripPrefix(schema).padStart(64, "0")}${stripPrefix(value).padStart(64, "0")}${uint256Hex(expiry)}`;
}

/** Encode AttestationRegistry.revoke(address subject, bytes32 schema) */
export function encodeRevoke(
  subject: `0x${string}`,
  schema: `0x${string}`,
): `0x${string}` {
  return `0x${SEL.revoke}${stripPrefix(subject).padStart(64, "0")}${stripPrefix(schema).padStart(64, "0")}`;
}

/** Encode AttestationRegistry.count(address subject) */
export function encodeAttestCount(subject: `0x${string}`): `0x${string}` {
  return `0x${SEL.attestCount}${stripPrefix(subject).padStart(64, "0")}`;
}

/** Encode AttestationRegistry.list(address subject, uint64 offset, uint64 limit)
 *  TODO: used by upcoming attestation detail view */
export function encodeAttestList(
  subject: `0x${string}`,
  offset: number,
  limit: number,
): `0x${string}` {
  return `0x${SEL.attestList}${stripPrefix(subject).padStart(64, "0")}${uint256Hex(offset)}${uint256Hex(limit)}`;
}

/** Encode AttestationRegistry.getBatch(AttestationKey[] keys)
 *  TODO: used by upcoming attestation detail view */
export function encodeAttestGetBatch(
  keys: { subject: string; schema: string; attester: string }[],
): `0x${string}` {
  const n = keys.length;

  // Top-level: selector + offset to dynamic array (0x20)
  let result = SEL.attestGetBatch + uint256Hex(32);

  // Array length
  result += uint256Hex(n);

  // Each AttestationKey is a static tuple: (address, bytes32, address)
  // = 3 x 32 bytes = 96 bytes per element, encoded inline (no offsets needed)
  for (const key of keys) {
    result += stripPrefix(key.subject).toLowerCase().padStart(64, "0");
    result += stripPrefix(key.schema).padStart(64, "0");
    result += stripPrefix(key.attester).toLowerCase().padStart(64, "0");
  }

  return `0x${result}`;
}

/** Decode uint64 return value (e.g. from count()). Returns null on malformed data. */
export function decodeUint64(data: `0x${string}`): number | null {
  const hex = stripPrefix(data);
  if (hex.length < 64) return null;
  // uint64 is right-aligned in a 32-byte ABI word; read the last 8 bytes
  return Number(BigInt("0x" + hex.slice(48, 64)));
}

/** Decoded attestation key from list()
 *  TODO: used by upcoming attestation detail view */
export interface AttestationKey {
  subject: string;
  schema: string;
  attester: string;
}

/** Decode AttestationKey[] from list() return
 *  TODO: used by upcoming attestation detail view */
export function decodeAttestationKeyArray(data: `0x${string}`): AttestationKey[] {
  const hex = stripPrefix(data);
  if (hex.length < 128) return [];

  // ABI: offset(32) → array: length(32) + elements
  const offset = parseInt(hex.slice(0, 64), 16) * 2;
  const length = parseInt(hex.slice(offset, offset + 64), 16);
  const keys: AttestationKey[] = [];

  // Each AttestationKey is (address, bytes32, address) = 3 x 32 bytes inline
  for (let i = 0; i < length; i++) {
    const start = offset + 64 + i * 192; // 3 * 64 hex chars
    const subject = "0x" + hex.slice(start + 24, start + 64);
    const schema = "0x" + hex.slice(start + 64, start + 128);
    const attester = "0x" + hex.slice(start + 152, start + 192);
    keys.push({ subject, schema, attester });
  }

  return keys;
}

/** Decoded attestation from getBatch()
 *  TODO: used by upcoming attestation detail view */
export interface DecodedAttestation {
  subject: string;
  schema: string;
  attester: string;
  timestamp: number;
  expiry: number;
  value: `0x${string}`;
  revoked: boolean;
}

/** Decode Attestation[] from getBatch() return
 *  TODO: used by upcoming attestation detail view */
export function decodeAttestationArray(data: `0x${string}`): DecodedAttestation[] {
  const hex = stripPrefix(data);
  if (hex.length < 128) return [];

  // ABI: offset(32) → array of static structs (no per-element offsets)
  const arrayOffset = parseInt(hex.slice(0, 64), 16) * 2;
  const length = parseInt(hex.slice(arrayOffset, arrayOffset + 64), 16);
  const results: DecodedAttestation[] = [];

  // Each Attestation struct has 7 static fields, packed inline:
  // (address, bytes32, address, uint64, uint64, bytes32, bool) = 7 x 32 bytes
  for (let i = 0; i < length; i++) {
    const start = arrayOffset + 64 + i * 448; // 7 * 64 hex chars
    const subject = "0x" + hex.slice(start + 24, start + 64);
    const schema = "0x" + hex.slice(start + 64, start + 128);
    const attester = "0x" + hex.slice(start + 152, start + 192);
    const timestamp = parseInt(hex.slice(start + 192, start + 256), 16);
    const expiry = parseInt(hex.slice(start + 256, start + 320), 16);
    const value = ("0x" + hex.slice(start + 320, start + 384)) as `0x${string}`;
    const revoked = parseInt(hex.slice(start + 384, start + 448), 16) !== 0;
    results.push({ subject, schema, attester, timestamp, expiry, value, revoked });
  }

  return results;
}

/**
 * Encode a rating value into bytes32 for AttestationRegistry.attest().
 * Layout: version(1) | rating(1) | rated(1) | reserved(1) | reviewDigest(28)
 * TODO: used by upcoming vouch button (write path)
 */
export function encodeRatingValue(
  rating: number,
  explicitlyRated: boolean,
  reviewDigest?: Uint8Array,
): `0x${string}` {
  const buf = new Uint8Array(32);
  buf[0] = 0x01;                          // version
  buf[1] = Math.max(1, Math.min(5, rating)); // rating 1-5
  buf[2] = explicitlyRated ? 0x01 : 0x00;   // rated flag
  if (reviewDigest && reviewDigest.length >= 28) {
    buf.set(reviewDigest.slice(0, 28), 4);
  }
  return toHex(buf);
}

/** Decode a rating value from bytes32
 *  TODO: used by upcoming attestation detail view */
export function decodeRatingValue(hex: `0x${string}`): {
  version: number;
  rating: number;
  explicitlyRated: boolean;
  reviewDigest: Uint8Array;
} {
  const bytes = hexToBytes(hex);
  return {
    version: bytes[0],
    rating: bytes[1],
    explicitlyRated: bytes[2] === 0x01,
    reviewDigest: bytes.slice(4, 32),
  };
}

/** Encode AttestationRegistry.isValid(address subject, bytes32 schema, address attester) */
export function encodeIsValid(
  subject: `0x${string}`,
  schema: `0x${string}`,
  attester: `0x${string}`,
): `0x${string}` {
  return `0x${SEL.isValid}${stripPrefix(subject).padStart(64, "0")}${stripPrefix(schema).padStart(64, "0")}${stripPrefix(attester).padStart(64, "0")}`;
}

/** Decode a single bool ABI word (e.g. from isValid). */
export function decodeBool(data: `0x${string}`): boolean {
  const hex = stripPrefix(data);
  if (hex.length < 64) return false;
  return BigInt("0x" + hex.slice(0, 64)) !== 0n;
}

// ── Contenthash decoding — copied from dotli/src/abi.ts ─────

export function decodeIpfsContenthash(contenthashHex: string): string | null {
  const hex = stripPrefix(contenthashHex);
  if (!hex || hex === "0" || hex.length < 4) return null;
  try {
    if (getCodec(hex) !== "ipfs") return null;
    return decodeContentHashLib(hex) || null;
  } catch {
    return null;
  }
}
