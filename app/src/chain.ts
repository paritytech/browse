// Chain connection via product-sdk host (dot.li's smoldot instance).
// Copied reviveCall pattern from dotli/src/resolve.ts.

import { createClient, type PolkadotClient } from "polkadot-api";
import { Binary } from "polkadot-api";
import {
  DUMMY_ORIGIN,
  DRY_RUN_WEIGHT_LIMIT,
  DRY_RUN_STORAGE_LIMIT,
  ASSET_HUB_PASEO_GENESIS,
} from "./config";
import { dlog } from "./debug";

let clientInstance: PolkadotClient | null = null;
let apiInstance: ReturnType<PolkadotClient["getUnsafeApi"]> | null = null;

let ensurePromise: Promise<ReturnType<PolkadotClient["getUnsafeApi"]>> | null =
  null;

export type ChainStatusCallback = (msg: string) => void;
let onChainStatus: ChainStatusCallback | null = null;

/** Register a callback for chain connection progress messages. */
export function setChainStatusCallback(cb: ChainStatusCallback): void {
  onChainStatus = cb;
}

async function doEnsureApi(): Promise<
  ReturnType<PolkadotClient["getUnsafeApi"]>
> {
  dlog("Importing product-sdk...");
  const sdk = await import("@novasamatech/product-sdk");
  dlog(`product-sdk loaded (${Object.keys(sdk).length} exports)`);

  dlog(`Creating papi provider for ${ASSET_HUB_PASEO_GENESIS.slice(0, 10)}...`);
  const provider = sdk.createPapiProvider(ASSET_HUB_PASEO_GENESIS);

  dlog("Creating polkadot-api client...");
  clientInstance = createClient(provider);

  dlog("Waiting for finalized block...");
  onChainStatus?.("Connecting to chain...");
  const block = await Promise.race([
    clientInstance.getFinalizedBlock(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Chain sync timed out after 120s")), 120_000),
    ),
  ]);
  dlog(`Connected to chain — block #${block.number}`);

  apiInstance = clientInstance.getUnsafeApi();
  return apiInstance;
}

async function ensureApi(): Promise<
  ReturnType<PolkadotClient["getUnsafeApi"]>
> {
  if (apiInstance) return apiInstance;
  if (!ensurePromise) {
    ensurePromise = doEnsureApi().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

// ── reviveCall — read-only EVM dry-run (from dotli/src/resolve.ts) ──

interface ReviveExecResult {
  value?: ReviveOkResult;
  isOk?: boolean;
  ok?: ReviveOkResult;
  result?: ReviveExecResult;
}

interface ReviveOkResult {
  flags?: { toString?: () => string } | number | string;
  data?:
    | string
    | { asHex: () => string }
    | { toHex: () => string }
    | Uint8Array;
}

export async function reviveCall(
  contractAddress: string,
  encodedData: `0x${string}`,
): Promise<`0x${string}`> {
  const api = await ensureApi();

  const result = (await api.apis.ReviveApi.call(
    DUMMY_ORIGIN,
    Binary.fromHex(contractAddress as `0x${string}`),
    0n,
    DRY_RUN_WEIGHT_LIMIT,
    DRY_RUN_STORAGE_LIMIT,
    Binary.fromHex(encodedData),
  )) as { result: ReviveExecResult };

  const execResult = result.result;
  const ok =
    execResult.value ??
    (execResult.isOk === true
      ? (execResult as unknown as ReviveOkResult)
      : null) ??
    execResult.ok ??
    null;

  if (ok === null) throw new Error("Revive call failed: no result");

  const flagsRaw = ok.flags;
  const flagsStr =
    typeof flagsRaw === "object" && typeof flagsRaw?.toString === "function"
      ? flagsRaw.toString()
      : String(flagsRaw ?? 0);
  if ((BigInt(flagsStr) & 1n) === 1n)
    throw new Error("Contract execution reverted");

  const data = ok.data;
  if (typeof data === "string") return data as `0x${string}`;
  if (data && "asHex" in data && typeof data.asHex === "function")
    return data.asHex() as `0x${string}`;
  if (data && "toHex" in data && typeof data.toHex === "function")
    return data.toHex() as `0x${string}`;
  if (data instanceof Uint8Array) {
    return `0x${Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  return "0x";
}
