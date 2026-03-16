// Chain connection via product-sdk host (dot.li's smoldot instance).
// Copied reviveCall pattern from dotli/src/resolve.ts.

import { createClient, type PolkadotClient, type PolkadotSigner } from "polkadot-api";
import { Binary, FixedSizeBinary } from "polkadot-api";
import {
  DUMMY_ORIGIN,
  DRY_RUN_WEIGHT_LIMIT,
  DRY_RUN_STORAGE_LIMIT,
  ASSET_HUB_PASEO_GENESIS,
} from "./config";
import { dlog } from "./debug";
import { getPolkadotSignerFromPjs } from "@polkadot-api/pjs-signer";
import { fromHex } from "@novasamatech/host-api";

import { blake2b } from "@noble/hashes/blake2.js";
import { base58 } from "@scure/base";

/** Encode a 32-byte public key as SS58 address (prefix 42 = generic Substrate). */
function ss58Encode(publicKey: Uint8Array, prefix = 42): string {
  const payload = new Uint8Array(35); // 1 prefix + 32 key + 2 checksum
  payload[0] = prefix;
  payload.set(publicKey, 1);
  const context = new TextEncoder().encode("SS58PRE");
  const input = new Uint8Array(context.length + 33);
  input.set(context);
  input.set(payload.subarray(0, 33), context.length);
  const hash = blake2b(input, { dkLen: 64 });
  payload[33] = hash[0];
  payload[34] = hash[1];
  return base58.encode(payload);
}

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

// ── Wallet account from product-sdk ─────────────────────────

export interface WalletAccount {
  publicKey: Uint8Array;
  name: string | undefined;
  signer: PolkadotSigner;
}

let cachedAccount: WalletAccount | null = null;

/**
 * Get the user's wallet account from the host.
 * Returns null if not inside the host or if user rejects.
 */
export async function getWalletAccount(): Promise<WalletAccount | null> {
  if (cachedAccount) return cachedAccount;

  try {
    const sdk = await import("@novasamatech/product-sdk");
    const accounts = sdk.createAccountsProvider();

    // This call may trigger the host's sign-in prompt if not connected.
    // We don't cache failures so subsequent vouch taps re-trigger the prompt.
    const result = await accounts.getProductAccount("browse");
    if (result.isErr()) {
      dlog(`Wallet account unavailable: ${result.error.tag}`, "warn");
      return null;
    }

    const { publicKey, name } = result.value;

    // The SDK's getProductAccountSigner passes raw hex as the address,
    // but the host's signPayload expects SS58. Convert before creating the signer.
    const ss58Address = ss58Encode(publicKey);
    dlog(`Wallet SS58: ${ss58Address}`);

    // Build signer with SS58 address
    const signer = getPolkadotSignerFromPjs(
      ss58Address,
      async (payload) => {
        const response = await sdk.hostApi.signPayload(
          { tag: "v1", value: payload } as any,
        );
        return response.match(
          (r: any) => ({
            id: 0,
            signature: r.value.signature,
            signedTransaction: r.value.signedTransaction,
          }),
          (e: any) => { throw e.value; },
        );
      },
      async (raw) => {
        const response = await sdk.hostApi.signRaw(
          { tag: "v1", value: {
            address: raw.address,
            data: raw.type === "bytes"
              ? { tag: "Bytes" as const, value: fromHex(raw.data as `0x${string}`) }
              : { tag: "Payload" as const, value: raw.data },
          }} as any,
        );
        return response.match(
          (r: any) => ({
            id: 0,
            signature: r.value.signature,
            signedTransaction: r.value.signedTransaction,
          }),
          (e: any) => { throw e.value; },
        );
      },
    );

    cachedAccount = { publicKey, name, signer };
    dlog(`Wallet connected: ${name ?? "unnamed"} (${ss58Address.slice(0, 8)}...)`);
    return cachedAccount;
  } catch (err) {
    dlog(`Failed to get wallet: ${err}`, "warn");
    return null;
  }
}

// ── Revive write transaction ────────────────────────────────

/**
 * Submit an EVM contract call via Revive.call extrinsic.
 * Handles account mapping automatically (optimistic: try call first, batch with map_account if needed).
 */
export async function reviveSubmit(
  contractAddress: string,
  encodedData: `0x${string}`,
  account: WalletAccount,
): Promise<string> {
  const api = await ensureApi();

  const destHex = (contractAddress.startsWith("0x") ? contractAddress : `0x${contractAddress}`) as `0x${string}`;
  const reviveCallArgs = {
    dest: FixedSizeBinary.fromHex(destHex),
    value: 0n,
    weight_limit: { ref_time: 100_000_000_000n, proof_size: 500_000n },
    storage_deposit_limit: 10_000_000_000_000n,
    data: Binary.fromHex(encodedData),
  };

  // Try direct call (works for already-mapped accounts)
  try {
    dlog("Submitting Revive.call...");
    const tx = api.tx.Revive.call(reviveCallArgs);
    const result = await tx.signAndSubmit(account.signer);
    dlog(`Transaction included in block: ${result.block.hash}`);
    return result.block.hash;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isUnmapped =
      msg.includes("NoAccount") ||
      msg.includes("NotMapped") ||
      msg.includes("OriginMustBeMapped") ||
      msg.includes("Unmapped");

    if (!isUnmapped) throw err;
    dlog("Account not mapped, retrying with map_account batch");
  }

  // Batch map_account + call
  try {
    const mapCall = api.tx.Revive.map_account({}).decodedCall;
    const reviveCall = api.tx.Revive.call(reviveCallArgs).decodedCall;
    const batchTx = api.tx.Utility.batch_all({ calls: [mapCall, reviveCall] });
    const result = await batchTx.signAndSubmit(account.signer);
    dlog(`Batch transaction included in block: ${result.block.hash}`);
    return result.block.hash;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("AccountAlreadyMapped")) {
      dlog("Account was mapped concurrently, retrying call only");
      const tx = api.tx.Revive.call(reviveCallArgs);
      const result = await tx.signAndSubmit(account.signer);
      return result.block.hash;
    }
    throw err;
  }
}
