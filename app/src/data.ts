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

// Mock data — will be replaced with real DotNS queries
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

export function getApps(): Promise<AppEntry[]> {
  // Simulate async fetch — will be replaced with real DotNS multicall queries
  return new Promise((resolve) => {
    setTimeout(() => resolve(MOCK_APPS), 600);
  });
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
