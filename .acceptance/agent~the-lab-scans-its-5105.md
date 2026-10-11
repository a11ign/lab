Closes a11ign/a11ign#5105

Acceptance: `node --test src/product-checks/wire-type-declarations.test.ts`

Mutation: appending `stateChanges?: { control: string; after: string }[]` to `src/harnesses/judge-file.ts` makes the scan test fail and name that file (`src/harnesses/judge-file.ts: stateChanges: { control: string; after: string }[]`), 2 pass and 1 fail; the file restored byte-identical from a copy (`cp` and `diff`). Emptying the population (`labSources(/\.nothing$/)`) fails the positive control (`0 files`, `src/harnesses/judge-file.ts is not in the scanned population`), restored byte-identical the same way.
