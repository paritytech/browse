/**
 * whois.ts — Inspect a `.dot` label's on-chain state.
 *
 * Prints labelhash, namehash, the current dotns owner (or "unminted"), and
 * whether the label is currently in the Publisher's live set.
 *
 * Usage:
 *   tsx whois.ts <label>
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { Binary } from "polkadot-api";
import { encodeAbiParameters, parseAbiParameters, toHex } from "viem";

import { connect } from "./lib.ts";

const PUBLISHER = "0x1307fc02d308f879a16b1ae3a49b4927aed53649";
const DOT_NODE =
  "0x3fce7d1364a893e213bc4212792b517ffc88f5b13b86c8ef9c8d390c3a1370ce";
const DUMMY_ORIGIN = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

const UNLIMITED_WEIGHT = {
  ref_time: 18_446_744_073_709_551_615n,
  proof_size: 18_446_744_073_709_551_615n,
};

function selector(sig: string): `0x${string}` {
  return toHex(keccak_256(new TextEncoder().encode(sig)).slice(0, 4));
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function reviveCall(
  api: any,
  dest: `0x${string}`,
  callData: `0x${string}`
): Promise<{ flags: number; data: `0x${string}` }> {
  const result = await api.apis.ReviveApi.call(
    DUMMY_ORIGIN,
    Binary.fromHex(dest),
    0n,
    UNLIMITED_WEIGHT,
    18_446_744_073_709_551_615n,
    Binary.fromHex(callData),
    { at: "best" }
  );
  if (!result.result.success) {
    throw new Error(`Revive.call dispatch failed: ${JSON.stringify(result)}`);
  }
  const { flags, data } = result.result.value;
  return { flags, data: data.asHex() as `0x${string}` };
}

async function main() {
  const label = process.argv[2] ?? process.env.LABEL;
  if (!label) {
    console.error("Usage: tsx whois.ts <label>");
    process.exit(1);
  }

  const labelhash = keccak_256(new TextEncoder().encode(label));
  const concat = new Uint8Array(64);
  concat.set(hexToBytes(DOT_NODE), 0);
  concat.set(labelhash, 32);
  const node = keccak_256(concat);
  const tokenId = BigInt(toHex(node));

  console.log(`Label:     ${label}`);
  console.log(`Labelhash: ${toHex(labelhash)}`);
  console.log(`Node:      ${toHex(node)}`);
  console.log(`TokenId:   ${tokenId}`);

  const { client, api, config } = connect();
  try {
    const registrar = config.dotnsRegistrar;
    console.log(`Registrar: ${registrar}`);

    const ownerSel = selector("ownerOf(uint256)");
    const ownerArgs = encodeAbiParameters(parseAbiParameters("uint256"), [
      tokenId,
    ]);
    const { flags: ownerFlags, data: ownerOut } = await reviveCall(
      api,
      registrar,
      (ownerSel + ownerArgs.slice(2)) as `0x${string}`
    );
    if ((ownerFlags & 1) === 1) {
      console.log(`Owner:     (registrar reverted — token not minted)`);
    } else {
      const owner = ("0x" + ownerOut.slice(-40)) as `0x${string}`;
      console.log(`Owner:     ${owner}`);
    }

    const pubSel = selector("isPublished(bytes32)");
    const pubArgs = encodeAbiParameters(parseAbiParameters("bytes32"), [
      toHex(labelhash),
    ]);
    const { flags: pubFlags, data: pubOut } = await reviveCall(
      api,
      PUBLISHER,
      (pubSel + pubArgs.slice(2)) as `0x${string}`
    );
    if ((pubFlags & 1) === 1) {
      console.log(`Published: (publisher reverted: ${pubOut})`);
    } else {
      console.log(`Published: ${pubOut.endsWith("01")}`);
    }
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
