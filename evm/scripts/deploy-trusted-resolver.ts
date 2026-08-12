import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { AccountId } from "polkadot-api";
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbiParameters,
} from "viem";

import { contractVersion, deploy } from "./create3.ts";
import { connect, ensureMapped, getSigner } from "./lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../out");
const SRC_DIR = path.resolve(__dirname, "../src");

async function main() {
  const { signer, address } = getSigner();
  console.log(`Deployer: ${address}`);

  const { client, api, config } = connect();
  const ATTESTATION_SERVICE = (process.env.ATTESTATION_SERVICE ??
    config.ATTESTATION_SERVICE) as `0x${string}`;
  // Defaults to the deployer, so a solo deployer is its own certifier.
  const TRUSTED_ATTESTER_SS58_ADDRESS =
    process.env.TRUSTED_ATTESTER_SS58_ADDRESS || address;
  // The resolver gates on the pallet-revive EVM address, derived from the SS58 account
  // (keccak256(accountId) truncated to 20 bytes), so attestations match the trusted attester.
  const trustedAttester = getAddress(
    `0x${keccak256(AccountId().enc(TRUSTED_ATTESTER_SS58_ADDRESS)).slice(-40)}`
  );
  console.log(`AttestationService: ${ATTESTATION_SERVICE}`);
  console.log(`TrustedAttester (SS58): ${TRUSTED_ATTESTER_SS58_ADDRESS}`);
  console.log(`TrustedAttester (EVM):  ${trustedAttester}`);

  try {
    await ensureMapped(api, signer);

    const artifact = JSON.parse(
      fs.readFileSync(
        path.join(
          OUT_DIR,
          "TrustedAttesterIndexResolver.sol/TrustedAttesterIndexResolver.json"
        ),
        "utf-8"
      )
    );
    const constructorArgs = encodeAbiParameters(
      parseAbiParameters("address, address"),
      [ATTESTATION_SERVICE, trustedAttester]
    );
    const bytecodeWithArgs =
      artifact.bytecode.object + constructorArgs.replace(/^0x/, "");

    const version = contractVersion(
      path.join(SRC_DIR, "TrustedAttesterIndexResolver.sol")
    );
    const { address: resolverAddr, status } = await deploy(
      api,
      signer,
      {
        name: "TrustedAttesterIndexResolver",
        version,
        initCode: bytecodeWithArgs,
        network: config,
      }
    );

    console.log("\n--- Summary ---");
    console.log(`Resolver: ${resolverAddr} (${version}, ${status})`);
    console.log(`AttestationService: ${ATTESTATION_SERVICE}`);
    console.log(`TrustedAttester (SS58): ${TRUSTED_ATTESTER_SS58_ADDRESS}`);
    console.log(`TrustedAttester (EVM):  ${trustedAttester}`);
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
