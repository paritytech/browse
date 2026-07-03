#!/usr/bin/env bun

/**
 * One-command deployment.
 */

import { execSync } from "node:child_process";

import chalk from "chalk";
import ora, { type Ora } from "ora";

import { isKnownGenesis, selectNetwork } from "@parity/browse-sdk";

const ZERO = "0x0000000000000000000000000000000000000000";

// Defaults to Paseo Asset Hub Next v2, matching the app's default network.
const NETWORK_GENESIS_HASH =
  process.env.NETWORK_GENESIS_HASH ??
  "0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f";

// The SS58 address allowed to issue certificates. Optional: when unset, deploy-trusted-resolver
// defaults to the deployer account and derives the EVM address the resolver gates on.
const TRUSTED_ATTESTER_SS58_ADDRESS = process.env.TRUSTED_ATTESTER_SS58_ADDRESS ?? "";

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
function sh(cmd: string, env: Record<string, string> = {}): void {
  execSync(cmd, { stdio: "pipe", env: { ...process.env, ...env } });
}

/** Shell out, streaming the command's output straight to the terminal. */
function shInherit(cmd: string, env: Record<string, string> = {}): void {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
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
  stage(`Asset Hub ${chalk.dim(net.rpcs[0])}`, () => {});
  stage(`Bulletin ${chalk.dim(net.IPFS_GATEWAY)}`, () => {});

  // Dependency contracts. Each must be deployed (non-zero) before browse can deploy.
  const deps = {
    // DotNS
    DotnsRegistrar: net.REGISTRAR,
    DotnsRegistry: net.REGISTRY,
    DotnsContentResolver: net.CONTENT_RESOLVER,
    StoreFactory: net.STORE_FACTORY,
    Multicall3: net.MULTICALL3,
    // Attestation Protocol
    SchemaRegistry: net.SCHEMA_REGISTRY,
    AttestationService: net.ATTESTATION_SERVICE,
  };
  for (const [name, addr] of Object.entries(deps)) {
    stage(`${name} ${chalk.dim(addr)}`, () => {
      if (!addr || addr === ZERO) throw new Error("not configured");
    });
  }

  // Browse Services. Idempotent: skip contracts already in the config.
  if (net.PUBLISHER === ZERO) {
    stage("Deploy Publisher.sol", () =>
      sh("cd evm && npm run deploy:publisher", {
        NETWORK_GENESIS_HASH,
      }),
    );
  } else {
    skip("Deploy Publisher.sol", `already at ${net.PUBLISHER}`);
  }

  if (net.ATTESTATION_INDEX_RESOLVER === ZERO) {
    stage("Deploy RecipientAndAttesterIndexResolver.sol", () =>
      sh("cd evm && npm run deploy:resolver", { NETWORK_GENESIS_HASH }),
    );
  } else {
    skip(
      "Deploy RecipientAndAttesterIndexResolver.sol",
      `already at ${net.ATTESTATION_INDEX_RESOLVER}`,
    );
  }

  if (net.TRUSTED_ATTESTER_RESOLVER === ZERO) {
    stage("Deploy TrustedAttesterIndexResolver.sol", () =>
      sh("cd evm && npm run deploy:trusted-resolver", {
        NETWORK_GENESIS_HASH,
        TRUSTED_ATTESTER_SS58_ADDRESS,
      }),
    );
  } else {
    skip(
      "Deploy TrustedAttesterIndexResolver.sol",
      `already at ${net.TRUSTED_ATTESTER_RESOLVER}`,
    );
  }

  if (net.SCHEMA_ID > 0n) {
    skip(
      "Register attestation schema",
      `already registered at id ${net.SCHEMA_ID}`,
    );
  } else {
    stage("Register attestation schema", () =>
      sh("cd evm && npm run register:schema", {
        NETWORK_GENESIS_HASH,
        SCHEMA: "bool like",
      }),
    );
  }

  if (net.COMPLIANCE_SCHEMA_ID > 0n) {
    skip(
      "Register certificate schema",
      `already registered at id ${net.COMPLIANCE_SCHEMA_ID}`,
    );
  } else {
    stage("Register certificate schema", () =>
      sh("cd evm && npm run register:schema", {
        NETWORK_GENESIS_HASH,
        SCHEMA: "bool compliant,string contentCid",
        UNIQUE: "true",
        RESOLVER: net.TRUSTED_ATTESTER_RESOLVER,
      }),
    );
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
