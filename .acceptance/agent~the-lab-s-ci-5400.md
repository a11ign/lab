Closes a11ign/a11ign#5400

Acceptance: `bash -c 'cd /home/agent/repos/lab-wt-5400 && git grep -q -E "^  CONTROL_REF: v[0-9]+[.][0-9]+[.][0-9]+$" HEAD -- .github/workflows/ci.yml && git -C /home/agent/repos/control cat-file -e "$(sed -n "s/^  CONTROL_REF: //p" .github/workflows/ci.yml):src/lab-carried.ts"'` Exit 0 at this head: `ci.yml` declares `CONTROL_REF: v0.13.15` and control's tag of that name has `src/lab-carried.ts`. The row's own command (`git grep -q -E "CONTROL_REF|CONTROL_TAG"` at `origin/main` or `origin/agent/the-lab-s-ci-5400`) is true at this head too, and false at `origin/main` (`fd7bd047`) today, where `CORE_REF` is the only ref.

## What changed, and the mechanism taken

- **`.github/workflows/ci.yml`:** one named value, `CONTROL_REF: v0.13.15`, the first control tag with `src/lab-carried.ts` (control#87; `git cat-file -e v0.5.3:src/lab-carried.ts` fails, `v0.13.15:src/lab-carried.ts` succeeds). A new step, after the install and the build, clones control at that tag and lays it over the core's own `packages/control` the way the core's `scripts/lay-layer.ts` laid it at its pin: `src` less its `*.test.*`, `ansible`, `CLAUDE.md`, `README.md`, and the core's `layers.json`. The manifest the lay step puts in `@a11ign/control` is read from that clone, where it was a `curl` at the core's `.layer-ref`.
- **Mechanism (ADR 0045 item 3, a11ign#5312):** control "stays private, deployed from its own checkout", and its `package.json` says `"private": true`, so it is not a published package and the row's "re-file" branch does not apply. A checkout of a ref is what is left, and the ref is the one named value above.
- **Why `packages/control` and not a sibling directory:** control v0.13.15's `fleet-playbook.ts` and `lab-pipeline.ts` import `../../worker-fleet/src/...` and resolve `../../../`; both are only true beside the core's `packages/worker-fleet` at depth two.
- **`src/packaging/ci-composition.test.ts`:** pins the declaration (a release tag, never a branch, at or after v0.13.15), the clone reading it, no read of `.layer-ref` and no raw.githubusercontent fetch, the order (after the install and the build, before the lab is laid) and the shape of what is laid. The one assertion that forbade any release tag in the file now drops the `CONTROL_REF` line first.

## Measured

Every number below is from running the command: the real `run:` blocks of this branch's `ci.yml` (extracted with a YAML parser, not retyped) against a core worktree at `CORE_REF` `2b8489a8d`, `pnpm install --offline` and `pnpm run build`, this tree laid at `packages/lab`, tool v0.191.0 from `agent-org-newest-tag.ts`, Node as on the host.

- **Before, `origin/main`'s `ci.yml`:** a lab file with `import { qualificationStatus } from "@a11ign/control/lab-carried"` fails `tsc -p packages/lab/tsconfig.json --noEmit` with `TS2307: Cannot find module '@a11ign/control/lab-carried'`. After, this branch's: exit 0.
- **`own` leg** (`cross-repo-tests.ts --scope=own`, 456 entries): `origin/main` 1,656 pass; this branch with control laid at v0.13.15, 1,656 pass (11 skipped, both). `eslint --no-ignore packages/lab` 0 errors; `tsc -p packages/lab/tsconfig.json --noEmit` exit 0.
- **The cross-repo leg was not run:** it is `continue-on-error` and reads the core's workflows and the live tool.
- **Laying control whole is red, and this is why the lay copies what it copies:** with the whole `git archive` laid (tests, `scripts/`, `.github/`) 4 of 1,656 failed (`dataset-paths`, `corpus-readers-are-guarded`, `referenced-scripts`, `runs-write-guard`); with `src`, `ansible` and the two docs and no tests, 3; with the core's `layers.json` beside them, 2; with the two exemption entries described under Outside-Region, 0.

## Mutation (in both directions), on the laid copy of `ci.yml`, each restored byte-identical (`cmp`)

| Break | Fails |
| --- | --- |
| `CONTROL_REF: v0.5.3` | the floor test only |
| the clone reads a literal tag, not `$CONTROL_REF` | the declaration test, the order test, and the "no tag held" test |
| the control step moved BEFORE `pnpm install` | the order test only |
| the manifest `curl`ed at `.layer-ref` again | the declaration test and the staging test |
| the `find ... -delete` of tests made `-print` | the order/shape test only |
| the `cp layers.json` made `true` | the order/shape test only |

Unmutated: 13 of 13.

## Outside-Region

Control v0.13.15 carries three files the lab's two `runs/` guards walk and have no exemption for (measured above: 2 failures in the `own` leg, so `checks (own)` is red on every lab pull request without them). Each entry copies the reason its sibling `fleet-watch.ts` gives (ADR 0012: control cannot import the lab, and the file writes a one-record ledger of its own, never the corpus).

Outside-Region: src/dataset-paths.test.ts — `EXEMPT` gains `fleet-build-incident.ts` (runs/fleet-build-incident-state.json) and `fleet-converge.ts` (runs/fleet-converge-last-run.json), the two files control v0.13.15 has that v0.5.3 did not.
Outside-Region: src/runs-write-guard.test.ts — `EXEMPT` gains those two and `fleet-playbook.ts` (`PATCH_RUN_RECORD`, written when `fleet:patch --apply` completes, which v0.5.3 did not write).

## platform

`platform:` `actions/checkout` was considered for the clone and a `git clone --branch` taken instead: the lay needs the clone OUTSIDE `packages/control` (the manifest is read from it, and only four paths are copied in), and a checkout cannot select paths.
