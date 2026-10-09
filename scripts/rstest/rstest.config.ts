/**
 * The lab's own test config: a THIN CALL into `@a11ign/toolchain` (ADR 0043, Decision 3), the one rstest config every a11ign repository shares, so
 * `pnpm test` here runs the way it does in `agent-org`. It carries the `node:test` resolve hook and shim, `forks` isolated, the worker cap locally, the
 * run record and the verdict line. What is the lab's is only where the repository is, and which files are tests.
 *
 * `include` IS `src/` ALONE: every lab test sits beside the code it covers, and `tests/` holds Python. `root` is this file's repository root, not the
 * working directory, so `pnpm test` means the same from a subdirectory. The core's CI runs these files through ITS config with the lab laid at
 * `packages/lab` (`ci.yml`), which is why this one is not what the required check runs.
 */
import { fileURLToPath } from "node:url";
import { defineToolchainConfig } from "@a11ign/toolchain/rstest-config";

export default defineToolchainConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  include: ["src/**/*.test.ts"],
});
