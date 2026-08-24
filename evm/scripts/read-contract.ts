/**
 * Reads one view function off a deployed contract, for the active network.
 *
 * The question "what does this contract actually say" comes up constantly while
 * checking a config or a fresh deploy, and writing a throwaway script for it each
 * time is how a session loses an hour. Takes the signature so no ABI file is
 * needed.
 *
 * ```sh
 * NETWORK_GENESIS_HASH=0x23e7... npm run read:contract -- 0x1875B9… "function version() view returns (string)"
 * NETWORK_GENESIS_HASH=0x23e7... npm run read:contract -- 0x46fe8c… "function getSchema(uint256) view returns ((uint256,address,address,bool,bool,string))" 1
 * ```
 *
 * With no signature it reports the code size at the address instead, which is the
 * fastest way to tell a wiped contract from a live one.
 */

import { Binary } from "polkadot-api";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

import { connect } from "./lib.ts";

/** Any account works, this only ever dry-runs. */
const DRY_RUN_ORIGIN = "5C4hrfjw9DjXZTzV3MwzrrAr9P1MLDHajjSidz9bR544LEq1";

function usage(): never {
  console.error(
    'Usage: npm run read:contract -- <address> ["function name() view returns (type)"] [args...]'
  );
  process.exit(1);
}

async function main() {
  const [address, signature, ...args] = process.argv.slice(2);
  if (!address?.startsWith("0x")) usage();

  const { client, api } = connect();
  try {
    const code = await api.apis.ReviveApi.code(Binary.fromHex(address));
    const hex = typeof code === "string" ? code : code.asHex();
    if (hex === "0x") {
      console.log(`${address} EMPTY, nothing deployed here`);
      process.exit(1);
    }
    console.log(`${address} ${(hex.length - 2) / 2} bytes`);
    if (!signature) return;

    const abi = parseAbi([signature]);
    const functionName = signature.split(/[\s(]+/)[1] as string;
    const result = await api.apis.ReviveApi.call(
      DRY_RUN_ORIGIN,
      Binary.fromHex(address),
      0n,
      undefined,
      undefined,
      Binary.fromHex(
        encodeFunctionData({
          abi,
          functionName,
          // Numeric-looking arguments are passed as bigint, everything else verbatim.
          args: args.map((arg) => (/^\d+$/.test(arg) ? BigInt(arg) : arg)),
        })
      )
    );

    if (!result.result.success) {
      console.error(`call failed: ${JSON.stringify(result.result)}`);
      process.exit(1);
    }
    const data = result.result.value.data.asHex();
    if (data === "0x") {
      console.log(`${functionName}() returned no data, the contract has no such getter`);
      return;
    }
    console.log(decodeFunctionResult({ abi, functionName, data }));
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
