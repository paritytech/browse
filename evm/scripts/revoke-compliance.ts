import { AccountId, Binary } from "polkadot-api";
import {
  encodeFunctionData,
  encodePacked,
  keccak256,
  namehash,
  parseAbi
} from "viem";

import { connect, ensureMapped, getSigner, waitBestBlock } from "./lib.ts";

// The single .dot domain to revoke the compliance attestation from. No default.
const DOMAIN = process.argv[2];
if (!DOMAIN) {
  console.error("Usage: revoke-compliance <domain>   (e.g. browse)");
  process.exit(1);
}
const label = DOMAIN.toLowerCase().replace(/\.dot$/, "");

const ABI = parseAbi([
  "function revoke((uint256 schema, (uint256 id) data) request)"
]);

/** Low 20 bytes of the namehash — the EAS subject form (matches the app). */
function recipientOf(label: string): `0x${string}` {
  return `0x${namehash(`${label}.dot`).slice(-40)}` as `0x${string}`;
}

/** The pallet-revive EVM address an SS58 account controls: keccak256(accountId)[12..]. */
function evmAddressOf(ss58: string): `0x${string}` {
  return `0x${keccak256(AccountId().enc(ss58)).slice(-40)}` as `0x${string}`;
}

async function isMapped(api: any, ss58: string): Promise<boolean> {
  const original = await api.query.Revive.OriginalAccount.getValue(
    Binary.fromHex(evmAddressOf(ss58))
  );
  return original != null;
}

async function main() {
  const { signer, address } = getSigner();
  const { client, api, config } = connect();

  const ATTESTATION_SERVICE = (process.env.ATTESTATION_SERVICE ??
    config.ATTESTATION_SERVICE) as `0x${string}`;
  const SCHEMA_ID = config.COMPLIANCE_SCHEMA_ID;

  // A unique-schema attestation lives at the deterministic slot
  // keccak256(attester, recipient, schema) — the same id the service minted.
  const attester = evmAddressOf(address);
  const recipient = recipientOf(label);
  const id = BigInt(
    keccak256(
      encodePacked(["address", "address", "uint256"], [attester, recipient, SCHEMA_ID])
    )
  );

  console.log(`Revoker (trusted attester): ${address}`);
  console.log(`AttestationService: ${ATTESTATION_SERVICE}`);
  console.log(`Compliance schema ID: ${SCHEMA_ID}`);
  console.log(`Domain: ${label}.dot`);
  console.log(`Recipient: ${recipient}`);
  console.log(`Attestation id: ${id}`);

  if (!SCHEMA_ID || SCHEMA_ID === 0n) {
    console.error("COMPLIANCE_SCHEMA_ID is not set for this network.");
    process.exit(1);
  }

  try {
    if (!(await isMapped(api, address))) {
      console.log("Account not mapped; mapping...");
      await ensureMapped(api, signer);
    }

    const callData = encodeFunctionData({
      abi: ABI,
      functionName: "revoke",
      args: [{ schema: SCHEMA_ID, data: { id } }]
    });

    const tx = api.tx.Revive.call({
      dest: Binary.fromHex(ATTESTATION_SERVICE),
      value: 0n,
      weight_limit: { ref_time: 10_000_000_000n, proof_size: 1_000_000n },
      storage_deposit_limit: 1_000_000_000_000n,
      data: Binary.fromHex(callData)
    });

    await waitBestBlock(tx, signer, `revoke ${label}`);
    console.log(`  ✅ ${label}.dot compliance attestation revoked`);
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
