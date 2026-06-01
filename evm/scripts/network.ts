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
  "0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f": {
    rpcEndpoints: ["wss://paseo-asset-hub-next-rpc.polkadot.io"],
    dotnsRegistrar: "0xf7Ad3F44F316C73E4a2b46b1ed48d376bCc9E639",
  },
  // Previewnet Asset Hub
  "0x29f7b15e6227f86b90bf5199b5c872c28649a30e5f15fae6dd8fa9d5d48d6fbb": {
    rpcEndpoints: ["wss://previewnet.substrate.dev/asset-hub"],
    dotnsRegistrar: "0x061273AeF34e8ab9Ca08E199d7440E2639Fc2088",
  },
};
