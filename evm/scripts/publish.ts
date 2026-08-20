/**
 * Publishes a label to the Publisher registry, so it shows up in the app grid.
 *
 * `bulletin-deploy --publish` does this as part of a deploy, but it skips the
 * step on environments it does not support, which is every network except the
 * default one. This is the same call, done directly.
 *
 * The caller must own the name, and on a Publisher that gates publishing it must
 * also carry proof of personhood and be under its daily cap.
 *
 * ```sh
 * NETWORK_GENESIS_HASH=0x627f… LABEL=calculator npm run publish
 * ```
 */

import { Binary } from "polkadot-api";
import { decodeEventLog, encodeFunctionData, parseAbi } from "viem";

import { connect, ensureMapped, getSigner, requireEnv } from "./lib.ts";

const ABI = parseAbi([
  "function publish(string label)",
  "function isPublished(bytes32 labelhash) view returns (bool)",
  "event Published(address indexed publisher, bytes32 indexed labelNode, bytes32 indexed labelhash, uint64 timestamp)",
]);

async function main() {
  const label = requireEnv("LABEL", 'The bare label, e.g. LABEL="calculator".');
  const { signer, address } = getSigner();
  const { client, api, config } = connect();

  const publisher = config.PUBLISHER[0]?.address;
  if (!publisher) {
    console.error("This network has no Publisher in the SDK config.");
    process.exit(1);
  }

  console.log(`Caller:    ${address}`);
  console.log(`Publisher: ${publisher}`);
  console.log(`Label:     ${label}.${config.TLD}`);

  try {
    await ensureMapped(api, signer);

    const tx = api.tx.Revive.call({
      dest: Binary.fromHex(publisher),
      value: 0n,
      weight_limit: { ref_time: 500_000_000_000n, proof_size: 5_000_000n },
      storage_deposit_limit: 1_000_000_000_000n,
      data: Binary.fromHex(
        encodeFunctionData({ abi: ABI, functionName: "publish", args: [label] }),
      ),
    });

    console.log("\nPublishing...");
    const event = await new Promise<any>((resolve, reject) => {
      tx.signSubmitAndWatch(signer).subscribe({
        next: (e: any) => {
          console.log(`  ${e.type}`);
          if (e.type === "finalized") resolve(e);
        },
        error: reject,
      });
    });

    if (!event.ok) {
      console.error(
        `\nPublish failed: ${JSON.stringify(event.dispatchError)}. A revert here is` +
          ` usually NotOwner, NoPersonhood, or RateLimitExceeded.`,
      );
      process.exit(1);
    }

    for (const emitted of event.events ?? []) {
      if (emitted.type !== "Revive" || emitted.value?.type !== "ContractEmitted")
        continue;
      try {
        const log = emitted.value.value;
        const decoded = decodeEventLog({
          abi: ABI,
          data: (typeof log.data === "string"
            ? log.data
            : log.data.asHex()) as `0x${string}`,
          topics: (log.topics ?? []).map((t: any) =>
            typeof t === "string" ? t : t.asHex(),
          ) as [`0x${string}`, ...`0x${string}`[]],
        });
        if (decoded.eventName === "Published") {
          console.log(`\n✅ Published ${label}.${config.TLD}`);
          return;
        }
      } catch {
        // not the event we want
      }
    }
    console.log("\nIncluded, but no Published event was decoded.");
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
