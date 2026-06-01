import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { connect, deploy, ensureMapped, getSigner } from "./lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../out");

async function main() {
  const { signer, address } = getSigner();
  console.log(`Deployer: ${address}`);

  const { client, api } = connect();

  try {
    await ensureMapped(api, signer);

    const artifact = JSON.parse(
      fs.readFileSync(
        path.join(OUT_DIR, "Multicall3.sol/Multicall3.json"),
        "utf-8"
      )
    );
    const multicallAddr = await deploy(
      api,
      signer,
      "Multicall3",
      artifact.bytecode.object
    );

    console.log("\n--- Summary ---");
    console.log(`Multicall3: ${multicallAddr}`);
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
