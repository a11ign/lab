---
"@a11ign/lab": patch
---

`ci.yml` runs one `checks` job: the `cross-repo` leg, which cloned a11ign/agent-org at its newest release tag and was `continue-on-error`, is gone, with `scripts/cross-repo-tests.ts`, the 22 test files and the cases that loaded agent-org's internal modules, and their entries in `baselines/layer-edges.baseline.json`. Every other test runs in the required job. `auto-arm.yml` no longer refuses a pull request for a red cross-repo leg (no `Cross-repo-red:` line to write, no `edited` trigger), and `auto-arm.sts.yaml` drops `actions: read`, which only the refusal's log read used (A11-180).
