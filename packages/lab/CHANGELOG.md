# @a11ign/lab

## 0.1.12

### Patch Changes

- 604c538: `packages/lab/scripts/cantell-by-page-shape.ts` groups the recorded abstention sweep's calibration pages by the shape their corpus entry declares (`demonstrates` matching `/table|filter/i`, else other) and prints, per group, the page count, the mean `cantTell` criteria per page and the share of pages on which 4.1.3 and 3.3.1 are `cantTell`, with whether the table/filter mean is at least twice the other group's. It scores nothing and refuses, exit 2, when no sweep is recorded. a11ign/a11ign#4242.

## 0.1.11

### Patch Changes

- e527b4e: `calibrate-abstention.mjs` also writes `runs/abstention/calibration-judgments.json`: each scored page's findings (`wcag`, the quoted `evidence`, `mapping`) beside its `cantTell` and `predicted` criteria, so the referral repeat share can be counted per page. `abstention-sweep.json` is unchanged (a11ign/a11ign#4293, #4241).

## 0.1.10

### Patch Changes

- a239062: lab counts its `.js`/`.mjs`/`.cjs` source against a committed baseline (a11ign/a11ign#4262, the adoption half of #4243). `scripts/mjs-ratchet.test.ts` calls `checkMjsRatchet` from `@a11ign/toolchain/mjs-ratchet`, and `mjs-ratchet.baseline.json` records the reading at this commit: 113 files, no exceptions. The pin moves to `^0.1.4`, the release that carries the function. A new `.mjs` now fails the repository's own `pnpm test`; no workflow file is touched.

## 0.1.9

### Patch Changes

- 40e071d: `referral-repeat-share.mjs` reads the calibration sweep's one `calibration-judgments.json` (`{ pages: [...] }`) as well as one file per page (a11ign/a11ign#4241, #4293).

## 0.1.8

### Patch Changes

- f276ea1: `referral-repeat-share.mjs` measures the share of a page's referrals that repeat a (criterion, quoted text) pair already seen on that page, so grouping repeats in the report is decided on a number (a11ign/a11ign#4241, #4084 outcome 4).

## 0.1.7

### Patch Changes

- c46bdb3: `gate:stability` can capture on a host that holds the lab LAID (a11ign/a11ign#3984). Two lab files imported `@a11ign/control` by NAME (`training/wake-by-hand.mjs`, `fleet-wake`, and `harnesses/occurrence-verdict-stability.mjs`, `layer-checkouts`), and on the lab host nothing provides that name: the package is on no registry and control is laid as `src/` with no manifest, so every canary died with `ERR_MODULE_NOT_FOUND` and 0 of 45 captures were taken. Both now import control's laid `src` by relative path, the way the lab already reaches the core's `guards/src`, and `layer-edges.baseline.json` records the two edges.

## 0.1.6

### Patch Changes

- 9f3f56d: `gate:stability` can start its page server on a host that holds the lab LAID, and a crash of its harness no longer posts as an unstable canary (a11ign/a11ign#3977). The page server ran `pnpm --filter @a11ign/lab exec serve`, which needs `packages/lab` to be a workspace project; on the lab host there is none, so nothing bound :5050 and the gate died after 90 s. It now runs `pnpm exec serve`, and `serve` is declared by the core's root manifest, which is where the lab host's install reads it. A throw out of the gate script is caught and exits 2 (INCONCLUSIVE, `NO VERDICT: gate:stability crashed ...`); Node's own exit 1 for an uncaught throw is the code for "a canary was found UNSTABLE".

## 0.1.5

### Patch Changes

- 218de7a: `CORE_REF` moves to `d8d9a02fc701532c23a61a9ee1e48a9d7f0d3f39`, the core commit that carries a11ign/a11ign#3506: `layers.json` at the root, and `packages/control` a LAID layer (tag v0.1.4) with no tests and no manifest. The laid control is untracked, so the guards that walk `git ls-files` cannot see it: a new `src/packaging/laid-control.ts` walks it on disk, and the guards that name control's files (ansible, powershell, checkout-dash, layer edges, ...) read the union. Entries for control's own tests, which the core no longer holds, are removed or tombstoned in the commit's message; floors that counted the core's workspace are re-measured. CI installs `@a11ign/control` as control's own manifest (fetched at the laid tag) plus a link to the laid `src`, because a plain link has no `exports` to resolve `@a11ign/control/fleet-wake` through. a11ign/a11ign#3972.

## 0.1.4

### Patch Changes

- 38b1061: Carry a11ign/a11ign#3289's change (PR #3837) into the poster's tests: `post-qualification-status.test.ts` tests the poster that uses the host's `gh` (no token file; exit 3 on no usable credential), and `exit-code-contract.test.ts` drops "token file is absent". `CORE_REF` moves to `275635da6f45eae0cbd747ee1f9b2666935cde16` (the commit of #3837's branch that adds the poster, `275635da6`) because these tests import the poster by relative path from the core laid at that ref.

## 0.1.3

### Patch Changes

- 6353d75: `gate:stability` replaces its `nls.uk` canary with W3C's APG disclosure-navigation page (a11ign/a11ign#3905). The `nls.uk` page is first-visit-only by construction (Civic Cookie Control, `notifyOnce: true`), so a cold profile's first capture was a different page from the other four and the gate read UNSTABLE for a reason that is the page's. The replacement serves no client storage and no consent panel; the gate's harness is unchanged and does not discard a first capture.

## 0.1.2

### Patch Changes

- 6afd471: Sync `packages/lab` to a11ign/a11ign at `a66b1ae3998baab0b7550a408a55844d546ba84a`, so the workspace's delete of its own copy (a11ign/a11ign#3505) pins a tag that matches what it deletes. `v0.1.1` was cut from `9f2860710` and the workspace's copy moved on by 33 files.

## 0.1.1

### Patch Changes

- e70e590: Sync `packages/lab` to a11ign/a11ign at `9f2860710197d65518a1a136f75708e727734567`, so the workspace's delete of its own copy (a11ign/a11ign#3505) has a tag that matches what it deletes. `v0.1.0` was cut from the extraction and the workspace's copy moved on.

## 0.1.0

First release from its own repository. `packages/lab` moved out of `a11ign/a11ign` with its history (2,578 non-merge commits, internal addresses redacted from every file and commit message), and releases itself from here: a merge carrying a changeset is tagged `v<version>` with a GitHub Release. It is not self-contained: its CI lays it over a pinned checkout of `a11ign/a11ign`.
