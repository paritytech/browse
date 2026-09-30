/**
 * The repo certificate in `certificates/`, and the CIDs its files take on Bulletin.
 *
 * Each asset is addressed as CIDv1(raw, blake2b-256), the shape the host preimage
 * manager resolves, so the CID of a file is the same whoever stores it.
 */

import { readFileSync } from "node:fs";

import { blake2b } from "@noble/hashes/blake2.js";

/** The name every attestation of the repo certificate carries. */
export const CERTIFICATE_NAME = "Parity User Interface Compliance";

/** The certificate files, keyed by the attestation field their CID fills. */
export const CERTIFICATE_ASSETS = [
  { label: "badgeIconCid", file: "parity-user-interface-compliance-badge.svg" },
  { label: "contentCid", file: "parity-user-interface-compliance.md" },
] as const;

// Multibase base32 (lower, no padding), the "b" CIDv1 alphabet.
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
// CIDv1 prefix for codec raw 0x55, multihash blake2b-256 0xb220, length 32.
const CIDV1_PREFIX = new Uint8Array([0x01, 0x55, 0xa0, 0xe4, 0x02, 0x20]);

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
export function digestToCid(digest: Uint8Array): string {
  const full = new Uint8Array(CIDV1_PREFIX.length + digest.length);
  full.set(CIDV1_PREFIX);
  full.set(digest, CIDV1_PREFIX.length);
  return `b${base32Encode(full)}`;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// A known digest and CID pair. If the encoding drifts, every emitted CID is wrong.
{
  const ref = digestToCid(
    hexToBytes(
      "0xb5cc1a4d8efe1d0911c1a75e64bddaeee72c9791910d24af95736611e86d3ee8",
    ),
  );
  const expected =
    "bafk2bzacec24ygsnr37b2cirygtv4zf53lxoolexsgiq2jfpsvzwmepinu7oq";
  if (ref !== expected) {
    throw new Error(`CID encoding self-check failed: ${ref} !== ${expected}`);
  }
}

/** Read a certificate file from the repo `certificates/` folder. */
export function readCertificateFile(file: string): Uint8Array {
  return new Uint8Array(
    readFileSync(new URL(`../../certificates/${file}`, import.meta.url)),
  );
}

/** The CID of each certificate asset, keyed by its attestation field. */
export function certificateCids(): Record<
  (typeof CERTIFICATE_ASSETS)[number]["label"],
  string
> {
  const cids = {} as Record<
    (typeof CERTIFICATE_ASSETS)[number]["label"],
    string
  >;
  for (const asset of CERTIFICATE_ASSETS) {
    cids[asset.label] = digestToCid(
      blake2b(readCertificateFile(asset.file), { dkLen: 32 }),
    );
  }
  return cids;
}
