import { CONTRACTS, SCHEMA_RATING } from "./config";
import {
  namehash,
  nodeToSubject,
  encodeGetAllDeployedStores,
  encodeGetValues,
  encodeContenthash,
  encodeText,
  encodeAttestCount,
  encodeAttestList,
  encodeAttestGetBatch,
  encodeAttest,
  encodeRevoke,
  encodeIsValid,
  encodeRatingValue,
  decodeAddressArray,
  decodeStringArray,
  decodeBytes,
  decodeString,
  decodeIpfsContenthash,
  decodeUint64,
  decodeBool,
  decodeAttestationKeyArray,
  decodeAttestationArray,
  decodeRatingValue,
  type MulticallTarget,
} from "./abi";
import { reviveCall, reviveSubmit, getWalletAccount, apiInstance } from "./chain";
import { multicall } from "./multicall";
import { dlog } from "./debug";
import { fetchStoreProducts } from "./store";

export interface AppEntry {
  /** DotNS label (e.g. "getsome") */
  label: string;
  /** Display name from manifest, or null to fall back to label.dot */
  name: string | null;
  description: string;
  contentHash: string | null;
  isLive: boolean;
  /** Number of attestations (vouches) for this product. null = not yet loaded. */
  vouchCount: number | null;
  /** Which list this entry belongs to */
  source: "pcf" | "all";
}

export type FilterMode = "pcf" | "all";

/** Display name: manifest name if available, otherwise "label.dot" */
export function displayName(app: AppEntry): string {
  return app.name ?? `${app.label}.dot`;
}

// ── Real chain queries ──────────────────────────────────────

/** Callback invoked as labels are discovered (before metadata). */
export type OnLabelsFound = (apps: AppEntry[]) => void;

function sortApps(apps: AppEntry[]): AppEntry[] {
  return apps.slice().sort((a, b) => {
    // Live first, then alphabetical
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return displayName(a).localeCompare(displayName(b));
  });
}

/**
 * Fetch PCF products from the Store contract.
 * Single call to getProducts() returns label, name, description directly.
 */
async function fetchPcfApps(): Promise<AppEntry[]> {
  const t0 = performance.now();
  dlog("PCF: Store.getProducts()");
  const storeProducts = await fetchStoreProducts();
  dlog(`PCF: ${storeProducts.length} products from Store (total ${(performance.now() - t0).toFixed(0)}ms)`);

  if (storeProducts.length === 0) return [];

  return storeProducts.map((p) => ({
    label: p.label,
    name: p.name || null,
    description: p.description || "No description",
    contentHash: null,
    isLive: true,
    vouchCount: null,
    source: "pcf" as const,
  }));
}

/**
 * Fetch apps from the DotNS StoreFactory + ContentResolver + AttestationRegistry.
 * Used for the "All" tab.
 */
async function fetchAllApps(): Promise<AppEntry[]> {
  // Step 1: Get all store addresses from StoreFactory
  dlog("All: StoreFactory.getAllDeployedStores()");
  const storesData = await reviveCall(
    CONTRACTS.STORE_FACTORY,
    encodeGetAllDeployedStores(),
  );
  const storeAddresses = decodeAddressArray(storesData);
  dlog(`Found ${storeAddresses.length} stores`);

  if (storeAddresses.length === 0) return [];

  // Step 2: Concurrent getValues() on each store
  const CONCURRENCY = 4;
  dlog(`All: Scanning ${storeAddresses.length} stores (concurrency=${CONCURRENCY})`);
  const labelSet = new Set<string>();

  async function scanStore(s: number): Promise<void> {
    try {
      const raw = await reviveCall(
        storeAddresses[s] as `0x${string}`,
        encodeGetValues(),
      );
      const storeLabels = decodeStringArray(raw);
      for (const l of storeLabels) {
        if (!l) continue;
        const normalized = l.endsWith(".dot") ? l.slice(0, -4) : l;
        labelSet.add(normalized);
      }
    } catch {
      dlog(`  store[${s}]: call failed`, "warn");
    }
  }

  async function scanConcurrent(total: number, limit: number): Promise<void> {
    let next = 0;
    async function worker(): Promise<void> {
      while (next < total) {
        const s = next++;
        await scanStore(s);
      }
    }
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(limit, total); i++) workers.push(worker());
    await Promise.all(workers);
  }

  await scanConcurrent(storeAddresses.length, CONCURRENCY);

  const uniqueLabels = Array.from(labelSet);
  dlog(`All: ${uniqueLabels.length} unique labels`);
  if (uniqueLabels.length === 0) return [];

  // Step 3: Batch metadata + attestation count via Multicall3
  const CALLS_PER_LABEL = 4;
  const metadataCalls: MulticallTarget[] = [];
  for (const label of uniqueLabels) {
    const node = namehash(`${label}.dot`);
    const subject = nodeToSubject(node);
    metadataCalls.push(
      { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeContenthash(node) },
      { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeText(node, "name") },
      { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeText(node, "description") },
      { target: CONTRACTS.ATTESTATION_REGISTRY, callData: encodeAttestCount(subject) },
    );
  }
  dlog(`All: Multicall — ${metadataCalls.length} calls`);
  const metadataResults = await multicall(metadataCalls);

  // Step 4: Assemble AppEntry[]
  const apps: AppEntry[] = [];
  for (let i = 0; i < uniqueLabels.length; i++) {
    const label = uniqueLabels[i];
    const base = i * CALLS_PER_LABEL;
    const chResult = metadataResults[base];
    const nameResult = metadataResults[base + 1];
    const descResult = metadataResults[base + 2];
    const countResult = metadataResults[base + 3];

    let contentHash: string | null = null;
    if (chResult?.success) {
      try {
        const raw = decodeBytes(chResult.returnData);
        contentHash = decodeIpfsContenthash(raw);
      } catch { /* no content hash */ }
    }

    let name: string | null = null;
    if (nameResult?.success) {
      try {
        const n = decodeString(nameResult.returnData);
        if (n) name = n;
      } catch { /* no name */ }
    }

    let description = "";
    if (descResult?.success) {
      try {
        description = decodeString(descResult.returnData);
      } catch { /* no description */ }
    }

    let vouchCount: number | null = null;
    if (countResult?.success) {
      try {
        const decoded = decodeUint64(countResult.returnData);
        if (decoded !== null) vouchCount = decoded;
      } catch { /* no attestation data */ }
    }

    apps.push({
      label,
      name,
      description: description || "No description",
      contentHash,
      isLive: contentHash !== null,
      vouchCount,
      source: "all" as const,
    });
  }

  return sortApps(apps);
}

// ── Mock data (fallback for dev mode / when not inside host) ──

const MOCK_PCF_APPS: AppEntry[] = [
  { label: "explore", name: "Explore", description: "Discover apps and curated collections on Polkadot", contentHash: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", isLive: true, vouchCount: 15, source: "pcf" },
  { label: "getsome", name: "Get Some", description: "The easiest way to get DOT, USDC & USDT on Polkadot", contentHash: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", isLive: true, vouchCount: 12, source: "pcf" },
  { label: "ohnotes", name: "Notes", description: "Notes that follow you everywhere.", contentHash: "bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenosa7714", isLive: true, vouchCount: 9, source: "pcf" },
  { label: "ignite", name: "Ignite", description: "Create a campaign in minutes. Back projects you believe in. Trustless. Transparent. On-chain.", contentHash: "bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenosa7714", isLive: true, vouchCount: 10, source: "pcf" },
  { label: "market", name: "Market", description: "Buy and sell digital & physical goods", contentHash: "bafybeibml5uieyxa5tufngvg7fgmrkpvp2rmelbbq4wyqkek5buthpholy", isLive: true, vouchCount: 18, source: "pcf" },
];

const MOCK_ALL_APPS: AppEntry[] = [
  { label: "tick3t", name: "Tick3t", description: "Event tickets and attendance credentials", contentHash: "bafkreifjjcie6lyga6nkrphqgnoyse3gkbimrhddsyv2kphmrqixvxsqme", isLive: true, vouchCount: 5, source: "all" },
  { label: "honor", name: null, description: "Reputation and recognition system", contentHash: null, isLive: false, vouchCount: 2, source: "all" },
  { label: "commons", name: "Protocol Commons", description: "Shared building blocks for product teams", contentHash: null, isLive: false, vouchCount: 8, source: "all" },
  { label: "wiki", name: null, description: "Collaborative knowledge base", contentHash: null, isLive: false, vouchCount: 0, source: "all" },
  { label: "bridge", name: "Bridge", description: "Move assets between networks", contentHash: "bafybeifx7yeb5glcjhclhmrvdckg6gaoqjfqnp7z3feqacfsocsc3w4ymu", isLive: true, vouchCount: 15, source: "all" },
  { label: "governance", name: "Governance", description: "Vote on proposals and shape the network", contentHash: "bafkreigu6doh4v7gcpz3kvwyyifkl5ufma5n52zah6afxijkahvje4a6zy", isLive: true, vouchCount: 31, source: "all" },
  { label: "nfts", name: null, description: "Create and collect digital items", contentHash: null, isLive: false, vouchCount: 1, source: "all" },
];

// ── Public API ──────────────────────────────────────────────

export function isHosted(): boolean {
  const isIframe = window !== window.top;
  const isWebview = (window as unknown as Record<string, unknown>)["__HOST_WEBVIEW_MARK__"] === true;
  return isIframe || isWebview;
}

export type GetAppsResult =
  | { status: "ok"; apps: AppEntry[] }
  | { status: "error"; message: string }
  | { status: "mock"; apps: AppEntry[] };

/**
 * Fetch PCF products from the Store contract (or mock fallback).
 * Fast — single contract call.
 */
export async function getPcfApps(): Promise<GetAppsResult> {
  const hosted = isHosted();
  if (!hosted) {
    return { status: "mock", apps: MOCK_PCF_APPS };
  }
  try {
    const apps = await fetchPcfApps();
    return { status: "ok", apps };
  } catch (err) {
    dlog(`PCF fetch failed: ${err}`, "error");
    return { status: "mock", apps: MOCK_PCF_APPS };
  }
}

/**
 * Fetch all DotNS apps from StoreFactory + ContentResolver + AttestationRegistry.
 * Slower — scans all stores, then multicall for metadata.
 */
export async function getAllApps(): Promise<GetAppsResult> {
  const hosted = isHosted();
  if (!hosted) {
    return { status: "mock", apps: MOCK_ALL_APPS };
  }
  try {
    const apps = await fetchAllApps();
    return { status: "ok", apps };
  } catch (err) {
    dlog(`All fetch failed: ${err}`, "error");
    return { status: "mock", apps: MOCK_ALL_APPS };
  }
}

export function filterApps(
  apps: AppEntry[],
  query: string,
  mode: FilterMode = "pcf",
): AppEntry[] {
  let filtered = apps.filter((app) => app.source === mode);

  const q = query.toLowerCase().trim();
  if (q) {
    filtered = filtered.filter(
      (app) =>
        app.label.toLowerCase().includes(q) ||
        (app.name?.toLowerCase().includes(q) ?? false) ||
        app.description.toLowerCase().includes(q),
    );
  }

  return filtered.sort((a, b) => displayName(a).localeCompare(displayName(b)));
}

// ── Vouch (write path) ──────────────────────────────────────

export type VouchResult =
  | { status: "ok"; blockHash: string }
  | { status: "no-wallet"; message: string }
  | { status: "error"; message: string };

/**
 * Submit an on-chain vouch (attestation) for a product.
 * Uses the host wallet from product-sdk.
 * Writes a thumbs-up (rating=5, rated=false) attestation via AttestationRegistry.
 */
export async function vouchForApp(label: string): Promise<VouchResult> {
  dlog(`Vouching for ${label}.dot`);

  const account = await getWalletAccount();
  if (!account) {
    return { status: "no-wallet", message: "Connect your wallet to vouch" };
  }

  try {
    const node = namehash(`${label}.dot`);
    const subject = nodeToSubject(node);
    const value = encodeRatingValue(5, false); // thumbs-up, not explicitly rated
    const calldata = encodeAttest(subject, SCHEMA_RATING, value, 0n);

    const blockHash = await reviveSubmit(
      CONTRACTS.ATTESTATION_REGISTRY,
      calldata,
      account,
    );

    dlog(`Vouch for ${label}.dot included in block ${blockHash}`);
    return { status: "ok", blockHash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dlog(`Vouch failed: ${msg}`, "error");
    return { status: "error", message: msg };
  }
}

/**
 * Revoke an on-chain vouch for a product.
 */
export async function unvouchForApp(label: string): Promise<VouchResult> {
  dlog(`Revoking vouch for ${label}.dot`);

  const account = await getWalletAccount();
  if (!account) {
    return { status: "no-wallet", message: "Connect your wallet to unvouch" };
  }

  try {
    const node = namehash(`${label}.dot`);
    const subject = nodeToSubject(node);
    const calldata = encodeRevoke(subject, SCHEMA_RATING);

    const blockHash = await reviveSubmit(
      CONTRACTS.ATTESTATION_REGISTRY,
      calldata,
      account,
    );

    dlog(`Revoke for ${label}.dot included in block ${blockHash}`);
    return { status: "ok", blockHash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dlog(`Revoke failed: ${msg}`, "error");
    return { status: "error", message: msg };
  }
}

/** Get the connected wallet display name, or null if not connected. */
export async function getWalletName(): Promise<string | null> {
  const account = await getWalletAccount();
  return account?.name ?? null;
}

// ── Attestation detail queries ──────────────────────────────

export interface AttestationDetail {
  attester: string;
  timestamp: number;
  rating: number;
  explicitlyRated: boolean;
  revoked: boolean;
}

export type FetchAttestationsResult =
  | { status: "ok"; attestations: AttestationDetail[]; total: number }
  | { status: "empty" }
  | { status: "error"; message: string };

const MOCK_ATTESTATIONS: Record<string, AttestationDetail[]> = {
  getsome: [
    { attester: "0xabcdef1234567890abcdef1234567890abcdef12", timestamp: 1748000000, rating: 5, explicitlyRated: false, revoked: false },
    { attester: "0x1111111111111111111111111111111111111111", timestamp: 1747900000, rating: 4, explicitlyRated: true, revoked: false },
    { attester: "0x2222222222222222222222222222222222222222", timestamp: 1747800000, rating: 5, explicitlyRated: true, revoked: false },
  ],
  dotli: [
    { attester: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", timestamp: 1748100000, rating: 5, explicitlyRated: false, revoked: false },
  ],
};

/**
 * Fetch all attestations for a product.
 * Step 1: list(subject, 0, maxPage) → AttestationKey[]
 * Step 2: getBatch(keys) → Attestation[]
 */
export async function fetchAttestations(
  label: string,
  maxPage = 200,
): Promise<FetchAttestationsResult> {
  const hosted = isHosted();
  if (!hosted) {
    const mock = MOCK_ATTESTATIONS[label];
    if (!mock || mock.length === 0) return { status: "empty" };
    return { status: "ok", attestations: mock, total: mock.length };
  }
  if (apiInstance === null) return { status: "empty" };

  try {
    const node = namehash(`${label}.dot`);
    const subject = nodeToSubject(node);

    // Step 1: list all attestation keys for this subject
    const listData = await reviveCall(
      CONTRACTS.ATTESTATION_REGISTRY,
      encodeAttestList(subject, 0, maxPage),
    );
    const keys = decodeAttestationKeyArray(listData);
    dlog(`fetchAttestations(${label}): ${keys.length} keys`);

    if (keys.length === 0) return { status: "empty" };

    // Step 2: getBatch to fetch full attestation data
    const batchData = await reviveCall(
      CONTRACTS.ATTESTATION_REGISTRY,
      encodeAttestGetBatch(keys),
    );
    const attestations = decodeAttestationArray(batchData);

    // Decode rating values and filter
    const details: AttestationDetail[] = attestations
      .filter((a) => !a.revoked)
      .map((a) => {
        const rv = decodeRatingValue(a.value);
        return {
          attester: a.attester,
          timestamp: a.timestamp,
          rating: rv.rating,
          explicitlyRated: rv.explicitlyRated,
          revoked: false,
        };
      });

    return { status: "ok", attestations: details, total: keys.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dlog(`fetchAttestations failed: ${msg}`, "error");
    return { status: "error", message: msg };
  }
}

/**
 * Check whether the current wallet has vouched for this product.
 * Returns null if no wallet is connected.
 */
export async function checkUserVouch(label: string): Promise<boolean | null> {
  const hosted = isHosted();
  if (!hosted || apiInstance === null) return null;

  const account = await getWalletAccount();
  if (!account) return null;

  try {
    const node = namehash(`${label}.dot`);
    const subject = nodeToSubject(node);

    // Derive EVM address: Revive maps Substrate pubkey → low 20 bytes (H160 = pubkey[12..32])
    if (account.publicKey.length !== 32) {
      dlog(`checkUserVouch: unexpected pubkey length ${account.publicKey.length}, expected 32`, "warn");
      return null;
    }
    const evmBytes = account.publicKey.slice(12);
    const evmAddress = `0x${Array.from(evmBytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;

    const data = await reviveCall(
      CONTRACTS.ATTESTATION_REGISTRY,
      encodeIsValid(subject, SCHEMA_RATING, evmAddress),
    );
    return decodeBool(data);
  } catch (err) {
    dlog(`checkUserVouch failed: ${err}`, "warn");
    return null;
  }
}
