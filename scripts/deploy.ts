#!/usr/bin/env bun

/**
 * One-command deployment.
 *
 * Every stage asks the chain what is there before acting, so the command is
 * idempotent: on a healthy network it only confirms, after a chain reset it
 * puts back what is missing. Browse contracts land on CREATE3 addresses that
 * do not depend on who deploys, and the constructor inputs below are pinned,
 * so any funded account produces the same stack.
 *
 * `--contracts-only` stops before the client build and publish; the e2e suite
 * runs it that way in its global setup.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import chalk from "chalk";
import ora, { type Ora } from "ora";

import { isKnownGenesis, selectNetwork } from "@parity/browse-sdk";

const CONTRACTS_ONLY = process.argv.includes("--contracts-only");

// Defaults to Paseo Asset Hub Next v2, matching the app's default network.
const NETWORK_GENESIS_HASH =
  process.env.NETWORK_GENESIS_HASH ??
  "0x4349b00e54897e21196fd331015fc5be0f14e118beb0375ed2bb1793737bb57a";

// The substrate dev phrase root, 5DfhGy…, and its EVM address. It deployed the
// existing stacks, owns the Publisher and issues certificates, and stays so
// whoever signs a redeploy.
const DEV_ROOT_SS58 = "5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV";
const DEV_ROOT_EVM = "0x35Cdb23fF7fc86E8DCcd577CA309bFEA9c978D20";
const PUBLISHER_OWNER = process.env.PUBLISHER_OWNER ?? DEV_ROOT_EVM;
const TRUSTED_ATTESTER_SS58_ADDRESS =
  process.env.TRUSTED_ATTESTER_SS58_ADDRESS ?? DEV_ROOT_SS58;

const LIKE_SCHEMA = "string label";
const COMPLIANCE_SCHEMA =
  "bool compliant,string contentCid,string badgeIconCid,string name";

interface SchemaState {
  id: string;
  registered: boolean;
  schema: string | null;
}
interface NetworkState {
  contracts: Record<string, { address: string; codeBytes: number }>;
  schemaCount: string | null;
  schemas: { like: SchemaState; compliance: SchemaState };
}

/** Run a stage under a spinner. On failure, print captured output and exit. */
function stage(label: string, fn: (spinner: Ora) => void): void {
  const spinner = ora(label).start();
  try {
    fn(spinner);
    spinner.succeed();
  } catch (err) {
    spinner.fail(`${label} — ${(err as Error).message}`);
    const e = err as { stdout?: unknown; stderr?: unknown };
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
    if (out) console.error("\n" + out);
    process.exit(1);
  }
}

/** Persist a skipped-stage line without spinning. */
function skip(label: string, reason: string): void {
  ora(label)
    .start()
    .stopAndPersist({
      symbol: chalk.green("✔"),
      text: `${label} ${chalk.dim(reason)}`,
    });
}

/** Shell out, capturing output so the spinner owns the line; output shows on failure. */
function sh(cmd: string, env: Record<string, string> = {}): string {
  return execSync(cmd, {
    stdio: "pipe",
    env: { ...process.env, ...env },
  }).toString();
}

/** Shell out, streaming the command's output straight to the terminal. */
function shInherit(cmd: string, env: Record<string, string> = {}): void {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

/** One chain read for the whole stack; see evm/scripts/probe-state.ts. */
function probe(): NetworkState {
  const out = sh("cd evm && npm run -s probe:state", { NETWORK_GENESIS_HASH });
  return JSON.parse(out.trim().split("\n").pop() ?? "{}") as NetworkState;
}

/**
 * The version in a contract's recorded CREATE3 salt on this network, from
 * evm/deployments.json. The salt is what fixes the address, so a redeploy
 * after a chain reset must reuse it rather than the version the source
 * declares today; a deliberately new version is a new record, and a new
 * config entry, not a wipe recovery.
 */
function recordedVersion(record: string): string {
  const records = JSON.parse(
    readFileSync("evm/deployments.json", "utf8"),
  ) as Record<string, Record<string, { genesisHash?: string; salt?: string }>>;
  const entry = Object.values(records[record] ?? {}).find(
    (e) => e && typeof e === "object" && e.genesisHash === NETWORK_GENESIS_HASH,
  );
  const salt = entry?.salt;
  if (!salt) {
    throw new Error(
      `evm/deployments.json has no ${record} record for ${NETWORK_GENESIS_HASH}, so there is no salt to redeploy under`,
    );
  }
  return salt.slice(salt.lastIndexOf(":") + 1);
}

/**
 * The committed build a record names, when the deployment must not follow
 * src/. The identity-bound index resolver is one: the app still calls
 * bindIdentity, which the personhood-gated rewrite of the source dropped.
 */
function recordedArtifact(record: string): Record<string, string> {
  const records = JSON.parse(
    readFileSync("evm/deployments.json", "utf8"),
  ) as Record<
    string,
    Record<string, { genesisHash?: string; artifact?: string }>
  >;
  const entry = Object.values(records[record] ?? {}).find(
    (e) => e && typeof e === "object" && e.genesisHash === NETWORK_GENESIS_HASH,
  );
  return entry?.artifact ? { ARTIFACT: entry.artifact } : {};
}

/** A dependency stage: fails when the contract is not on chain. */
function requireCode(state: NetworkState, name: string, hint: string): void {
  const { address, codeBytes } = state.contracts[name]!;
  stage(`${name} ${chalk.dim(address)}`, () => {
    if (codeBytes === 0) throw new Error(`no code at ${address}; ${hint}`);
  });
}

/** A Browse contract stage: deploys under its recorded salt when nothing is at the address. */
function ensureContract(
  state: NetworkState,
  name: string,
  record: string,
  npmScript: string,
  env: Record<string, string> = {},
): void {
  const { address, codeBytes } = state.contracts[name]!;
  const label = `Deploy ${name}.sol`;
  if (codeBytes > 0) {
    skip(label, `already at ${address}`);
    return;
  }
  stage(label, () =>
    sh(`cd evm && npm run ${npmScript}`, {
      NETWORK_GENESIS_HASH,
      VERSION: recordedVersion(record),
      ...recordedArtifact(record),
      ...env,
    }),
  );
}

/**
 * A schema stage. Ids are assigned by registration order on the shared
 * registry, so a schema is only registered while its expected id is the next
 * one; an id already taken by something else needs a config change, not a
 * deploy.
 */
function ensureSchema(
  state: NetworkState,
  label: string,
  expected: SchemaState,
  schema: string,
  env: Record<string, string> = {},
): void {
  if (expected.registered) {
    if (expected.schema !== schema) {
      stage(label, () => {
        throw new Error(
          `schema id ${expected.id} holds "${expected.schema}", not "${schema}"`,
        );
      });
    }
    skip(label, `already registered at id ${expected.id}`);
    return;
  }
  const next = BigInt(state.schemaCount ?? "0") + 1n;
  if (next !== BigInt(expected.id)) {
    stage(label, () => {
      throw new Error(
        `the registry would assign id ${next}, the config expects ${expected.id}`,
      );
    });
  }
  stage(label, () =>
    sh("cd evm && npm run register:schema", {
      NETWORK_GENESIS_HASH,
      SCHEMA: schema,
      ...env,
    }),
  );
}

function main(): void {
  // Network services. The genesis must be a configured network.
  if (!isKnownGenesis(NETWORK_GENESIS_HASH)) {
    ora(`Unknown NETWORK_GENESIS_HASH ${NETWORK_GENESIS_HASH}`).start().fail();
    console.error(chalk.dim("  Add it to packages/browse-sdk/src/config.ts."));
    process.exit(1);
  }
  const net = selectNetwork(NETWORK_GENESIS_HASH);
  console.log(`\n${chalk.dim("Deploying")} ${chalk.bold("browse")}\n`);

  // Chains the deploy depends on.
  stage(`Asset Hub ${chalk.dim(net.ASSETHUB_RPCS[0])}`, () => {});
  stage(`Bulletin ${chalk.dim(net.IPFS_GATEWAY)}`, () => {});

  let state!: NetworkState;
  stage("Read the stack from the chain", () => {
    state = probe();
  });

  // Dependency contracts, deployed from other repositories.
  const dotns = "deploy dotNS on this network first";
  requireCode(state, "DotnsRegistrar", dotns);
  requireCode(state, "DotnsRegistry", dotns);
  requireCode(state, "DotnsContentResolver", dotns);
  requireCode(state, "StoreFactory", dotns);
  requireCode(state, "Multicall3", dotns);
  const attestation =
    "run the Deploy workflow of paritytech/attestation-protocol on this network first";
  requireCode(state, "SchemaRegistry", attestation);
  requireCode(state, "AttestationService", attestation);

  // Browse services, on the CREATE3 addresses the config already names.
  ensureContract(state, "Publisher", "publisher", "deploy:publisher", {
    PUBLISHER_OWNER,
  });
  ensureContract(
    state,
    "RecipientAndAttesterIndexResolver",
    "recipientAndAttesterIndexResolver",
    "deploy:resolver",
  );
  ensureContract(
    state,
    "TrustedAttesterIndexResolver",
    "trustedAttesterIndexResolver",
    "deploy:trusted-resolver",
    { TRUSTED_ATTESTER_SS58_ADDRESS },
  );

  // Schemas, in id order.
  ensureSchema(
    state,
    "Register attestation schema",
    state.schemas.like,
    LIKE_SCHEMA,
  );
  // The first registration moves the next id along, so read again.
  stage("Re-read the registry", () => {
    state = probe();
  });
  ensureSchema(
    state,
    "Register certificate schema",
    state.schemas.compliance,
    COMPLIANCE_SCHEMA,
    { UNIQUE: "true", RESOLVER: net.TRUSTED_ATTESTER_RESOLVER },
  );

  if (CONTRACTS_ONLY) {
    ora(chalk.green("Contracts in place")).succeed();
    return;
  }

  // Browse Client. Build for the target network, then publish app and widget.
  stage("Deploy client", (spinner) => {
    sh("make -C app build", { NETWORK_GENESIS_HASH });
    // Release the spinner line so bulletin-deploy's output streams through.
    spinner.stop();
    shInherit("make -C app deploy");
  });
  ora(chalk.green("Completed")).succeed();
}

main();
