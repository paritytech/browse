/**
 * Publishes a label to the Publisher registry, so it shows up in the app grid.
 *
 * `bulletin-deploy --publish` does this during a deploy, but it skips the step on
 * environments it does not support, which is every network except its default.
 * This is the same call, done directly.
 *
 * Which calldata goes out depends on the Publisher the network writes to, which
 * this reads from the SDK config rather than assuming. Version 2.x authorizes on
 * name ownership and takes the label alone. Version 3.0.0 dropped the owner path,
 * so it takes a personhood proof as well, and the proof inputs below are needed.
 *
 * The 3.0.0 contract rewrites the proof `message` to
 * `getPublishDigest(msg.sender, labelhash)` and the `context` to `dotns` before
 * verifying, so the proof has to be built over exactly those.
 *
 * Two things about the proof, both learned the hard way:
 *
 *   - `proof` must be **SCALE length-prefixed**, a compact length followed by the
 *     raw ring-VRF bytes. Passing the raw bytes verifies fine locally and is
 *     rejected by the precompile with no explanation.
 *   - the proof is built with `verifiablejs`, which is not a dependency here, so
 *     it comes in through the environment. Run
 *     `app/scripts/build-publish-proof.ts` to produce it, or read the recipe in
 *     `docs/publishing-registry.md`.
 *
 * ```sh
 * NETWORK_GENESIS_HASH=0x… LABEL=calculator \
 *   PROOF=0x450c… ALIAS=0x… RING=0 CONTEXT=0x646f746e73…00 REVISION=4 MSG=0x… \
 *   npm run publish
 * ```
 *
 * Against a 2.x registry the proof variables are ignored, so `LABEL` is enough.
 */

import { Binary } from "polkadot-api";
import { encodeFunctionData, parseAbi } from "viem";

import { connect, ensureMapped, getSigner, requireEnv } from "./lib.ts";

/** Publisher 3.0.0 and later, where every publish carries a personhood proof. */
const PROOF_ABI = parseAbi([
  "function publish(string label, (uint8 expectedStatus, bytes proof, bytes32 expectedAlias, uint32 ringIndex, bytes32 context, uint32 revision, bytes message) request)",
]);

/** Publisher 2.x, which predates the proof and authorizes on name ownership. */
const OWNER_ABI = parseAbi(["function publish(string label)"]);

/** Headroom over the dry-run estimate, so a slightly heavier real run still fits. */
const WEIGHT_MARGIN = 3n;

async function main() {
  const label = requireEnv("LABEL", 'The bare label, e.g. LABEL="calculator".');

  const { signer, address } = getSigner();
  const { client, api, config } = connect();

  const publisher = config.PUBLISHER[0]?.address;
  if (!publisher) {
    console.error("This network has no Publisher in the SDK config.");
    process.exit(1);
  }

  // 2.x has no proof path, so which calldata to send is a property of the
  // deployment the network writes to, not of the caller.
  const version = config.PUBLISHER[0]!.version;
  const needsProof = !version.startsWith("2.");

  console.log(`Caller:    ${address}`);
  console.log(`Publisher: ${publisher} (${version})`);
  console.log(`Label:     ${label}.${config.TLD}`);

  try {
    await ensureMapped(api, signer);
    const data = needsProof
      ? encodeFunctionData({
          abi: PROOF_ABI,
          functionName: "publish",
          args: [
            label,
            {
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
            },
          ],
        })
      : encodeFunctionData({
          abi: OWNER_ABI,
          functionName: "publish",
          args: [label],
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
        `\nDry run reverted, not submitting. Against a proof registry, empty return` +
          ` data means the proof did not verify, which is NoPersonhood: check it is` +
          ` length-prefixed and the revision is still in RingRoots. Otherwise the` +
          ` caller most likely does not own the name.`,
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
