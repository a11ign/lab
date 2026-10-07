// @ts-check

/**
 * lab's OWN test config: a thin call into `@a11ign/toolchain` (ADR 0043, Decision 3; a11ign/a11ign#3959), the one rstest config every a11ign repository shares. It carries the
 * `node:test` resolve hook and shim, so the repository's tests run on rstest as written. What is lab's is only where the repository is and which files are tests.
 *
 * THIS COVERS `scripts/*.test.ts` ONLY, THE REPOSITORY'S OWN CHECKS (the workflows, the arming filter, the composition). The package's tests, `packages/lab/**`, run on the CORE's
 * rstest config in `ci.yml`, over a checkout of a11ign/a11ign: they reach the core by relative path and nothing in `packages/lab` installs on its own. Moving where they run is
 * not this file's.
 *
 * `root` is this file's repository root, not the working directory, so the config reads the same from any directory.
 */
import { fileURLToPath } from "node:url";
import { defineToolchainConfig } from "@a11ign/toolchain/rstest-config";

export default defineToolchainConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  include: ["scripts/**/*.test.ts"],
});
