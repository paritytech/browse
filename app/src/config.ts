// Contract addresses on Asset Hub Paseo testnet
export const CONTRACTS = {
  MULTICALL3: "0x0C206218c5949c00e51825364a7C3A17d9909ef6",
  STORE_FACTORY: "0x030296782F4d3046B080BcB017f01837561D9702",
  CONTENT_RESOLVER: "0x7756DF72CBc7f062e7403cD59e45fBc78bed1cD7",
  REGISTRY: "0x4Da0d37aBe96C06ab19963F31ca2DC0412057a6f",
  ATTESTATION_REGISTRY: "0x4d018C530E01BbC98b042a18A4D4090658BCd8f3",
} as const;

// ── Attestation schemas ──────────────────────────────────────
// Precomputed keccak256 hashes of human-readable schema strings.
// keccak256("discovery.rating.v1")
export const SCHEMA_RATING =
  "0x07ebbff6960c1c29233bf2c1109eca1140dd09425365d4acfd62026181add4d3" as `0x${string}`;

export const ASSET_HUB_PASEO_GENESIS =
  "0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2";

// ReviveApi.call dry-run parameters — max u64 (matches dotli production config)
export const DRY_RUN_WEIGHT_LIMIT = {
  ref_time: 18_446_744_073_709_551_615n,
  proof_size: 18_446_744_073_709_551_615n,
};
export const DRY_RUN_STORAGE_LIMIT = 18_446_744_073_709_551_615n;

// Alice — dummy origin for read-only dry-run calls
export const DUMMY_ORIGIN =
  "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

export const MULTICALL_CHUNK_SIZE = 30;
