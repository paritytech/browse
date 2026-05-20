/**
 * Network configuration registry keyed by chain genesis hash.
 */

export type NetworkConfig = {
  rpcEndpoints: string[];
  dotnsRegistrar: `0x${string}`;
};

export const GenesisHashToNetworkConfig: Record<string, NetworkConfig> = {
  // Paseo Asset Hub V1
  "0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2": {
    rpcEndpoints: [
      "wss://sys.ibp.network/asset-hub-paseo",
      "wss://asset-hub-paseo.dotters.network",
      "wss://asset-hub-paseo-rpc.dwellir.com",
      "wss://paseo-asset-hub-rpc.polkadot.io",
    ],
    dotnsRegistrar: "0xeD3BC8Abae983b0A22ff6881a9Aa1B83E5Ed3146",
  },
  // Paseo Asset Hub Next V2
  "0x173cea9df45656cf612c8b8ece56e04e9a693c69cfaac47d3628dae735067af8": {
    rpcEndpoints: ["wss://paseo-asset-hub-next-rpc.polkadot.io"],
    dotnsRegistrar: "0x885b8085bA92A31c4ef52076f77379E647ECC399",
  },
  // Previewnet Asset Hub
  "0x7765f98d559faf44baff547e8876a47c64cd1161f239d7df5a9e26194617f775": {
    rpcEndpoints: ["wss://previewnet-asset-hub-rpc.polkadot.io"],
    dotnsRegistrar: "0x6c40817cdb96Ab57A4d9E9fa21D0eEa8307BDDE8",
  },
};
