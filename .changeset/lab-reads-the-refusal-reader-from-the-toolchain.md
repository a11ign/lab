---
"@a11ign/lab": patch
---

The lab's refusal-owner check reads the reader from `@a11ign/toolchain/refusal-owners-are-open` instead of its own trimmed copy, `scripts/refusal-owners-are-open.ts`, which is deleted (a11ign/agent-org#1415, decision (a) of #5361, ADR 0045 rule 2: the consumer bumps and deletes). `devDependencies["@a11ign/toolchain"]` moves `0.9.0` to `0.10.2`, the first release that exports `./refusal-owners-are-open`. The package names no project, so the live read is asked of `a11ign/lab` explicitly. `src/packaging/refusal-owners-are-open.test.ts` imports the package, and the lab's entry in `baselines/layer-edges.baseline.json` for the deleted file is removed.
