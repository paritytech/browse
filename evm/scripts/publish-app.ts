/**
 * publish-app.ts — Publish a `.dot` label to the deployed Publisher.
 *
 * Hardcoded to sign with the bare Substrate `DEV_PHRASE` (no derivation), so
 * the caller is `5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV` →
 * H160 `0x35cdb23ff7fc86e8dccd577ca309bfea9c978d20`. Ignores `MNEMONIC` in env.
 *
 * Usage:
 *   tsx publish-app.ts <label>
 *   LABEL=<label> npm run publish-app
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  ss58Encode,
} from "@polkadot-labs/hdkd-helpers";
import { Binary } from "polkadot-api";
import { getPolkadotSigner } from "polkadot-api/signer";
import { encodeAbiParameters, parseAbiParameters, toHex } from "viem";

import { connect, ensureMapped, waitBestBlock } from "./lib.ts";

const PUBLISHER = "0x1307fc02d308f879a16b1ae3a49b4927aed53649";
const PERSONHOOD = "0x000000000000000000000000000000000a010000";
const PERSONHOOD_CONTEXT = stringToBytes32("dotns");

const POP_TIER = ["None", "Lite", "Full"] as const;

function stringToBytes32(s: string): `0x${string}` {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length > 32) throw new Error(`"${s}" exceeds 32 bytes`);
  const padded = new Uint8Array(32);
  padded.set(bytes);
  return toHex(padded);
}

function selector(sig: string): `0x${string}` {
  const hash = keccak_256(new TextEncoder().encode(sig));
  return toHex(hash.slice(0, 4));
}

function publicKeyToH160(publicKey: Uint8Array): `0x${string}` {
  // Matches `@polkadot-api/sdk-ink`'s `ss58ToEthereum` — also the H160 that
  // Revive.map_account assigns for an unmapped substrate account.
  return toHex(keccak_256(publicKey).slice(12));
}

function devPhraseSigner() {
  const entropy = mnemonicToEntropy(DEV_PHRASE);
  const miniSecret = entropyToMiniSecret(entropy);
  const derive = sr25519CreateDerive(miniSecret);
  const keyPair = derive("");
  return {
    signer: getPolkadotSigner(keyPair.publicKey, "Sr25519", keyPair.sign),
    publicKey: keyPair.publicKey,
    ss58: ss58Encode(keyPair.publicKey),
  };
}

const UNLIMITED_WEIGHT = {
  ref_time: 18_446_744_073_709_551_615n,
  proof_size: 18_446_744_073_709_551_615n,
};

async function reviveCall(
  api: any,
  origin: string,
  dest: `0x${string}`,
  callData: `0x${string}`
): Promise<{ flags: number; data: `0x${string}` }> {
  const result = await api.apis.ReviveApi.call(
    origin,
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

async function queryPopStatus(
  api: any,
  origin: string,
  account: `0x${string}`
): Promise<number> {
  const sel = selector("personhoodStatus(address,bytes32)");
  const args = encodeAbiParameters(parseAbiParameters("address, bytes32"), [
    account,
    PERSONHOOD_CONTEXT,
  ]);
  const data = (sel + args.slice(2)) as `0x${string}`;

  const { flags, data: out } = await reviveCall(api, origin, PERSONHOOD, data);
  if ((flags & 1) === 1) {
    throw new Error(`PoP precompile reverted: ${out}`);
  }
  // Returned struct PersonhoodInfo { uint8 status; bytes32 contextAlias; }.
  // status is the last byte of the first 32-byte word.
  const hex = out.slice(2);
  return parseInt(hex.slice(62, 64), 16);
}

// Selector → human-readable name for Publisher's errors.
const ERROR_SELECTORS: Record<string, string> = {
  [selector("EmptyLabel()")]: "EmptyLabel()",
  [selector("NoPersonhood()")]: "NoPersonhood()",
  [selector("CooldownActive(uint64)")]: "CooldownActive(uint64)",
  [selector("NotOwner(address,uint256)")]: "NotOwner(address,uint256)",
};

function explainRevert(revertHex: `0x${string}`): string {
  if (revertHex.length < 10) return `(empty revert: ${revertHex})`;
  const sel = revertHex.slice(0, 10) as `0x${string}`;
  const name = ERROR_SELECTORS[sel];
  return name ? `${name} (selector ${sel})` : `unknown selector ${sel}`;
}

async function dryRunPublish(
  api: any,
  origin: string,
  label: string
): Promise<{ ok: true } | { ok: false; revert: string }> {
  const sel = selector("publish(string)");
  const args = encodeAbiParameters(parseAbiParameters("string"), [label]);
  const data = (sel + args.slice(2)) as `0x${string}`;

  const { flags, data: out } = await reviveCall(api, origin, PUBLISHER, data);
  if ((flags & 1) === 1) {
    return { ok: false, revert: explainRevert(out) };
  }
  return { ok: true };
}

async function submitPublish(api: any, signer: any, label: string) {
  const sel = selector("publish(string)");
  const args = encodeAbiParameters(parseAbiParameters("string"), [label]);
  const data = (sel + args.slice(2)) as `0x${string}`;

  const tx = api.tx.Revive.call({
    dest: Binary.fromHex(PUBLISHER),
    value: 0n,
    weight_limit: { ref_time: 10_000_000_000n, proof_size: 1_000_000n },
    storage_deposit_limit: 1_000_000_000_000n,
    data: Binary.fromHex(data),
  });
  await waitBestBlock(tx, signer, `publish("${label}")`);
}

async function main() {
  const label = process.argv[2] ?? process.env.LABEL;
  if (!label) {
    console.error("Usage: tsx publish-app.ts <label>");
    console.error("   or: LABEL=<label> npm run publish-app");
    process.exit(1);
  }

  const { signer, publicKey, ss58 } = devPhraseSigner();
  const h160 = publicKeyToH160(publicKey);

  console.log("Caller (DEV_PHRASE, no derivation):");
  console.log(`  SS58: ${ss58}`);
  console.log(`  H160: ${h160}`);
  console.log(`Publisher: ${PUBLISHER}`);
  console.log(`Label:     "${label}"`);

  const { client, api } = connect();
  try {
    await ensureMapped(api, signer);

    console.log('\nQuerying PoP status (context "dotns")...');
    const status = await queryPopStatus(api, ss58, h160);
    const tier = POP_TIER[status] ?? `unknown(${status})`;
    console.log(`  → status = ${status} (${tier})`);

    console.log("\nDry-running publish...");
    const dryRun = await dryRunPublish(api, ss58, label);
    if (!dryRun.ok) {
      console.log(`  → would revert: ${dryRun.revert}`);
      console.log("\nSkipping on-chain submission.");
      return;
    }
    console.log("  → dry-run succeeded");

    console.log("\nSubmitting publish...");
    await submitPublish(api, signer, label);
    console.log(`  → published "${label}"`);
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
