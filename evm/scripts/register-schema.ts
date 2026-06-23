import { Binary } from "polkadot-api";
import { decodeEventLog, encodeFunctionData, parseAbi } from "viem";

import { primaryAttestationResolver } from "@parity/browse-sdk/config";

import {
  connect,
  ensureMapped,
  getSigner,
  requireEnv,
  waitBestBlock,
} from "./lib.ts";

const SCHEMA = requireEnv("SCHEMA", 'The schema spec, e.g. SCHEMA="bool like".');
const REVOCABLE = process.env.REVOCABLE !== "false";
const UNIQUE = process.env.UNIQUE === "true";

const ABI = parseAbi([
  "function register(string schema, bool revocable, bool unique, address resolver) returns (uint256)",
  "event Registered(uint256 indexed id, address indexed registerer, (uint256 id, address registerer, address resolver, bool revocable, bool unique, string schema) schema)",
]);

async function main() {
  const { signer, address } = getSigner();
  const { client, api, config } = connect();

  const SCHEMA_REGISTRY = (process.env.SCHEMA_REGISTRY ??
    config.SCHEMA_REGISTRY) as `0x${string}`;
  const RESOLVER = (process.env.RESOLVER ??
    primaryAttestationResolver(config)) as `0x${string}`;

  console.log(`Caller: ${address}`);
  console.log(`SchemaRegistry: ${SCHEMA_REGISTRY}`);
  console.log(`Schema: "${SCHEMA}"`);
  console.log(`Revocable: ${REVOCABLE}`);
  console.log(`Unique: ${UNIQUE}`);
  console.log(`Resolver: ${RESOLVER}`);

  try {
    await ensureMapped(api, signer);

    const callData = encodeFunctionData({
      abi: ABI,
      functionName: "register",
      args: [SCHEMA, REVOCABLE, UNIQUE, RESOLVER],
    });

    console.log("\nRegistering schema on-chain...");
    const tx = api.tx.Revive.call({
      dest: Binary.fromHex(SCHEMA_REGISTRY),
      value: 0n,
      weight_limit: { ref_time: 10_000_000_000n, proof_size: 1_000_000n },
      storage_deposit_limit: 1_000_000_000_000n,
      data: Binary.fromHex(callData),
    });

    const event = await waitBestBlock(tx, signer, "register");

    // Find the Registered event in the emitted events.
    const reviveEvents = (event.events ?? []).filter(
      (e: any) => e.type === "Revive" && e.value?.type === "ContractEmitted",
    );

    for (const evt of reviveEvents) {
      try {
        const logData = evt.value.value;
        const topics = (logData.topics ?? []).map((t: any) =>
          typeof t === "string" ? t : t.asHex(),
        );
        const data =
          typeof logData.data === "string"
            ? logData.data
            : logData.data.asHex();
        const decoded = decodeEventLog({
          abi: ABI,
          data: data as `0x${string}`,
          topics: topics as [`0x${string}`, ...`0x${string}`[]],
        });
        if (decoded.eventName === "Registered") {
          console.log(`\n✅ Schema registered with ID: ${decoded.args.id}`);
          return;
        }
      } catch {
        // not the event we want
      }
    }

    console.log(
      "\n⚠️  Transaction included but Registered event was not decoded.",
    );
    console.log("   Check the block explorer for the schema ID.");
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
