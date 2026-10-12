Closes a11ign/a11ign#5196

Acceptance: `bash -c 'grep -c "run: pnpm run capture" .github/workflows/capture-check.yml && grep -c "runs-on: windows-2022" .github/workflows/capture-check.yml'` (run from the lab root). Prints `1` and `1`.

The row's own command, `grep -c "capture:check" .github/workflows/capture-check.yml`, prints `1` here too, and `pr:open`'s acceptance reader REFUSES it by name (`needs a real worker and NVDA`: it matches the string, not what the command does). The two greps above prove the same fact (the step that runs the harness exists; the runner is the Windows one) with no worker.

Hand-run: Done-when 2 of the row is a green `capture-check` run on the lab's `main` at the merge commit, which this pull request cannot have produced. The run on this pull request's own head is the only evidence before the merge, and it is recorded on the pull request, not here.

## How the install was settled
- **Not the manifest.** `package.json` names `@a11ign/control` and `@a11ign/nvda-speech` (no registry holds either: `npm view` E404, measured 2026-10-12) and `@a11ign/evidence@0.2.0`, `judge@0.2.3`, `scorer@0.2.1` (the registry holds none of those versions), so `pnpm install` of it cannot run, which is why there is no lockfile (`ci-composition.test.ts` pins that). The job keeps the five entries `capture-check.ts`'s import graph reaches (`@a11ign/screenreader-fleet`, `@a11ign/screenreader-worker`, `@a11ign/toolchain`, `serve`, `tsx`) at the manifest's own versions, and fails if the manifest stops declaring one.
- **The import graph was walked, not guessed.** `src/harnesses/capture-check.ts` reaches 4 files in the lab and 6 bare specifiers, and no path above the lab root (a11ign/a11ign#5176's concern, merged as lab#92): measured with a script over `origin/main` at `43e59160`.
- **No lockfile committed.** A lockfile of the subset is not a lockfile of the manifest: `ci.yml`'s `release-dry-run` refuses a pull request that adds one (the release would take another install path), and `ci-composition.test.ts` pins its absence.
- **Which NVDA.** The worker's own guidepup (0.31.0, NVDA 2026.1.1) drives NVDA, and the manifest's `@guidepup/guidepup` (0.35.0) names NVDA 2026.2. `@guidepup/setup` reads the manifest of the guidepup resolvable from its working directory, so the step runs it from the worker's own guidepup.

## Evidence
- Install step, run locally on Linux with `--ignore-scripts` against `origin/main`'s manifest: 6 packages at the manifest's pins installed, and `import('./src/harnesses/capture-check.ts')` under `tsx` printed `IMPORT OK`. This resolves the module graph; it does not run `capture:check`, which is out of an engineer's reach.
- NVDA step: resolved `.../node_modules/.pnpm/@guidepup+guidepup@0.31.0` as the installer's working directory, on Linux, before the installer itself refused the platform. NVDA was not installed here.

Not exercised here: the Windows runner, NVDA and the capture itself. The first run on this pull request is the first time any of them runs.

Mutation: n/a -- no guard added. The one refusal the install step has (a name the manifest stops declaring) was exercised by renaming `tsx` in a copy of `package.json`: the step threw `package.json no longer declares tsx`; the manifest was restored from a copy and `diff` was identical.

Outside-Region: none
Fleet: No.
