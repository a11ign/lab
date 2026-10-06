# @a11ign/lab

## 0.1.1

### Patch Changes

- e70e590: Sync `packages/lab` to a11ign/a11ign at `9f2860710197d65518a1a136f75708e727734567`, so the workspace's delete of its own copy (a11ign/a11ign#3505) has a tag that matches what it deletes. `v0.1.0` was cut from the extraction and the workspace's copy moved on.

## 0.1.0

First release from its own repository. `packages/lab` moved out of `a11ign/a11ign` with its history (2,578 non-merge commits, internal addresses redacted from every file and commit message), and releases itself from here: a merge carrying a changeset is tagged `v<version>` with a GitHub Release. It is not self-contained: its CI lays it over a pinned checkout of `a11ign/a11ign`.
