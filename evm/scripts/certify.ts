/**
 * Certify apps with the repo certificate on one network, one attestation each.
 *
 * The trusted attester the resolver checks is the root key of the public Substrate
 * dev phrase, so that phrase is the default when `MNEMONIC` is unset. The badge
 * and description CIDs come from the files in `certificates/`, which
 * `upload-certificate-content.ts` stores on Bulletin. Run it again after a chain
 * reset wipes the certificates.
 *
 *   NETWORK_GENESIS_HASH=<genesis> npm run -s certify -- calculator stopwatch
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { DEV_PHRASE } from "@polkadot-labs/hdkd-helpers";

import { CERTIFICATE_NAME, certificateCids } from "./certificate-cids.ts";

const apps = process.argv.slice(2);
if (apps.length === 0) {
  console.error("Usage: certify <app> [app...]");
  process.exit(1);
}

const { contentCid, badgeIconCid } = certificateCids();
const attestScript = fileURLToPath(
  new URL("./attest-compliance.ts", import.meta.url),
);
const tsconfig = fileURLToPath(new URL("./tsconfig.json", import.meta.url));

let failures = 0;
for (const app of apps) {
  const result = spawnSync(
    "npx",
    [
      "tsx",
      "--tsconfig",
      tsconfig,
      attestScript,
      app,
      contentCid,
      badgeIconCid,
      CERTIFICATE_NAME,
    ],
    {
      env: { ...process.env, MNEMONIC: process.env.MNEMONIC ?? DEV_PHRASE },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) failures++;
}
process.exit(failures === 0 ? 0 : 1);
