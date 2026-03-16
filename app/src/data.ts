import { CONTRACTS, SCHEMA_RATING } from "./config";
import {
  namehash,
  nodeToSubject,
  encodeGetAllDeployedStores,
  encodeGetValues,
  encodeContenthash,
  encodeText,
  encodeAttestCount,
  encodeAttest,
  encodeRevoke,
  encodeRatingValue,
  decodeAddressArray,
  decodeStringArray,
  decodeBytes,
  decodeString,
  decodeIpfsContenthash,
  decodeUint64,
  type MulticallTarget,
} from "./abi";
import { reviveCall, reviveSubmit, getWalletAccount } from "./chain";
import { multicall } from "./multicall";
import { dlog } from "./debug";

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
}

export type FilterMode = "all" | "curated" | "attendee" | "popular";

/** Display name: manifest name if available, otherwise "label.dot" */
export function displayName(app: AppEntry): string {
  return app.name ?? `${app.label}.dot`;
}

// ── Real chain queries ──────────────────────────────────────

/** Callback invoked as labels are discovered (before metadata). */
export type OnLabelsFound = (apps: AppEntry[]) => void;

function sortApps(apps: AppEntry[], mode: FilterMode = "all"): AppEntry[] {
  return apps.slice().sort((a, b) => {
    // Popular mode: sort by vouch count descending, then name
    if (mode === "popular") {
      const aCount = a.vouchCount ?? 0;
      const bCount = b.vouchCount ?? 0;
      if (aCount !== bCount) return bCount - aCount;
      return displayName(a).localeCompare(displayName(b));
    }
    // Default: live first, then alphabetical
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return displayName(a).localeCompare(displayName(b));
  });
}

async function fetchAppsFromChain(
  onProgress?: OnLabelsFound,
): Promise<AppEntry[]> {
  // Step 1: Get all store addresses from StoreFactory
  dlog("Step 1: StoreFactory.getAllDeployedStores()");
  const storesData = await reviveCall(
    CONTRACTS.STORE_FACTORY,
    encodeGetAllDeployedStores(),
  );
  const storeAddresses = decodeAddressArray(storesData);
  dlog(`Found ${storeAddresses.length} stores`);

  if (storeAddresses.length === 0) {
    dlog("No stores found — chain has no registered domains", "warn");
    return [];
  }

  // Step 2: Concurrent getValues() on each store (bounded to CONCURRENCY slots).
  //   Multicall3 does NOT work for Store.getValues() — Revive nested calls
  //   return empty data. Must call each store directly.
  //   Progressive: emit labels to UI as soon as they're found.
  // Keep concurrency low — smoldot is a Wasm light client running in the browser.
  // Each reviveCall triggers state proof verification on the JS event loop.
  // 12 was causing Firefox "slowing down" warnings; 4 balances throughput vs responsiveness.
  const CONCURRENCY = 4;
  dlog(`Step 2: Scanning ${storeAddresses.length} stores (concurrency=${CONCURRENCY})`);
  const labelSet = new Set<string>();

  /**
   * Scan a single store by index, merging any new labels into labelSet and
   * calling onProgress when new labels are discovered.
   */
  async function scanStore(s: number): Promise<void> {
    try {
      const raw = await reviveCall(
        storeAddresses[s] as `0x${string}`,
        encodeGetValues(),
      );
      const storeLabels = decodeStringArray(raw);
      if (storeLabels.length > 0) {
        const newLabels: string[] = [];
        for (const l of storeLabels) {
          if (!l) continue;
          const normalized = l.endsWith(".dot") ? l.slice(0, -4) : l;
          if (!labelSet.has(normalized)) {
            labelSet.add(normalized);
            newLabels.push(normalized);
          }
        }
        if (newLabels.length > 0) {
          dlog(`  store[${s}]: +${newLabels.length} → [${newLabels.join(", ")}]`);
          // Progressive: send label-only entries to UI immediately.
          if (onProgress) {
            const partial = Array.from(labelSet).map((label) => ({
              label,
              name: null,
              description: "Loading...",
              contentHash: null,
              isLive: false,
              vouchCount: null,
            }));
            onProgress(sortApps(partial));
          }
        }
      }
    } catch {
      dlog(`  store[${s}]: call failed`, "warn");
    }
    if ((s + 1) % 50 === 0) {
      dlog(`  ... scanned ${s + 1}/${storeAddresses.length} stores`);
    }
  }

  /**
   * Bounded concurrent dispatch: keeps up to CONCURRENCY promises in-flight,
   * pulling the next index from the queue as each one settles.
   */
  async function scanConcurrent(total: number, limit: number): Promise<void> {
    let next = 0;

    async function worker(): Promise<void> {
      while (next < total) {
        const s = next++;
        await scanStore(s);
      }
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(limit, total); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }

  await scanConcurrent(storeAddresses.length, CONCURRENCY);

  const uniqueLabels = Array.from(labelSet);
  dlog(`Found ${uniqueLabels.length} unique labels: [${uniqueLabels.join(", ")}]`);
  if (uniqueLabels.length === 0) {
    dlog("No labels found in any store", "warn");
    return [];
  }

  // Step 3: Batch metadata + attestation count queries — 4 calls per label via Multicall3
  //   Multicall3 works for ContentResolver and AttestationRegistry (unlike Store.getValues()).
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
  dlog(`Step 3: Multicall metadata+attestations — ${metadataCalls.length} calls (${uniqueLabels.length} domains x ${CALLS_PER_LABEL})`);
  const metadataResults = await multicall(metadataCalls);
  dlog(`Got ${metadataResults.length} metadata results`);

  if (metadataResults.length !== metadataCalls.length) {
    dlog(`Result count mismatch: expected ${metadataCalls.length}, got ${metadataResults.length}`, "warn");
  }

  // Step 4: Assemble AppEntry[] from results
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
    });
  }

  return sortApps(apps);
}

// ── Mock data (fallback for dev mode / when not inside host) ──

const MOCK_APPS: AppEntry[] = [
  {
    label: "getsome",
    name: "Get Some",
    description: "The easiest way to get DOT, USDC, and USDT on Polkadot",
    contentHash: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    isLive: true,
    vouchCount: 12,
  },
  {
    label: "vox",
    name: "Vox",
    description: "Video and audio calls on Polkadot",
    contentHash: "bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenosa7714",
    isLive: true,
    vouchCount: 7,
  },
  {
    label: "dotli",
    name: "dot.li",
    description: "Open any .dot site directly in your browser",
    contentHash: "bafybeibml5uieyxa5tufngvg7fgmrkpvp2rmelbbq4wyqkek5buthpholy",
    isLive: true,
    vouchCount: 23,
  },
  {
    label: "tick3t",
    name: "Tick3t",
    description: "Event tickets and attendance credentials",
    contentHash: "bafkreifjjcie6lyga6nkrphqgnoyse3gkbimrhddsyv2kphmrqixvxsqme",
    isLive: true,
    vouchCount: 5,
  },
  {
    label: "honor",
    name: null,
    description: "Reputation and recognition system",
    contentHash: null,
    isLive: false,
    vouchCount: 2,
  },
  {
    label: "commons",
    name: "Protocol Commons",
    description: "Shared building blocks for product teams",
    contentHash: null,
    isLive: false,
    vouchCount: 8,
  },
  {
    label: "wiki",
    name: null,
    description: "Collaborative knowledge base",
    contentHash: null,
    isLive: false,
    vouchCount: 0,
  },
  {
    label: "bridge",
    name: "Bridge",
    description: "Move assets between networks",
    contentHash: "bafybeifx7yeb5glcjhclhmrvdckg6gaoqjfqnp7z3feqacfsocsc3w4ymu",
    isLive: true,
    vouchCount: 15,
  },
  {
    label: "governance",
    name: "Governance",
    description: "Vote on proposals and shape the network",
    contentHash: "bafkreigu6doh4v7gcpz3kvwyyifkl5ufma5n52zah6afxijkahvje4a6zy",
    isLive: true,
    vouchCount: 31,
  },
  {
    label: "nfts",
    name: null,
    description: "Create and collect digital items",
    contentHash: null,
    isLive: false,
    vouchCount: 1,
  },
];

// ── Public API ──────────────────────────────────────────────

async function isHosted(): Promise<boolean> {
  try {
    const sdk = await import("@novasamatech/product-sdk");
    return !!sdk.createPapiProvider;
  } catch {
    return false;
  }
}

export type GetAppsResult =
  | { status: "ok"; apps: AppEntry[] }
  | { status: "no-chain"; message: string }
  | { status: "mock"; apps: AppEntry[] };

export async function getApps(
  onProgress?: OnLabelsFound,
): Promise<GetAppsResult> {
  const hosted = await isHosted();

  if (!hosted) {
    dlog("Not in host — using mock data");
    return { status: "mock", apps: MOCK_APPS };
  }

  dlog("Running inside host — querying chain");
  try {
    const apps = await fetchAppsFromChain(onProgress);
    dlog(`Done — ${apps.length} apps loaded`);
    return { status: "ok", apps };
  } catch (err) {
    const msg = String(err);
    dlog(`Chain query failed: ${msg}`, "error");
    if (msg.includes("product environment")) {
      return { status: "no-chain", message: "Chain access not yet available in this host" };
    }
    return { status: "no-chain", message: msg };
  }
}

export function filterApps(
  apps: AppEntry[],
  query: string,
  mode: FilterMode = "all",
): AppEntry[] {
  let filtered = apps;

  const q = query.toLowerCase().trim();
  if (q) {
    filtered = filtered.filter(
      (app) =>
        app.label.toLowerCase().includes(q) ||
        (app.name?.toLowerCase().includes(q) ?? false) ||
        app.description.toLowerCase().includes(q),
    );
  }

  // Re-sort by mode (popular sorts by vouch count)
  if (mode === "popular") {
    filtered = sortApps(filtered, "popular");
  }

  return filtered;
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
