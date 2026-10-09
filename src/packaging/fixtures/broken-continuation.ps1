# THIS FILE IS SUPPOSED NOT TO PARSE. It is the positive control for `powershell-parses.test.ts` (#2006),
# excluded from that guard's population by its exact path and by nothing else.
#
# The defect shape is the one this repository actually shipped: at `0c4f39b1d`
# `packages/worker-fleet/src/provisioning/set-display-mode.ps1` carried 14 parse errors of this kind and its
# 22 tests were green, because every one of them matched the file's TEXT. A complete expression ends at the
# newline in PowerShell, so an operator that BEGINS the next line does not continue the previous one -- the
# `+` below is read as a new statement and the parenthesis is never closed.
#
# Never "fix" this file. Fixing it deletes the only evidence that the guard can say no.
Write-Output ("a"
  + "b")
