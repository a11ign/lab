Classifies the four control fleet files the cross-repo leg fails on (a11ign/a11ign#5413): `fleet-converge.ts`, `fleet-dispatch.ts` and `fleet-lock.ts` are DOCUMENTED, `worker-fleet-carried.ts` is INFRASTRUCTURE, each by its exit calls read from source at control v0.13.15.

Acceptance: `node --test src/gates/exit-code-contract.test.ts`
