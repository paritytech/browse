import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { encodeAbiParameters, parseAbiParameters } from "viem";

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
  console.log(`AttestationService: ${ATTESTATION_SERVICE}`);

  try {
    await ensureMapped(api, signer);

    const artifact = JSON.parse(
      fs.readFileSync(
        path.join(
          OUT_DIR,
          "RecipientAndAttesterIndexResolver.sol/RecipientAndAttesterIndexResolver.json"
        ),
        "utf-8"
      )
    );
    const constructorArgs = encodeAbiParameters(parseAbiParameters("address"), [
      ATTESTATION_SERVICE,
    ]);
    const bytecodeWithArgs =
      artifact.bytecode.object + constructorArgs.replace(/^0x/, "");

    const version = contractVersion(
      path.join(SRC_DIR, "RecipientAndAttesterIndexResolver.sol")
    );
    const { address: resolverAddr, status } = await deploy(
      api,
      signer,
      {
        name: "RecipientAndAttesterIndexResolver",
        version,
        initCode: bytecodeWithArgs,
        network: config,
      }
    );

    console.log("\n--- Summary ---");
    console.log(`Resolver: ${resolverAddr} (${version}, ${status})`);
    console.log(`AttestationService: ${ATTESTATION_SERVICE}`);
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
