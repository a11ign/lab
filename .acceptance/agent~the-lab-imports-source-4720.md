Closes a11ign/a11ign#4720

Acceptance: `bash -c '! git grep -n "@a11ign/evidence/source-text" -- src && git grep -q "@a11ign/toolchain/lib/source-text" -- src'` (run from the lab root; the row's own `cd /home/agent/repos/lab` form reads the primary checkout, which is not this branch). Printed nothing and exited 0.

## What changes
- 40 files under `src/`: `@a11ign/evidence/source-text` becomes `@a11ign/toolchain/lib/source-text` (37 import lines and 3 comment-only mentions; 45 lines changed in all, the 5 other lines are further comment mentions in the same files).
- `package.json`: `devDependencies["@a11ign/toolchain"]` `0.1.5` to `0.7.0`. `ci.yml` reads that field to install the layout check, so the layout check runs at 0.7.0 after this change. The core pins the same `0.7.0` (`package.json` `devDependencies`), which is what the lab's imports resolve to once laid into it.
- `.changeset/lab-reads-source-text-from-the-toolchain.md`.

## Evidence (measured)
- Behaviour comparison: `stripComments` from `@a11ign/toolchain@0.7.0` (`dist/lib/source-text.mjs`, from `npm pack`) against the core's `packages/evidence/src/source-text.ts` (version 0.2.0, the one the lab pins; 0.2.0 is not on the registry, which holds 0.1.0 and 0.3.x). Applied to every tracked text file (`ts mjs js tsx cjs json yaml md py sh`) of the lab at `700e5026` and of the core at this branch's base: 1,653 files, 21.9M characters, 1,653 byte-identical, 0 differing. Both modules export `stripComments` only, with signature `(source: string) => string`.
- Typecheck: the lab's own `tsconfig.json` extends the core's, so bare `npx tsc --noEmit` has nothing to extend outside a laid core. Run with this tree laid as `packages/lab` in a scratch core (node_modules from a built core at toolchain 0.7.0): 0 diagnostics mention `source-text`. Positive control: with `toolchain/lib/source-text` mutated to `toolchain/lib/source-textX` in `src/dataset-paths.test.ts`, tsc reports TS2307 on that line; restored with `cp`, `diff` identical. The 22 other diagnostics in that harness are relative paths into core files (`../../../../eslint.config.js`, `../../../guards/src/...`) that the scratch layout does not carry, none touching the 40 files' imports.

## Not done / open
- The lab's CI (laid core, `pnpm run build`, rstest) is the suite that runs the 40 tests; not run locally.
- `@a11ign/evidence` stays in `dependencies`: other subpaths (`verify`, `document-identity`, ...) are still imported.

Mutation: n/a -- a mechanical import rewrite with no guard added; the positive control above is the check that the new specifier is the one resolved.

Outside-Region: none
Fleet: No.
