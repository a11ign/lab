Acceptance:
```bash
cd /home/agent/repos/lab && bash -c '! grep -n "npm-cli-executable\.mjs" src/training/page-server.mjs && grep -c "npm-cli-executable\.ts" src/training/page-server.mjs'
```

Closes a11ign/a11ign#4561

## What changed

`src/training/page-server.mjs` line 23 imports the product helper as `../../../../scripts/npm-cli-executable.ts`. The product renamed it from `.mjs` in a11ign#4393, so the laid tree's page-server could not load and `capture-regression` died at start in `release.yml` (`ERR_MODULE_NOT_FOUND`). Only that line changes; plus a patch changeset so lab cuts a tag carrying it.

Node has to load a `.ts` import from a `.mjs` file. Node 22.18.0 and later strip types by default (https://nodejs.org/api/typescript.html), and `capture-check.mjs` runs under plain `node` in CI, so no loader is added. Pinning this tag into the core is a separate row.

## Verification

Repro, before the change (Node v24.21.0, simulated core layout: `packages/lab` + `scripts/npm-cli-executable.ts` + `packages/guards/src/test-tmp.ts`):

    Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../scripts/npm-cli-executable.mjs' imported from .../packages/lab/src/training/page-server.mjs

After the change, same layout, `node --test packages/lab/src/training/page-server-holders.test.ts`: `tests 11 / pass 11 / fail 0`. `node -e "import('./packages/lab/src/training/page-server.mjs')"` loads.

Mutation: the Acceptance grep fails on the pre-change file (`git show HEAD~1:src/training/page-server.mjs`, line 23 `.mjs`, exit 1) and passes on this head.

This host's `/usr/bin/node` (v22.22.1) is built without TypeScript support (`process.features.typescript` is `false`, and `--experimental-strip-types` gives `ERR_NO_TYPESCRIPT`), so the holders test cannot run on it at all, `.ts` test or not. Its CI runs go through rstest.

Tag quoting (Done-when 1) happens after merge and lab's release.
