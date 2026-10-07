# @a11ign/lab

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
