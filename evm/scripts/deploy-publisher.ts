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
  const registrar = config.dotnsRegistrar;
  console.log(`Registrar: ${registrar}`);

  try {
    await ensureMapped(api, signer);

    const artifact = JSON.parse(
      fs.readFileSync(
        path.join(OUT_DIR, "Publisher.sol/Publisher.json"),
        "utf-8"
      )
    );
    const constructorArgs = encodeAbiParameters(parseAbiParameters("address"), [
      registrar as `0x${string}`,
    ]);
    const bytecodeWithArgs =
      artifact.bytecode.object + constructorArgs.replace(/^0x/, "");

    const publisherAddr = await deploy(
      api,
      signer,
      "Publisher",
      bytecodeWithArgs
    );

    console.log("\n--- Summary ---");
    console.log(`Publisher: ${publisherAddr}`);
    console.log(`Registrar: ${registrar}`);
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
