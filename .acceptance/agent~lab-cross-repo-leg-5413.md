Classifies the four control fleet files the cross-repo leg fails on (a11ign/a11ign#5413): `fleet-converge.ts`, `fleet-dispatch.ts` and `fleet-lock.ts` are DOCUMENTED, `worker-fleet-carried.ts` is INFRASTRUCTURE, each by its exit calls read from source at control v0.13.15.

The check here is structural: each of the four files has a classification record in the test. Whether the record's reasons match the source is verified by the cross-repo leg, which runs the test with the control package laid beside it.

Acceptance: `grep -qF 'packages/control/src/fleet-converge.ts":' src/gates/exit-code-contract.test.ts && grep -qF 'packages/control/src/fleet-dispatch.ts":' src/gates/exit-code-contract.test.ts && grep -qF 'packages/control/src/fleet-lock.ts":' src/gates/exit-code-contract.test.ts && grep -qF 'packages/control/src/worker-fleet-carried.ts":' src/gates/exit-code-contract.test.ts`
