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
} as const;

// ── Encoders ────────────────────────────────────────────────

export function encodeGetAllDeployedStores(): `0x${string}` {
  return `0x${SEL.getAllDeployedStores}`;
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
