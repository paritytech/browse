/**
 * Deterministic deploys through the CREATE3 factory in the network config.
 *
 * A CREATE3 address is a pure function of the factory address and the salt, so a
 * contract lands on the same address on every network and comes back on the same
 * address after a chain reset. Bytecode stays out of the derivation, so a
 * recompile or a different constructor argument does not move an address.
 *
 * The salt carries the contract name and its semver, so a new version is a new
 * address by construction. The old deployment keeps serving reads, which is what
 * the versioned arrays in `packages/browse-sdk/src/config.ts` expect: reads union
 * every version, writes go to the first entry.
 *
 * Deploying twice with one salt is not possible. Rerunning a deploy adopts the
 * contract already sitting at the address instead, so a partial run is safe to
 * repeat.
 */

import * as fs from "node:fs";

import { Binary } from "polkadot-api";
import {
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  keccak256,
  parseAbi,
} from "viem";

import type { NetworkConfig } from "@parity/browse-sdk/config";

/** Prefix that keeps Browse salts from colliding with the dotNS ones on the shared factory. */
export const SALT_NAMESPACE = "browse.create3.v1";

/**
 * Init code of the Solady CREATE3 proxy.
 *
 * The factory CREATE2s this proxy from the salt, then the proxy CREATEs the
 * contract as its first transaction. Both steps are reproduced by
 * {@link predictCreate3}, so an address is known before any network round trip.
 */
const PROXY_INIT_CODE = "0x67363d3d37363d34f03d5260086018f3" as const;

const FACTORY_ABI = parseAbi([
  "function deploy(bytes32 salt, bytes initCode) payable returns (address)",
]);

const WEIGHT_LIMIT = {
  ref_time: 500_000_000_000n,
  proof_size: 5_000_000n,
} as const;

/**
 * Ceiling on the deposit the deployed code can cost.
 *
 * Deploying a contract of a few kilobytes costs well under a hundredth of this.
 */
const STORAGE_DEPOSIT_LIMIT = 1_000_000_000_000n;

/** Outcome of a deploy: freshly deployed, adopted from an earlier run, or only predicted. */
export type Create3Status = "deployed" | "adopted" | "dry-run";

/**
 * Factory to deploy through, taken from the network config.
 *
 * `CREATE3_FACTORY` overrides it, which is the way to deploy on a network whose
 * config carries no factory yet.
 */
export function create3Factory(network: NetworkConfig): `0x${string}` {
  const factory = process.env.CREATE3_FACTORY ?? network.CREATE3_FACTORY;
  if (!factory) {
    throw new Error(
      "This network has no CREATE3 factory in the SDK config. Deploy one from the dotns repository, then set CREATE3_FACTORY or add it to packages/browse-sdk/src/config.ts."
    );
  }
  return factory as `0x${string}`;
}

/**
 * Salt for one release of one contract.
 *
 * `create3Salt("Publisher", "2.1.0")` hashes `browse.create3.v1:Publisher:2.1.0`.
 */
export function create3Salt(name: string, version: string): `0x${string}` {
  return keccak256(
    encodePacked(["string"], [`${SALT_NAMESPACE}:${name}:${version}`])
  );
}

/** Address a salt resolves to, derived without touching the network. */
export function predictCreate3(
  salt: `0x${string}`,
  factory: `0x${string}`
): `0x${string}` {
  const proxy = getContractAddress({
    opcode: "CREATE2",
    from: factory,
    salt,
    bytecodeHash: keccak256(PROXY_INIT_CODE),
  });
  return getContractAddress({ opcode: "CREATE", from: proxy, nonce: 1n });
}

/**
 * Version a contract declares through its `Semver(major, minor, patch)` base.
 *
 * Reading it from the source keeps the salt and the version the contract reports
 * to callers in step. `VERSION` overrides it, which is how contracts without a
 * `Semver` base get a version.
 */
export function contractVersion(solidityPath: string): string {
  const override = process.env.VERSION;
  if (override) return override;

  const source = fs.readFileSync(solidityPath, "utf-8");
  const declared = source.match(/Semver\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!declared) {
    throw new Error(
      `${solidityPath} declares no Semver base, so the salt has no version. Set VERSION, for example VERSION=1.0.0.`
    );
  }
  return `${declared[1]}.${declared[2]}.${declared[3]}`;
}

/** Runtime code at an address, `0x` when nothing is deployed there. */
async function codeAt(api: any, address: `0x${string}`): Promise<string> {
  const code = await api.apis.ReviveApi.code(Binary.fromHex(address));
  return typeof code === "string" ? code : code.asHex();
}

/**
 * Submits a transaction and returns the dispatch error it finalised with, if any.
 *
 * Deploys are judged by the code at the address rather than by this result. A
 * factory call has come back `ContractReverted` on a deploy that landed, and the
 * code lags a best-block result, so both readings are taken after finalisation.
 */
async function submit(tx: any, signer: any): Promise<string | null> {
  return new Promise((resolve, reject) => {
    tx.signSubmitAndWatch(signer).subscribe({
      next: (event: any) => {
        console.log(`  ${event.type}`);
        if (event.type !== "finalized") return;
        resolve(event.ok ? null : JSON.stringify(event.dispatchError));
      },
      error: reject,
    });
  });
}

/**
 * Deploys a contract at its deterministic address, or adopts the one already there.
 *
 * `initCode` is the creation bytecode with the ABI-encoded constructor arguments
 * appended. Set `DRY_RUN=true` to print the address the salt resolves to and stop.
 */
export async function deploy(
  api: any,
  signer: any,
  options: {
    name: string;
    version: string;
    initCode: string;
    network: NetworkConfig;
  }
): Promise<{ address: `0x${string}`; status: Create3Status }> {
  const { name, version, initCode, network } = options;
  const factory = create3Factory(network);
  const salt = create3Salt(name, version);
  const address = predictCreate3(salt, factory);

  console.log(`\n${name} ${version}`);
  console.log(`  factory:   ${factory}`);
  console.log(`  salt:      ${salt}`);
  console.log(`  address:   ${address}`);

  if ((await codeAt(api, factory)) === "0x") {
    throw new Error(
      `No CREATE3 factory at ${factory}. Deploy it from the dotns repository, or set CREATE3_FACTORY.`
    );
  }

  if ((await codeAt(api, address)) !== "0x") {
    console.log(`  → already deployed, adopting`);
    return { address, status: "adopted" };
  }

  if (process.env.DRY_RUN === "true") {
    console.log(`  → dry run, nothing deployed`);
    return { address, status: "dry-run" };
  }

  const tx = api.tx.Revive.call({
    dest: Binary.fromHex(factory),
    value: 0n,
    weight_limit: WEIGHT_LIMIT,
    storage_deposit_limit: STORAGE_DEPOSIT_LIMIT,
    data: Binary.fromHex(
      encodeFunctionData({
        abi: FACTORY_ABI,
        functionName: "deploy",
        args: [salt, initCode as `0x${string}`],
      })
    ),
  });

  const dispatchError = await submit(tx, signer);

  if ((await codeAt(api, address)) === "0x") {
    throw new Error(
      `${name} ${version} did not deploy at ${address}. ${dispatchError ?? ""}`
    );
  }
  console.log(`  → deployed`);
  return { address, status: "deployed" };
}
