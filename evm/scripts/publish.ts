/**
 * Publishes a label to the Publisher registry, so it shows up in the app grid.
 *
 * `bulletin-deploy --publish` does this during a deploy, but it skips the step on
 * environments it does not support, which is every network except its default.
 * This is the same call, done directly.
 *
 * Publisher 3.0.0 takes a personhood proof alongside the label, and there is no
 * owner path any more, so every publish needs one. The contract rewrites the
 * proof `message` to `getPublishDigest(msg.sender, labelhash)` and the `context`
 * to `dotns` before verifying, so the proof has to be built over exactly those.
 *
 * Two things about the inputs, both learned the hard way:
 *
 *   - `proof` must be **SCALE length-prefixed**, a compact length followed by the
 *     raw ring-VRF bytes. Passing the raw bytes verifies fine locally and is
 *     rejected by the precompile with no explanation.
 *   - the proof is built with `verifiablejs`, which is not a dependency here, so
 *     it comes in through the environment. `docs/publishing-registry.md` has the
 *     recipe.
 *
 * ```sh
 * NETWORK_GENESIS_HASH=0x… LABEL=calculator \
 *   PROOF=0x450c… ALIAS=0x… RING=0 CONTEXT=0x646f746e73…00 REVISION=4 MSG=0x… \
 *   npm run publish
 * ```
 */

import { Binary } from "polkadot-api";
import { encodeFunctionData, parseAbi } from "viem";

import { connect, ensureMapped, getSigner, requireEnv } from "./lib.ts";

const ABI = parseAbi([
  "function publish(string label, (uint8 expectedStatus, bytes proof, bytes32 expectedAlias, uint32 ringIndex, bytes32 context, uint32 revision, bytes message) request)",
]);

/** Headroom over the dry-run estimate, so a slightly heavier real run still fits. */
const WEIGHT_MARGIN = 3n;

async function main() {
  const label = requireEnv("LABEL", 'The bare label, e.g. LABEL="calculator".');
  const request = {
    // 2 is Full, 1 is Lite. The tier sets the daily cap the registry enforces.
    expectedStatus: Number(process.env.EXPECTED_STATUS ?? 2),
    proof: requireEnv(
      "PROOF",
      "SCALE length-prefixed ring proof.",
    ) as `0x${string}`,
    expectedAlias: requireEnv("ALIAS") as `0x${string}`,
    ringIndex: Number(process.env.RING ?? 0),
    context: requireEnv("CONTEXT") as `0x${string}`,
    revision: Number(
      requireEnv("REVISION", "A revision currently in RingRoots."),
    ),
    message: requireEnv(
      "MSG",
      "The publish digest the proof was built over.",
    ) as `0x${string}`,
  };

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
    const data = encodeFunctionData({
      abi: ABI,
      functionName: "publish",
      args: [label, request],
    });

    // Dry run first: it prices the call and, more usefully, catches a bad proof
    // for free. `flags` is the revert bit, and it is set while `success` is true,
    // so both have to be read.
    const dry = await api.apis.ReviveApi.call(
      address,
      Binary.fromHex(publisher),
      0n,
      undefined,
      undefined,
      Binary.fromHex(data),
    );
    if (!dry.result.success || dry.result.value.flags !== 0) {
      console.error(
        `\nDry run reverted, not submitting. Empty return data means the proof did` +
          ` not verify, which is NoPersonhood. Check the proof is length-prefixed` +
          ` and the revision is still in RingRoots.`,
      );
      process.exit(1);
    }
    const need = dry.weight_required ?? dry.weight_consumed;
    console.log(
      `Weight:    ${need.ref_time} ref_time, ${need.proof_size} proof_size`,
    );

    const tx = api.tx.Revive.call({
      dest: Binary.fromHex(publisher),
      value: 0n,
      weight_limit: {
        ref_time: (need.ref_time * WEIGHT_MARGIN) / 2n,
        proof_size: (need.proof_size * WEIGHT_MARGIN) / 2n + 10_000n,
      },
      storage_deposit_limit: 1_000_000_000_000n,
      data: Binary.fromHex(data),
    });

    console.log("\nPublishing...");
    const result = await new Promise<any>((resolve, reject) => {
      tx.signSubmitAndWatch(signer).subscribe({
        next: (event: any) => {
          console.log(`  ${event.type}`);
          if (event.type === "finalized") resolve(event);
        },
        error: reject,
      });
    });

    if (!result.ok) {
      console.error(`\nFailed: ${JSON.stringify(result.dispatchError)}`);
      process.exit(1);
    }
    console.log(`\n✅ Published ${label}.${config.TLD}`);
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
