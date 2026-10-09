#!/usr/bin/env bash
# Run the GitHub Action's own steps LOCALLY, against a live worker, before spending runner minutes.
#
#   ./scripts/action-dry-run.sh <page-url> "<task>" [worker-url]
#
# ## Why this exists
#
# `act` cannot help here: it is Docker/Linux and this action needs Windows for NVDA. So the choice was
# between pushing a branch and waiting ~25 minutes per attempt, or running the steps by hand and getting
# them subtly wrong. Every gate in this project that ran for the first time found a defect, and the Action
# is the one thing still untested outside this machine — so it gets the same treatment as everything else.
#
# ## What this DOES cover
#
# The steps that carry the logic: capture and judge, the report, the exit contract, the job-summary and
# step-output files. It sets `RUNNER_TEMP`, `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` exactly as a runner
# does, and runs the same bash the action runs.
#
# ## What it CANNOT cover, and why that is acceptable
#
# The Windows-only setup: installing NVDA, disabling the Speech Viewer, the Edge policy, starting the
# worker. Those cannot run on a Mac. They are also the steps already exercised on a real Windows runner by
# `capture-regression.yml`, which uses the same commands for the same reasons — so they are the least
# speculative part. What was never exercised anywhere is everything below, which is what this runs.
#
# It also cannot cover `gh pr comment`; that needs a pull request.
#
# NOTE: bash, deliberately. `status` is a READ-ONLY variable in zsh, so running the action's snippets in a
# zsh shell fails with "read-only variable: status" — an artefact of the harness, not of the action, which
# declares `shell: bash`. Worth knowing before concluding the action is broken.
set -euo pipefail

URL="${1:-}"
TASK="${2:-}"
WORKER="${3:-${A11Y_WORKER:-http://REDACTED-INTERNAL-ADDRESS:8765}}"
FAIL_ON="${FAIL_ON:-never}"
BACKEND="${JUDGE_BACKEND:-local}"

if [ -z "$URL" ] || [ -z "$TASK" ]; then
  echo "usage: $0 <page-url> \"<task>\" [worker-url]" >&2
  exit 2
fi

cd "$(git rev-parse --show-toplevel)"

# Stand in for the runner's environment.
work="$(mktemp -d)"
export RUNNER_TEMP="$work"
export GITHUB_OUTPUT="$work/github_output.txt"; : > "$GITHUB_OUTPUT"
export GITHUB_STEP_SUMMARY="$work/step_summary.md"; : > "$GITHUB_STEP_SUMMARY"
trap 'echo; echo "artifacts kept in $work"' EXIT

echo "== dry run =="
echo "   url     $URL"
echo "   task    $TASK"
echo "   worker  $WORKER"
echo "   judge   $BACKEND    fail-on  $FAIL_ON"
echo

# Refuse early, exactly as the action's first steps do, so a dry run cannot pass where the real thing
# would fail.
case "$BACKEND" in
  local)
    test -f models/screenreader-scorer/model.safetensors \
      || { echo "the trained scorer is missing — the local judge cannot run" >&2; exit 1; } ;;
  anthropic) [ -n "${ANTHROPIC_API_KEY:-}" ] || { echo "anthropic needs ANTHROPIC_API_KEY" >&2; exit 1; } ;;
  openai)    [ -n "${JUDGE_BASE_URL:-}" ] || { echo "openai needs JUDGE_BASE_URL" >&2; exit 1; } ;;
  *) echo "judge-backend must be local, anthropic or openai (got '$BACKEND')" >&2; exit 1 ;;
esac

if ! curl -sf -m 10 "$WORKER/health" >/dev/null; then
  echo "no worker answering at $WORKER — start one with ./scripts/local-worker/worker-ctl.sh up" >&2
  exit 1
fi

echo "-- step: Capture and judge --"
out="$RUNNER_TEMP/a11ign-result.json"
args=("$URL" --task "$TASK" --json)
[ "${PROBE_FORMS:-false}" = "true" ] && args+=(--probe-forms)
[ "${AXE:-false}" = "true" ] || args+=(--no-axe)
A11Y_WORKER="$WORKER" JUDGE_BACKEND="$BACKEND" A11Y_PYTHON="${A11Y_PYTHON:-.venv/bin/python}" \
  npx tsx src/cli.ts "${args[@]}" > "$out"
echo "   result-json=$out ($(wc -c < "$out" | tr -d ' ') bytes)"
echo "result-json=$out" >> "$GITHUB_OUTPUT"

echo "-- step: Report --"
# `|| status=$?`, matching the action: `shell: bash` runs with -eo pipefail, so a bare failing command
# would abort before the outputs were written — on exactly the runs where they are wanted.
status=0
npx tsx src/action/run.ts --result="$out" --fail-on="$FAIL_ON" \
  --summary-out="$RUNNER_TEMP/a11ign-summary.md" --marker=a11ign || status=$?
node -e '
  const r = require(process.argv[1]); const fs = require("fs");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `findings=${r.verdict.findings.length}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `task-completable=${r.verdict.taskCompletable}\n`);
' "$out"

echo
echo "-- what the runner would see --"
echo "   step outputs:"; sed 's/^/     /' "$GITHUB_OUTPUT"
echo "   job summary: $(wc -l < "$GITHUB_STEP_SUMMARY" | tr -d ' ') lines"
echo
sed 's/^/   /' "$RUNNER_TEMP/a11ign-summary.md"
echo
echo "-- exit contract --"
echo "   report step would exit $status (fail-on=$FAIL_ON)"
exit "$status"
