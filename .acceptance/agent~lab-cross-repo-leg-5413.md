Classifies the four control fleet files the cross-repo leg fails on (a11ign/a11ign#5413): `fleet-converge.ts`, `fleet-dispatch.ts` and `fleet-lock.ts` are DOCUMENTED, `worker-fleet-carried.ts` is INFRASTRUCTURE, each by its exit calls read from source at control v0.13.15.

The check is the row's own command, unchanged. The corpus-free job cannot run it (the test imports the control package, which a bare checkout does not lay), so this PR declares a hand-run; see the PR body.

Acceptance: `bash -c 'cd ~/repos/lab && git fetch -q origin && git checkout -q --detach origin/main && node --test src/gates/exit-code-contract.test.ts'`
