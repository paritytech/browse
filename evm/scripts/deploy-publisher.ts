import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { encodeAbiParameters, namehash, parseAbiParameters } from "viem";

import { contractVersion, deploy } from "./create3.ts";
import { connect, ensureMapped, getSigner } from "./lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../out");
const SRC_DIR = path.resolve(__dirname, "../src");

async function main() {
  const { signer, address } = getSigner();
  console.log(`Deployer: ${address}`);

  const { client, api, config } = connect();
  const registrar = config.REGISTRAR;
  // The TLD node the registrar keys names by, which is what Publisher derives
  // its token ids from. Same value as `tldNode()` on the dotNS protocol registry.
  const node = namehash(config.TLD);
  console.log(`Registrar: ${registrar}`);
  console.log(`TLD:       .${config.TLD} (${node})`);

  try {
    await ensureMapped(api, signer);

    const artifact = JSON.parse(
      fs.readFileSync(
        path.join(OUT_DIR, "Publisher.sol/Publisher.json"),
        "utf-8"
      )
    );
    const constructorArgs = encodeAbiParameters(
      parseAbiParameters("address, bytes32"),
      [registrar as `0x${string}`, node]
    );
    const bytecodeWithArgs =
      artifact.bytecode.object + constructorArgs.replace(/^0x/, "");

    const version = contractVersion(path.join(SRC_DIR, "Publisher.sol"));
    const { address: publisherAddr, status } = await deploy(
      api,
      signer,
      { name: "Publisher", version, initCode: bytecodeWithArgs, network: config }
    );

    console.log("\n--- Summary ---");
    console.log(`Publisher: ${publisherAddr} (${version}, ${status})`);
    console.log(`Registrar: ${registrar}`);
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
