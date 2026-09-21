/**
 * What the active network holds of the Browse stack, as JSON on stdout.
 *
 * The staged deploy decides from this what to skip, so a rerun after a chain
 * reset only puts back what is missing. Every contract in the config is probed
 * for code, and the two schemas are looked up on the registry by their ids.
 *
 * ```sh
 * NETWORK_GENESIS_HASH=0x4349... npm run -s probe:state
 * ```
 */
import { Binary } from "polkadot-api";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { connect } from "./lib.ts";

/** Any account works, this only ever dry-runs. Reads are at the best block:
 * the deploy stages write and then read again, and finality lags. */
const DRY_RUN_ORIGIN = "5C4hrfjw9DjXZTzV3MwzrrAr9P1MLDHajjSidz9bR544LEq1";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const REGISTRY_ABI = parseAbi([
  "function getSchema(uint256 id) view returns ((uint256 id, address registerer, address resolver, bool revocable, bool unique, string schema))",
  "function schemaCount() view returns (uint256)",
]);

export interface SchemaState {
  id: string;
  registered: boolean;
  schema: string | null;
}

export interface NetworkState {
  /** Bytes of code at each configured contract, 0 when nothing is deployed there. */
  contracts: Record<string, { address: string; codeBytes: number }>;
  schemaCount: string | null;
  schemas: { like: SchemaState; compliance: SchemaState };
}

async function codeBytes(api: any, address: string): Promise<number> {
  if (!address || address === ZERO_ADDRESS) return 0;
  const code = await api.apis.ReviveApi.code(Binary.fromHex(address), {
    at: "best",
  });
  const hex: string = typeof code === "string" ? code : code.asHex();
  return (hex.length - 2) / 2;
}

async function view(api: any, address: string, data: `0x${string}`) {
  const result = await api.apis.ReviveApi.call(
    DRY_RUN_ORIGIN,
    Binary.fromHex(address),
    0n,
    undefined,
    undefined,
    Binary.fromHex(data),
    { at: "best" },
  );
  if (!result.result.success) return null;
  const returned = result.result.value.data;
  return (
    typeof returned === "string" ? returned : returned.asHex()
  ) as `0x${string}`;
}

async function schemaState(
  api: any,
  registry: string,
  id: bigint,
): Promise<SchemaState> {
  const raw = await view(
    api,
    registry,
    encodeFunctionData({
      abi: REGISTRY_ABI,
      functionName: "getSchema",
      args: [id],
    }),
  );
  if (raw === null)
    return { id: id.toString(), registered: false, schema: null };
  const record = decodeFunctionResult({
    abi: REGISTRY_ABI,
    functionName: "getSchema",
    data: raw,
  });
  const registered = record.registerer !== ZERO_ADDRESS;
  return {
    id: id.toString(),
    registered,
    schema: registered ? record.schema : null,
  };
}

async function main() {
  const { client, api, config } = connect();
  try {
    const addresses = {
      Multicall3: config.MULTICALL3,
      StoreFactory: config.STORE_FACTORY,
      DotnsRegistry: config.REGISTRY,
      DotnsRegistrar: config.REGISTRAR,
      DotnsContentResolver: config.CONTENT_RESOLVER,
      SchemaRegistry: config.SCHEMA_REGISTRY,
      AttestationService: config.ATTESTATION_SERVICE,
      Publisher: config.PUBLISHER[0]?.address ?? ZERO_ADDRESS,
      RecipientAndAttesterIndexResolver:
        config.ATTESTATION_INDEX_RESOLVER[0] ?? ZERO_ADDRESS,
      TrustedAttesterIndexResolver: config.TRUSTED_ATTESTER_RESOLVER,
    };
    const contracts: NetworkState["contracts"] = {};
    for (const [name, address] of Object.entries(addresses)) {
      contracts[name] = { address, codeBytes: await codeBytes(api, address) };
    }

    const registryLive = contracts.SchemaRegistry!.codeBytes > 0;
    const countRaw = registryLive
      ? await view(
          api,
          config.SCHEMA_REGISTRY,
          encodeFunctionData({
            abi: REGISTRY_ABI,
            functionName: "schemaCount",
          }),
        )
      : null;
    const state: NetworkState = {
      contracts,
      schemaCount:
        countRaw === null
          ? null
          : decodeFunctionResult({
              abi: REGISTRY_ABI,
              functionName: "schemaCount",
              data: countRaw,
            }).toString(),
      schemas: {
        like: registryLive
          ? await schemaState(api, config.SCHEMA_REGISTRY, config.SCHEMA_ID[0]!)
          : {
              id: config.SCHEMA_ID[0]!.toString(),
              registered: false,
              schema: null,
            },
        compliance: registryLive
          ? await schemaState(
              api,
              config.SCHEMA_REGISTRY,
              config.COMPLIANCE_SCHEMA_ID,
            )
          : {
              id: config.COMPLIANCE_SCHEMA_ID.toString(),
              registered: false,
              schema: null,
            },
      },
    };
    console.log(JSON.stringify(state));
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
