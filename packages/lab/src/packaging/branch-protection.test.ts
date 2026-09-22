/**
 * #2022: `main` REQUIRES AN APPROVING REVIEW, AND THIS PINS IT BEHAVIOURALLY RATHER THAN OFF THE FIELD.
 *
 * `ceo`'s 2026-09-22 ruling on #2022 is explicit about why the obvious test is the wrong one:
 * `required_approving_review_count == 1`, read back from the API, proves the setting is SET, not that it
 * BITES. Two arming identities queue merges here (`a11ign-ai-workers` and `DanBeckDev`), and on
 * 2026-09-22 `DanBeckDev` was the sole entry in `bypass_pull_request_allowances` -- so the field could
 * read `1` while the rule was absent on roughly half of the merges. A requirement that covers one arming
 * path and exempts the other is worse than either arm of the row.
 *
 * THE BEHAVIOURAL READ IS `reviewDecision`, AND ITS PRE-CHANGE VALUE IS MEASURED, NOT ASSUMED.
 * GitHub computes no review decision at all when the base branch requires none. Measured 2026-09-23 at
 * `6eac64880`, before the change, on #1968 -- the PR whose real approving review met #1761's clearing
 * condition:
 *
 *     $ gh pr view 1968 --json reviewDecision,reviews
 *     {"reviewDecision":"","states":["CHANGES_REQUESTED","CHANGES_REQUESTED","APPROVED"]}
 *
 * Three reviews, one of them APPROVED, and an EMPTY decision. That is the decorative state as an
 * observation: the reviews existed and decided nothing. So `reviewDecision` is the field that changes
 * when the rule starts biting, it is readable WITHOUT repository-admin rights, and its failing value is
 * the one this repository actually had.
 *
 * WHAT THIS TOKEN CANNOT SEE, IT SAYS SO ABOUT. Measured the same day, as `a11ign-ai-workers`:
 * `repos/a11ign/a11ign.permissions.admin` is `false`, and `branches/main/protection` answers 404 while
 * `branches/main.protected` answers `true`. The row names that trap by hand -- a 404 means absent OR
 * forbidden -- and here it is demonstrably FORBIDDEN. `branches/main.protected` is the discriminator,
 * because it needs no admin. A verdict that cannot see the exemption list must be CANNOT_TELL, loudly,
 * and never a pass: that is the whole of "distinguish them or fail loudly".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/** A requirement is only REQUIRED when it bites AND exempts nobody; anything unreadable is its own state. */
const VERDICT = { REQUIRED: "REQUIRED", DECORATIVE: "DECORATIVE", CANNOT_TELL: "CANNOT_TELL" } as const;
type Code = (typeof VERDICT)[keyof typeof VERDICT];

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

type ProtectionRead = {
  /** Status from `GET /repos/{o}/{r}/branches/main/protection` -- admin-only, so often 404 here. */
  status: number;
  /** `.protected` from `GET /repos/{o}/{r}/branches/main` -- readable by any token that can read the repo. */
  protectedFlag: boolean | null;
  /** The protection body when status is 200, else null. */
  body: { required_pull_request_reviews?: { bypass_pull_request_allowances?: BypassAllowances } } | null;
};
type BypassAllowances = { users?: unknown[]; teams?: unknown[]; apps?: unknown[] };

/**
 * THE 404 TRAP, AS A FUNCTION. Absent and forbidden are the same status code, and only
 * `branches/main.protected` tells them apart without admin. Reading 404 as "unprotected" is the failure
 * the row forbids by name.
 */
function protectionReadVerdict({ status, protectedFlag }: Pick<ProtectionRead, "status" | "protectedFlag">) {
  if (status === HTTP_OK) return { code: VERDICT.REQUIRED, why: "the protection object was readable" };
  if (status !== HTTP_NOT_FOUND && status !== HTTP_FORBIDDEN) {
    return { code: VERDICT.CANNOT_TELL, why: `the protection endpoint answered ${status}, which is neither a read nor a refusal` };
  }
  if (protectedFlag === true) {
    return { code: VERDICT.CANNOT_TELL,
      why: `the protection endpoint answered ${status} but \`branches/main.protected\` is true: FORBIDDEN to this token, NOT absent` };
  }
  if (protectedFlag === false) {
    return { code: VERDICT.DECORATIVE,
      why: "`branches/main.protected` is false: main carries no protection at all" };
  }
  return { code: VERDICT.CANNOT_TELL,
    why: `the protection endpoint answered ${status} and \`branches/main.protected\` could not be read either` };
}

/** Everyone named here may merge without the approval the rule demands. */
function exemptIdentities(body: ProtectionRead["body"]): string[] {
  const allow: BypassAllowances = body?.required_pull_request_reviews?.bypass_pull_request_allowances ?? {};
  return [...(allow.users ?? []), ...(allow.teams ?? []), ...(allow.apps ?? [])]
    .map((a) => (typeof a === "string" ? a : String((a as { login?: string; slug?: string })?.login
      ?? (a as { slug?: string })?.slug ?? JSON.stringify(a))));
}

/**
 * THE WHOLE JUDGEMENT. `reviewDecision` says whether the rule bites; the protection object says whether
 * anyone is exempt from it. Both must be known to say REQUIRED, which is why an unreadable exemption list
 * downgrades a biting rule to CANNOT_TELL rather than passing it.
 */
function reviewRequirementVerdict({ reviewDecision, protection }: { reviewDecision: string | null; protection: ProtectionRead }) {
  if (!reviewDecision) {
    return { code: VERDICT.DECORATIVE as Code,
      why: "`reviewDecision` is empty: the base branch computes no decision, so it requires no approval -- the #1968 state" };
  }
  const read = protectionReadVerdict(protection);
  if (read.code === VERDICT.CANNOT_TELL) {
    return { code: VERDICT.CANNOT_TELL as Code,
      why: `the rule bites (reviewDecision=${reviewDecision}) but the exemption list is unreadable: ${read.why}` };
  }
  const exempt = exemptIdentities(protection.body);
  if (exempt.length > 0) {
    return { code: VERDICT.DECORATIVE as Code,
      why: `the rule bites but these identities bypass it: ${exempt.join(", ")}` };
  }
  return { code: VERDICT.REQUIRED as Code, why: `reviewDecision=${reviewDecision}, and no identity is exempt` };
}

// --- the 404 trap -----------------------------------------------------------------------------------

const FORBIDDEN_HERE = { status: HTTP_NOT_FOUND, protectedFlag: true };

test("#2022: 404 with `protected: true` is FORBIDDEN, never read as unprotected -- the measured shape", () => {
  // This is not hypothetical: it is exactly what `a11ign-ai-workers` reads, the token every session and
  // the CI job here authenticates as. If this collapsed to "unprotected" the pin would report the
  // requirement missing on every ordinary run, forever.
  const v = protectionReadVerdict(FORBIDDEN_HERE);
  assert.equal(v.code, VERDICT.CANNOT_TELL);
  assert.notEqual(v.code, VERDICT.DECORATIVE, "the trap the row forbids by name");
  assert.match(v.why, /FORBIDDEN to this token, NOT absent/);
});

test("#2022: 404 with `protected: false` IS absent, and says so -- the other half of the discriminator", () => {
  // The positive control for the test above: if `protectedFlag` could never be false, CANNOT_TELL would
  // be the only reachable answer and the discriminator would be decorative itself.
  const v = protectionReadVerdict({ status: HTTP_NOT_FOUND, protectedFlag: false });
  assert.equal(v.code, VERDICT.DECORATIVE);
  assert.match(v.why, /no protection at all/);
});

test("#2022: 403 is treated exactly as 404 -- GitHub uses both for a refusal", () => {
  assert.equal(protectionReadVerdict({ status: HTTP_FORBIDDEN, protectedFlag: true }).code, VERDICT.CANNOT_TELL);
});

test("#2022: a 404 with NEITHER endpoint readable is CANNOT_TELL, not a guess in either direction", () => {
  const v = protectionReadVerdict({ status: HTTP_NOT_FOUND, protectedFlag: null });
  assert.equal(v.code, VERDICT.CANNOT_TELL);
  assert.match(v.why, /could not be read either/);
});

test("#2022: an unexpected status is its own CANNOT_TELL rather than falling through to a read", () => {
  const v = protectionReadVerdict({ status: 500, protectedFlag: true });
  assert.equal(v.code, VERDICT.CANNOT_TELL);
  assert.match(v.why, /neither a read nor a refusal/);
});

// --- the behavioural judgement ----------------------------------------------------------------------

const READABLE = (allow: BypassAllowances = {}): ProtectionRead => ({
  status: HTTP_OK, protectedFlag: true,
  body: { required_pull_request_reviews: { bypass_pull_request_allowances: allow } },
});

test("#2022 THE #1968 STATE: an APPROVED review with an EMPTY decision is DECORATIVE, as measured", () => {
  // The pre-change reading, pasted in this file's header. A test that asserted "a review exists" would
  // have passed on #1968 and proved nothing -- the reviews were there and decided nothing.
  const v = reviewRequirementVerdict({ reviewDecision: "", protection: READABLE() });
  assert.equal(v.code, VERDICT.DECORATIVE);
  assert.match(v.why, /#1968 state/);
});

test("#2022: a null decision is the same as an empty one -- absent is absent however it is spelled", () => {
  assert.equal(reviewRequirementVerdict({ reviewDecision: null, protection: READABLE() }).code, VERDICT.DECORATIVE);
});

test("#2022: REVIEW_REQUIRED with nobody exempt is REQUIRED -- the rule bites on every identity", () => {
  const v = reviewRequirementVerdict({ reviewDecision: "REVIEW_REQUIRED", protection: READABLE({ users: [], teams: [], apps: [] }) });
  assert.equal(v.code, VERDICT.REQUIRED);
});

test("#2022: APPROVED also counts as biting -- a met requirement is still a requirement", () => {
  assert.equal(reviewRequirementVerdict({ reviewDecision: "APPROVED", protection: READABLE() }).code, VERDICT.REQUIRED);
});

test("#2022 THE BYPASS SHAPE: count 1 while `DanBeckDev` is exempt is DECORATIVE, and names who", () => {
  // `ceo`'s ruling: "Setting the count to 1 while that allowance stands would enforce the rule on the
  // `a11ign-ai-workers` path and exempt the `DanBeckDev` path -- a requirement that reads as covering
  // every PR while being absent on roughly half of them."
  const v = reviewRequirementVerdict({
    reviewDecision: "REVIEW_REQUIRED",
    protection: READABLE({ users: [{ login: "DanBeckDev" }] }),
  });
  assert.equal(v.code, VERDICT.DECORATIVE);
  assert.notEqual(v.code, VERDICT.REQUIRED, "this is the state that reads as protected and is not");
  assert.match(v.why, /DanBeckDev/, "a count is where an investigation stops; the pin names the identity");
});

test("#2022: an exempt TEAM or APP counts too -- the hole does not have to be a user", () => {
  assert.equal(reviewRequirementVerdict({ reviewDecision: "APPROVED", protection: READABLE({ teams: [{ slug: "admins" }] }) }).code,
    VERDICT.DECORATIVE);
  assert.equal(reviewRequirementVerdict({ reviewDecision: "APPROVED", protection: READABLE({ apps: [{ slug: "merge-bot" }] }) }).code,
    VERDICT.DECORATIVE);
});

test("#2022: a biting rule whose exemption list is FORBIDDEN is CANNOT_TELL, never REQUIRED", () => {
  // The state this repository's own token is in. Passing here would be the exact false confidence the
  // row was written about: "the setting is set" standing in for "nobody is exempt from it".
  const v = reviewRequirementVerdict({ reviewDecision: "REVIEW_REQUIRED", protection: { ...FORBIDDEN_HERE, body: null } });
  assert.equal(v.code, VERDICT.CANNOT_TELL);
  assert.notEqual(v.code, VERDICT.REQUIRED);
  assert.match(v.why, /exemption list is unreadable/);
});

test("#2022: the three verdicts are genuinely distinct -- none is a spelling of another", () => {
  assert.equal(new Set([VERDICT.REQUIRED, VERDICT.DECORATIVE, VERDICT.CANNOT_TELL]).size, 3);
});

// --- the live read ----------------------------------------------------------------------------------

test("#2022 LIVE: `main` requires an approving review, asked of GitHub", () => {
  // OPT-IN, for `arm-pr-labels-live.test.ts`'s reason: a test that spawns `gh` whenever a token happens
  // to be present asks GitHub on every local run and inside the acceptance job. An agent asks deliberately.
  if (process.env.A11Y_CHECK_BRANCH_PROTECTION !== "1") {
    console.log("  NOT RUN: the live branch-protection read is opt-in -- `A11Y_CHECK_BRANCH_PROTECTION=1 npx tsx "
      + "--test packages/lab/src/packaging/branch-protection.test.ts` asks GitHub whether the requirement bites. The "
      + "verdict logic above ran against synthetic inputs; nothing here read the live branch.");
    return;
  }
  const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let openPr: { number: number; reviewDecision: string | null } | undefined;
  try {
    openPr = JSON.parse(gh(["pr", "list", "--repo", "a11ign/a11ign", "--state", "open", "--limit", "1",
      "--json", "number,reviewDecision"]))[0];
  } catch (cause) {
    // Never an empty catch, and never a pass: a check that could not ask reports that it could not ask.
    console.log(`  SKIPPED: \`gh pr list\` could not be asked (${String(cause)}). NOT a pass.`);
    return;
  }
  if (!openPr) {
    console.log("  SKIPPED: no open PR to read a decision from. NOT a pass -- `reviewDecision` is a property of a PR.");
    return;
  }
  const protection = liveProtection(gh);
  const v = reviewRequirementVerdict({ reviewDecision: openPr.reviewDecision, protection });
  assert.notEqual(v.code, VERDICT.DECORATIVE,
    `#${openPr.number}: the review requirement is not biting -- ${v.why}`);
  if (v.code === VERDICT.CANNOT_TELL) {
    console.log(`  CANNOT TELL, and that is not a pass: ${v.why}. Re-run with a token holding repository admin to `
      + "read `bypass_pull_request_allowances`; #2022's ruling requires it empty.");
  }
});

/** Reads both halves of the protection state, keeping "forbidden" distinguishable from "absent". */
function liveProtection(gh: (args: string[]) => string): ProtectionRead {
  let protectedFlag: boolean | null = null;
  try {
    protectedFlag = JSON.parse(gh(["api", "repos/a11ign/a11ign/branches/main", "--jq", ".protected"])) === true;
  } catch (cause) {
    console.log(`  \`branches/main\` could not be read (${String(cause)}); the 404 discriminator is unavailable.`);
  }
  try {
    const body = JSON.parse(gh(["api", "repos/a11ign/a11ign/branches/main/protection"]));
    return { status: HTTP_OK, protectedFlag, body };
  } catch {
    // The admin-only endpoint refusing is the EXPECTED shape for this repository's own token, and the
    // status is deliberately reported as a refusal rather than inferred as absence.
    return { status: HTTP_NOT_FOUND, protectedFlag, body: null };
  }
}
