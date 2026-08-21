/**
 * Checks the SDK network config against the chain it claims to describe.
 *
 * A chain reset changes the genesis hash and wipes every contract, and the
 * symptom is a client that connects happily and finds nothing. Run this first
 * when anything looks empty, and before any deploy, so a stale entry surfaces
 * as a report rather than as a failed transaction.
 *
 * Reads only. Reports a non-zero exit when something does not line up.
 */

import { createClient } from "polkadot-api";
import { Binary } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import {
  decodeFunctionResult,
  encodeFunctionData,
  namehash,
  parseAbi,
} from "viem";

import { connect } from "./lib.ts";

const PUBLISHER_ABI = parseAbi(["function tldNode() view returns (bytes32)"]);

/** Genesis a chain reports, or null when it cannot be reached. */
async function genesisOf(rpc: string): Promise<string | null> {
  const client = createClient(getWsProvider([rpc]));
  try {
    return (await client.getChainSpecData()).genesisHash;
  } catch {
    return null;
  }
  // Deliberately not destroyed. Tearing down a second client throws on a later
  // tick, where a try cannot catch it, and it took the whole report down after
  // it had already printed. The process exits at the end of main regardless.
}

/** Runtime code at an address, `0x` when nothing is deployed there. */
async function codeAt(api: any, address: string): Promise<string> {
  const code = await api.apis.ReviveApi.code(Binary.fromHex(address));
  return typeof code === "string" ? code : code.asHex();
}

async function main() {
  const { client, api, config } = connect();
  let problems = 0;

  try {
    const spec = await client.getChainSpecData();
    const configured = process.env.NETWORK_GENESIS_HASH;
    const genesisMatches = spec.genesisHash === configured;
    console.log(`chain:    ${spec.name}`);
    console.log(
      `genesis:  ${spec.genesisHash} ${genesisMatches ? "ok" : "MISMATCH"}`,
    );
    if (!genesisMatches) {
      console.log(`          config says ${configured}`);
      problems++;
    }

    // The People chain gets reset alongside Asset Hub, and its genesis gates the
    // identity flows, so a stale one here is just as breaking.
    const peopleRpc = config.PEOPLE_RPCS?.[0];
    if (peopleRpc && config.PEOPLE_GENESIS) {
      const reported = await genesisOf(peopleRpc);
      const peopleMatches = reported === config.PEOPLE_GENESIS;
      if (!peopleMatches) problems++;
      console.log(
        `people:   ${reported ?? "unreachable"} ${peopleMatches ? "ok" : "MISMATCH"}`,
      );
      if (!peopleMatches)
        console.log(`          config says ${config.PEOPLE_GENESIS}`);
    }

    const targets: [string, string][] = [
      ["MULTICALL3", config.MULTICALL3],
      ["STORE_FACTORY", config.STORE_FACTORY],
      ["CONTENT_RESOLVER", config.CONTENT_RESOLVER],
      ["REGISTRY", config.REGISTRY],
      ["REGISTRAR", config.REGISTRAR],
      ["SCHEMA_REGISTRY", config.SCHEMA_REGISTRY],
      ["ATTESTATION_SERVICE", config.ATTESTATION_SERVICE],
      ["TRUSTED_ATTESTER_RESOLVER", config.TRUSTED_ATTESTER_RESOLVER],
      ...(config.CREATE3_FACTORY
        ? ([["CREATE3_FACTORY", config.CREATE3_FACTORY]] as [string, string][])
        : []),
      ...config.PUBLISHER.map((deployment): [string, string] => [
        `PUBLISHER ${deployment.version}`,
        deployment.address,
      ]),
      ...config.ATTESTATION_INDEX_RESOLVER.map(
        (address, i): [string, string] => [
          `ATTESTATION_INDEX_RESOLVER[${i}]`,
          address,
        ],
      ),
    ];

    console.log("");
    for (const [label, address] of targets) {
      const code = await codeAt(api, address);
      const live = code !== "0x";
      if (!live) problems++;
      console.log(
        `${label.padEnd(28)} ${address} ${live ? `${(code.length - 2) / 2} bytes` : "EMPTY"}`,
      );
    }

    // The Publisher bakes in the TLD node it derives token ids from, so a
    // mismatch here means names resolve against the wrong root.
    const publisher = config.PUBLISHER[0]?.address;
    if (publisher && (await codeAt(api, publisher)) !== "0x") {
      const result = await api.apis.ReviveApi.call(
        "5C4hrfjw9DjXZTzV3MwzrrAr9P1MLDHajjSidz9bR544LEq1",
        Binary.fromHex(publisher),
        0n,
        undefined,
        undefined,
        Binary.fromHex(
          encodeFunctionData({ abi: PUBLISHER_ABI, functionName: "tldNode" }),
        ),
      );
      // Publisher gained `tldNode()` in 2.2.0. An older one answers with no data,
      // which is not a mismatch, there is simply nothing to compare against.
      const returned = result.result.success
        ? result.result.value.data.asHex()
        : "0x";
      if (returned === "0x") {
        console.log(
          `\ntld:      .${config.TLD}, this Publisher does not expose tldNode()`,
        );
      } else {
        const onChain = decodeFunctionResult({
          abi: PUBLISHER_ABI,
          functionName: "tldNode",
          data: result.result.value.data.asHex(),
        });
        const expected = namehash(config.TLD);
        const tldMatches = onChain === expected;
        if (!tldMatches) problems++;
        console.log(
          `\ntld:      .${config.TLD} ${tldMatches ? "ok" : "MISMATCH"}`,
        );
        if (!tldMatches)
          console.log(
            `          publisher says ${onChain}, config hashes to ${expected}`,
          );
      }
    }

    console.log(
      `\n${problems === 0 ? "config matches the chain" : `${problems} problem(s)`}`,
    );
  } finally {
    client.destroy();
  }

  process.exit(problems === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
