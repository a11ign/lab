Closes a11ign/a11ign#4588

Acceptance: `bash -c '! grep -qE "readDeclaredCopies|copyDriftReading|KNOWN_UNREADABLE_ORIGINALS" src/packaging/agent-org-wiring.test.ts && test "$(grep -c "COPIED FROM" src/packaging/agent-org-wiring.test.ts)" = 0'` (the row's first two commands, run from this tree instead of `/home/agent/repos/lab`; its third, `npx tsc --noEmit`, needs the lab laid as `packages/lab` of a core checkout, see Evidence)

## What changes
`src/packaging/agent-org-wiring.test.ts` loses tests [36] and [37] (65 lines) and everything only they used: `CopyPair`, `declaredCopies`, `KNOWN_UNREADABLE_ORIGINALS`, `withoutKnownUnreadable`, `withConstLinesBroken`, and the `copyDriftReading` / `readDeclaredCopies` destructuring from `org-health.mjs`. Nothing replaces them in the lab: agent-org's own tests own its tree (row 5 deletes the copies). The other tests are untouched, and each import that remains is still used by one (`readdirSync`, `readFileSync`, `join`, `TOOL`, `ROOT`).

## Evidence
- Acceptance greps 1 and 2 run in this tree: both pass.
- `tsc -p packages/lab/tsconfig.json --noEmit` with this tree laid into a core worktree at `origin/main` (42be7fda1): 4 errors in this file, all in code this PR does not touch: lines 36 and 37 (TS2307, the `.mjs` imports of files the core renamed to `.ts`) and 274 (two TS7006 that follow from them). These are the `CORE_REF` bump's hunks in lab#53, which this row's wait on #4569 was about; none names a removed symbol.
- The lab's rstest is not run: the lab runs laid into a core at `CORE_REF`, and CI's `checks` job does that.
- Resource ban respected: no `fleet:*`, `lab:*`, `worker:*` or gate run.

## Not done
- lab#53 (#4569) is closed and reopens after this merges; its report-only machinery for [36]/[37] drops on rebase.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
