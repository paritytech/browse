import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@parity/hardhat-polkadot";

const PRIVATE_KEY = process.env.PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    polkadotHubTestnet: {
      polkadot: {
        target: "evm",
      },
      url: "https://eth-rpc-testnet.polkadot.io",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },

  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache_hh",
    artifacts: "./artifacts",
  },
};

export default config;
