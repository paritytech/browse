import { CONTRACTS } from "./config";
import {
  namehash,
  encodeGetAllDeployedStores,
  encodeGetValues,
  encodeContenthash,
  encodeText,
  decodeAddressArray,
  decodeStringArray,
  decodeBytes,
  decodeString,
  decodeIpfsContenthash,
  type MulticallTarget,
} from "./abi";
import { reviveCall } from "./chain";
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
}

export type FilterMode = "all" | "curated" | "attendee" | "popular";

/** Display name: manifest name if available, otherwise "label.dot" */
export function displayName(app: AppEntry): string {
  return app.name ?? `${app.label}.dot`;
}

// ── Real chain queries ──────────────────────────────────────

/** Callback invoked as labels are discovered (before metadata). */
export type OnLabelsFound = (apps: AppEntry[]) => void;

function sortApps(apps: AppEntry[]): AppEntry[] {
  return apps.slice().sort((a, b) => {
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
  const CONCURRENCY = 12;
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

  // Step 3: Batch metadata queries — 3 calls per label via Multicall3
  //   Multicall3 works for ContentResolver (unlike Store.getValues()).
  const metadataCalls: MulticallTarget[] = [];
  for (const label of uniqueLabels) {
    const node = namehash(`${label}.dot`);
    metadataCalls.push(
      { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeContenthash(node) },
      { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeText(node, "name") },
      { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeText(node, "description") },
    );
  }
  dlog(`Step 3: Multicall metadata — ${metadataCalls.length} calls (${uniqueLabels.length} domains x 3)`);
  const metadataResults = await multicall(metadataCalls);
  dlog(`Got ${metadataResults.length} metadata results`);

  // Step 4: Assemble AppEntry[] from results
  const apps: AppEntry[] = [];
  for (let i = 0; i < uniqueLabels.length; i++) {
    const label = uniqueLabels[i];
    const base = i * 3;
    const chResult = metadataResults[base];
    const nameResult = metadataResults[base + 1];
    const descResult = metadataResults[base + 2];

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

    apps.push({
      label,
      name,
      description: description || "No description",
      contentHash,
      isLive: contentHash !== null,
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
  },
  {
    label: "vox",
    name: "Vox",
    description: "Video and audio calls on Polkadot",
    contentHash: "bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenosa7714",
    isLive: true,
  },
  {
    label: "dotli",
    name: "dot.li",
    description: "Open any .dot site directly in your browser",
    contentHash: "bafybeibml5uieyxa5tufngvg7fgmrkpvp2rmelbbq4wyqkek5buthpholy",
    isLive: true,
  },
  {
    label: "tick3t",
    name: "Tick3t",
    description: "Event tickets and attendance credentials",
    contentHash: "bafkreifjjcie6lyga6nkrphqgnoyse3gkbimrhddsyv2kphmrqixvxsqme",
    isLive: true,
  },
  {
    label: "honor",
    name: null,
    description: "Reputation and recognition system",
    contentHash: null,
    isLive: false,
  },
  {
    label: "commons",
    name: "Protocol Commons",
    description: "Shared building blocks for product teams",
    contentHash: null,
    isLive: false,
  },
  {
    label: "wiki",
    name: null,
    description: "Collaborative knowledge base",
    contentHash: null,
    isLive: false,
  },
  {
    label: "bridge",
    name: "Bridge",
    description: "Move assets between networks",
    contentHash: "bafybeifx7yeb5glcjhclhmrvdckg6gaoqjfqnp7z3feqacfsocsc3w4ymu",
    isLive: true,
  },
  {
    label: "governance",
    name: "Governance",
    description: "Vote on proposals and shape the network",
    contentHash: "bafkreigu6doh4v7gcpz3kvwyyifkl5ufma5n52zah6afxijkahvje4a6zy",
    isLive: true,
  },
  {
    label: "nfts",
    name: null,
    description: "Create and collect digital items",
    contentHash: null,
    isLive: false,
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

export function filterApps(apps: AppEntry[], query: string): AppEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return apps;
  return apps.filter(
    (app) =>
      app.label.toLowerCase().includes(q) ||
      (app.name?.toLowerCase().includes(q) ?? false) ||
      app.description.toLowerCase().includes(q)
  );
}
