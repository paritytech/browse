import { AccountId, Binary } from "polkadot-api";
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  namehash,
  parseAbi
} from "viem";

import { connect, ensureMapped, getSigner, waitBestBlock } from "./lib.ts";

// The single .dot domain to certify, passed as a CLI argument. No default.
const DOMAIN = process.argv[2];
if (!DOMAIN) {
  console.error("Usage: attest-compliance <domain>   (e.g. browse)");
  process.exit(1);
}
const label = DOMAIN.toLowerCase().replace(/\.dot$/, "");

const ABI = parseAbi([
  "function attest((uint256 schema, (address recipient, uint64 expirationTime, bool revocable, uint256 refId, bytes data) data) request) returns (uint256)"
]);

/** Low 20 bytes of the namehash — the EAS subject form (matches the app). */
function recipientOf(label: string): `0x${string}` {
  return `0x${namehash(`${label}.dot`).slice(-40)}` as `0x${string}`;
}

/** The pallet-revive EVM address an SS58 account controls: keccak256(accountId)[12..]. */
function evmAddressOf(ss58: string): `0x${string}` {
  return `0x${keccak256(AccountId().enc(ss58)).slice(-40)}` as `0x${string}`;
}

/** True when the account is already mapped in pallet-revive (OriginalAccount is set). */
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

  console.log(`Caller (trusted attester): ${address}`);
  console.log(`AttestationService: ${ATTESTATION_SERVICE}`);
  console.log(`Compliance schema ID: ${SCHEMA_ID}`);
  console.log(`Domain: ${label}.dot`);

  if (!SCHEMA_ID || SCHEMA_ID === 0n) {
    console.error("COMPLIANCE_SCHEMA_ID is not set for this network.");
    process.exit(1);
  }

  try {
    // Map the account only if it isn't already mapped — mapping then attesting in
    // the same run otherwise races on the nonce (the attest goes stale).
    if (await isMapped(api, address)) {
      console.log("Account already mapped.");
    } else {
      console.log("Account not mapped; mapping...");
      await ensureMapped(api, signer);
    }

    // Schema spec is "bool compliant".
    const data = encodeAbiParameters([{ type: "bool" }], [true]);
    const recipient = recipientOf(label);
    console.log(`\nAttesting "${label}.dot" → recipient ${recipient}`);

    const callData = encodeFunctionData({
      abi: ABI,
      functionName: "attest",
      args: [
        {
          schema: SCHEMA_ID,
          data: {
            recipient,
            expirationTime: 0n,
            revocable: true,
            refId: 0n,
            data
          }
        }
      ]
    });

    const tx = api.tx.Revive.call({
      dest: Binary.fromHex(ATTESTATION_SERVICE),
      value: 0n,
      weight_limit: { ref_time: 10_000_000_000n, proof_size: 1_000_000n },
      storage_deposit_limit: 1_000_000_000_000n,
      data: Binary.fromHex(callData)
    });

    await waitBestBlock(tx, signer, `attest ${label}`);
    console.log(`  ✅ ${label}.dot certified`);
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
