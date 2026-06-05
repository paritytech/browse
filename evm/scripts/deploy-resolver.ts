import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { encodeAbiParameters, parseAbiParameters } from "viem";

import { connect, deploy, ensureMapped, getSigner } from "./lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../out");

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

    const resolverAddr = await deploy(
      api,
      signer,
      "RecipientAndAttesterIndexResolver",
      bytecodeWithArgs
    );

    console.log("\n--- Summary ---");
    console.log(`Resolver: ${resolverAddr}`);
    console.log(`AttestationService: ${ATTESTATION_SERVICE}`);
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
