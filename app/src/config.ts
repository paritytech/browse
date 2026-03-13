// Contract addresses on Asset Hub Paseo testnet
export const CONTRACTS = {
  MULTICALL3: "0x0C206218c5949c00e51825364a7C3A17d9909ef6",
  STORE_FACTORY: "0x030296782F4d3046B080BcB017f01837561D9702",
  CONTENT_RESOLVER: "0x7756DF72CBc7f062e7403cD59e45fBc78bed1cD7",
  REGISTRY: "0x4Da0d37aBe96C06ab19963F31ca2DC0412057a6f",
} as const;

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
