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
 * THE BEHAVIOURAL READ IS `reviewDecision`, AND IT WAS WATCHED CHANGING.
 * GitHub computes no review decision at all when the base branch requires none. Measured 2026-09-22T23:05Z
 * at `6eac64880`, BEFORE the requirement was applied, on #1968 -- the PR whose real approving review met
 * #1761's clearing condition:
 *
 *     $ gh pr view 1968 --json reviewDecision,reviews
 *     {"reviewDecision":"","states":["CHANGES_REQUESTED","CHANGES_REQUESTED","APPROVED"]}
 *
 * Three reviews, one of them APPROVED, and an EMPTY decision: the reviews existed and decided nothing.
 * Re-read at 2026-09-23T00:05Z, AFTER the requirement went live, the same PR reads `APPROVED`, and every
 * PR on the first page carries a decision where all of them were empty an hour earlier. The field is not
 * merely the one this pin argues for -- it is the one that actually moved, and it needs no admin rights.
 *
 * WHAT THIS TOKEN CANNOT SEE, IT SAYS SO ABOUT. Measured the same night, as `a11ign-ai-workers`:
 * `repos/a11ign/a11ign.permissions.admin` is `false`, and `branches/main/protection` answers 404 while
 * `branches/main.protected` answers `true`. The row names that trap by hand -- a 404 means absent OR
 * forbidden -- and here it is demonstrably FORBIDDEN. `branches/main.protected` is the discriminator,
 * because it needs no admin. A verdict that cannot see the exemption list must be CANNOT_TELL, loudly,
 * and never a pass: that is the whole of "distinguish them or fail loudly".
 *
 * AND THE ONE THING THAT RULE COST, CORRECTED 2026-09-23. Refusing to read an ABSENT
 * `bypass_pull_request_allowances` as an empty one made `REQUIRED` unreachable on every token and every
 * configuration -- a guard with no green state at all. `ceo` read the live body at admin level on both
 * sides of the change and settled it (#2022, comment 5787499206); `exemptIdentities` carries the
 * before/after, the flipped test carries why it is kept, and the foot of this file records the sibling key
 * where the same absence still means "you may not look".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/** A requirement is only REQUIRED when it bites AND exempts nobody; anything unreadable is its own state. */
const VERDICT = { REQUIRED: "REQUIRED", DECORATIVE: "DECORATIVE", CANNOT_TELL: "CANNOT_TELL" } as const;
type Code = (typeof VERDICT)[keyof typeof VERDICT];

/**
 * A SEPARATE VOCABULARY, because the first version of this file reused `VERDICT.REQUIRED` to mean "the
 * protection object was readable" and the caller then treated every non-`CANNOT_TELL` read as a success.
 * An `ABSENT` read fell straight through to `REQUIRED`: an UNPROTECTED branch reported as protected.
 * Found in review of #2045 at `48ef0d20`, with the mutation that proves it below.
 */
const READ = { READABLE: "READABLE", ABSENT: "ABSENT", CANNOT_TELL: "CANNOT_TELL" } as const;

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

type ProtectionRead = {
  /** Status from `GET /repos/{o}/{r}/branches/main/protection` -- admin-only, so often 404 here. */
  status: number;
  /** `.protected` from `GET /repos/{o}/{r}/branches/main` -- readable by any token that can read the repo. */
  protectedFlag: boolean | null;
  /** The protection body when status is 200, else null. */
  body: ProtectionBody | null;
};
type ProtectionBody = {
  required_pull_request_reviews?: ReviewRule;
  /** Present in every protection body GitHub returns; disabled, it exempts every repository admin. */
  enforce_admins?: { enabled?: boolean };
};
type BypassAllowances = { users?: unknown[]; teams?: unknown[]; apps?: unknown[] };
type ReviewRule = { required_approving_review_count?: number; bypass_pull_request_allowances?: BypassAllowances };

/**
 * THE 404 TRAP, AS A FUNCTION. Absent and forbidden are the same status code, and only
 * `branches/main.protected` tells them apart without admin. Reading 404 as "unprotected" is the failure
 * the row forbids by name.
 */
function protectionReadVerdict({ status, protectedFlag }: Pick<ProtectionRead, "status" | "protectedFlag">) {
  if (status === HTTP_OK) return { code: READ.READABLE, why: "the protection object was readable" };
  if (status !== HTTP_NOT_FOUND && status !== HTTP_FORBIDDEN) {
    return { code: READ.CANNOT_TELL, why: `the protection endpoint answered ${status}, which is neither a read nor a refusal` };
  }
  if (protectedFlag === true) {
    return { code: READ.CANNOT_TELL,
      why: `the protection endpoint answered ${status} but \`branches/main.protected\` is true: FORBIDDEN to this token, NOT absent` };
  }
  if (protectedFlag === false) {
    return { code: READ.ABSENT,
      why: "`branches/main.protected` is false: main carries no protection at all" };
  }
  return { code: READ.CANNOT_TELL,
    why: `the protection endpoint answered ${status} and \`branches/main.protected\` could not be read either` };
}

/**
 * Everyone named here may merge without the approval the rule demands.
 *
 * AN ABSENT `bypass_pull_request_allowances` IS AN EMPTY LIST -- MEASURED, NOT ASSUMED, AND ONLY ON A 200.
 * This function is reached only from a `READ.READABLE` body, which is what makes that safe to say. It was
 * `CANNOT_TELL` until 2026-09-23, correctly, because no session here could read a live body; the
 * consequence was a guard that could not pass on ANY token or configuration -- non-admin stops at the
 * forbidden-404, admin stopped here, and a 200 with the key absent is the CORRECT fully-configured state.
 * `ceo` read the same endpoint at admin level on both sides of the change (#2022, comment 5787499206):
 *
 *     2026-09-22  bypass_pull_request_allowances : users=[DanBeckDev], teams=[], apps=[]   # key PRESENT
 *     2026-09-23  {"bypass":null,"count":1,"has_bypass_key":false}                         # key ABSENT
 *
 * Same repo, same endpoint, same permission level: GitHub emits the key when an actor is configured and
 * omits it when none is. So absence here is the CLEARED state, not an unknown one. This is a narrow
 * exception to this repository's `absence vs broken` rule, and it is narrow because it is measured on both
 * sides -- contrast the ruleset's `bypass_actors`, whose absence is permission-dependent and therefore
 * still unreadable; see "the other exemption surfaces" at the foot of this file.
 */
function exemptIdentities(reviews: ReviewRule): string[] {
  const allow = reviews.bypass_pull_request_allowances ?? {};
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
  // EVERY non-readable outcome is handled by name. The first version tested only for CANNOT_TELL and let
  // ABSENT fall through to REQUIRED, which reported an unprotected branch as protected.
  if (read.code === READ.CANNOT_TELL) {
    return { code: VERDICT.CANNOT_TELL as Code,
      why: `the rule bites (reviewDecision=${reviewDecision}) but the exemption list is unreadable: ${read.why}` };
  }
  if (read.code === READ.ABSENT) {
    return { code: VERDICT.DECORATIVE as Code, why: `${read.why}, so nothing requires a review` };
  }
  return reviewRuleVerdict(protection.body, reviewDecision);
}

/** The readable-protection half: the rule must exist, demand at least one approval, and exempt nobody. */
function reviewRuleVerdict(body: ProtectionBody | null, reviewDecision: string) {
  const reviews = body?.required_pull_request_reviews;
  if (!reviews) {
    return { code: VERDICT.DECORATIVE as Code,
      why: "the protection object carries no `required_pull_request_reviews` at all, so no approval is required" };
  }
  const count = reviews.required_approving_review_count ?? 0;
  if (count < 1) {
    return { code: VERDICT.DECORATIVE as Code,
      why: `\`required_approving_review_count\` is ${count}: the rule exists and demands nothing` };
  }
  const exempt = exemptIdentities(reviews);
  if (exempt.length > 0) {
    return { code: VERDICT.DECORATIVE as Code,
      why: `the rule bites but these identities bypass it: ${exempt.join(", ")}` };
  }
  return adminEnforcementVerdict(body, `reviewDecision=${reviewDecision}, and no identity is exempt`);
}

/**
 * THE SECOND EXEMPTION SURFACE IN THE SAME BODY, so it costs no extra call: with `enforce_admins`
 * disabled, every repository admin bypasses the review requirement without appearing in any allowance
 * list. `ceo` asked for it pinned "only if cheap" (#2022, comment 5787499206) -- this one is, because it
 * arrives in the read that is already being made. Measured on the live body 2026-09-23: `{"enabled":true}`.
 *
 * Its ABSENCE is NOT read as emptiness, and that is not a contradiction of `exemptIdentities` above: the
 * before/after measurement that licenses absence-as-cleared exists for `bypass_pull_request_allowances`
 * and does not exist for this key, which GitHub returns in every protection body it has ever served here.
 * An absent one is a shape nobody has seen, so it is `CANNOT_TELL` rather than a guess in either direction.
 */
function adminEnforcementVerdict(body: ProtectionBody, why: string) {
  const enforceAdmins = body.enforce_admins;
  if (!enforceAdmins || typeof enforceAdmins.enabled !== "boolean") {
    return { code: VERDICT.CANNOT_TELL as Code,
      why: "`enforce_admins` is missing from a readable protection body -- GitHub always returns it, so this "
        + "is an unrecognised body rather than a cleared field, and admins may or may not be exempt" };
  }
  if (!enforceAdmins.enabled) {
    return { code: VERDICT.DECORATIVE as Code,
      why: "`enforce_admins` is disabled: every repository admin bypasses the rule without being named in "
        + "any allowance list -- the exemption surface that carries no identities to print" };
  }
  return { code: VERDICT.REQUIRED as Code, why: `${why}, with \`enforce_admins\` enabled` };
}

// --- the 404 trap -----------------------------------------------------------------------------------

const FORBIDDEN_HERE = { status: HTTP_NOT_FOUND, protectedFlag: true };

test("#2022: 404 with `protected: true` is FORBIDDEN, never read as unprotected -- the measured shape", () => {
  // This is not hypothetical: it is exactly what `a11ign-ai-workers` reads, the token every session and
  // the CI job here authenticates as. If this collapsed to "unprotected" the pin would report the
  // requirement missing on every ordinary run, forever.
  const v = protectionReadVerdict(FORBIDDEN_HERE);
  assert.equal(v.code, READ.CANNOT_TELL);
  assert.notEqual(v.code, READ.ABSENT, "the trap the row forbids by name");
  assert.match(v.why, /FORBIDDEN to this token, NOT absent/);
});

test("#2022: 404 with `protected: false` IS absent, and says so -- the other half of the discriminator", () => {
  // The positive control for the test above: if `protectedFlag` could never be false, CANNOT_TELL would
  // be the only reachable answer and the discriminator would be decorative itself.
  const v = protectionReadVerdict({ status: HTTP_NOT_FOUND, protectedFlag: false });
  assert.equal(v.code, READ.ABSENT);
  assert.match(v.why, /no protection at all/);
});

test("#2022: 403 is treated exactly as 404 -- GitHub uses both for a refusal", () => {
  assert.equal(protectionReadVerdict({ status: HTTP_FORBIDDEN, protectedFlag: true }).code, READ.CANNOT_TELL);
});

test("#2022: a 404 with NEITHER endpoint readable is CANNOT_TELL, not a guess in either direction", () => {
  const v = protectionReadVerdict({ status: HTTP_NOT_FOUND, protectedFlag: null });
  assert.equal(v.code, READ.CANNOT_TELL);
  assert.match(v.why, /could not be read either/);
});

test("#2022: an unexpected status is its own CANNOT_TELL rather than falling through to a read", () => {
  const v = protectionReadVerdict({ status: 500, protectedFlag: true });
  assert.equal(v.code, READ.CANNOT_TELL);
  assert.match(v.why, /neither a read nor a refusal/);
});

// --- the behavioural judgement ----------------------------------------------------------------------

const READABLE = (allow: BypassAllowances = {}, count = 1): ProtectionRead => ({
  status: HTTP_OK, protectedFlag: true,
  body: {
    required_pull_request_reviews: { required_approving_review_count: count, bypass_pull_request_allowances: allow },
    enforce_admins: { enabled: true },
  },
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

test("#2045 BLOCKER: a READABLE-but-ABSENT protection is DECORATIVE, never REQUIRED", () => {
  // The review finding. `protectionReadVerdict` answering ABSENT used to fall through the single
  // CANNOT_TELL check and return REQUIRED: an UNPROTECTED branch reported as protected, with a biting
  // `reviewDecision` supplying the only evidence. Every non-readable code is now handled by name.
  const v = reviewRequirementVerdict({ reviewDecision: "REVIEW_REQUIRED",
    protection: { status: HTTP_NOT_FOUND, protectedFlag: false, body: null } });
  assert.equal(v.code, VERDICT.DECORATIVE);
  assert.notEqual(v.code, VERDICT.REQUIRED, "an unprotected branch must never read as protected");
  assert.match(v.why, /nothing requires a review/);
});

test("#2045 BLOCKER: a readable body with NO `required_pull_request_reviews` is DECORATIVE", () => {
  const v = reviewRequirementVerdict({ reviewDecision: "APPROVED",
    protection: { status: HTTP_OK, protectedFlag: true, body: {} } });
  assert.equal(v.code, VERDICT.DECORATIVE);
  assert.match(v.why, /no `required_pull_request_reviews` at all/);
});

test("#2045 BLOCKER: `required_approving_review_count: 0` is DECORATIVE -- the pre-change field value", () => {
  // The exact state `ceo` measured on 2026-09-22: the mechanism configured, the count at zero.
  const v = reviewRequirementVerdict({ reviewDecision: "APPROVED", protection: READABLE({ users: [] }, 0) });
  assert.equal(v.code, VERDICT.DECORATIVE);
  assert.match(v.why, /demands nothing/);
});

test("#2045 ROUND 2: an ABSENT `bypass_pull_request_allowances` on a 200 body is an EMPTY list -- measured", () => {
  // THIS TEST IS THE RECORD OF A MEASUREMENT, AND IT IS KEPT WITH ITS VERDICT FLIPPED RATHER THAN DELETED.
  // Until 2026-09-23 it asserted CANNOT_TELL, and that was right: no session here held a token that could
  // read a live protection body, so "GitHub omits the key when nobody may bypass" was documentation rather
  // than an observation. The cost of being right about it was a guard REQUIRED could not be reached on --
  // non-admin stops at the forbidden-404, admin stopped here, and this shape IS the fully-configured one.
  // `ceo` then read the same endpoint at admin level on both sides of the change: the key present with
  // `DanBeckDev` in it on 09-22, absent entirely on 09-23 with the count still 1. Absence here is the
  // CLEARED state. The narrowness matters -- see `exemptIdentities`, and the foot of this file for the
  // sibling key whose absence is still NOT emptiness because nobody has the same before/after for it.
  const v = reviewRequirementVerdict({ reviewDecision: "APPROVED",
    protection: { status: HTTP_OK, protectedFlag: true,
      body: { required_pull_request_reviews: { required_approving_review_count: 1 }, enforce_admins: { enabled: true } } } });
  assert.equal(v.code, VERDICT.REQUIRED);
  assert.notEqual(v.code, VERDICT.CANNOT_TELL, "the state this guard exists to certify must be reachable");
  assert.match(v.why, /no identity is exempt/);
});

test("#2045 ROUND 2: absence is emptiness ONLY on a 200 -- a forbidden read with the key absent is still CANNOT_TELL", () => {
  // The positive control for the narrowness. `exemptIdentities` reads absence as emptiness because its
  // only caller is the readable-body path; if that changed, this is the assertion that goes red.
  const v = reviewRequirementVerdict({ reviewDecision: "APPROVED", protection: { ...FORBIDDEN_HERE, body: null } });
  assert.equal(v.code, VERDICT.CANNOT_TELL);
  assert.notEqual(v.code, VERDICT.REQUIRED, "a body nobody could read must never certify an empty allowance list");
});

test("#2045 ROUND 2: `enforce_admins` disabled is DECORATIVE -- the exemption surface that names nobody", () => {
  // The second surface in the same body, so pinning it costs no extra call. An allowance list can be
  // empty while every admin walks past the rule, and this is the one hole with no identity to print.
  const v = reviewRequirementVerdict({ reviewDecision: "REVIEW_REQUIRED",
    protection: { status: HTTP_OK, protectedFlag: true,
      body: { required_pull_request_reviews: { required_approving_review_count: 1, bypass_pull_request_allowances: { users: [] } },
        enforce_admins: { enabled: false } } } });
  assert.equal(v.code, VERDICT.DECORATIVE);
  assert.notEqual(v.code, VERDICT.REQUIRED, "an empty allowance list is not the whole of `exempts nobody`");
  assert.match(v.why, /every repository admin bypasses the rule/);
});

test("#2045 ROUND 2: a MISSING `enforce_admins` is CANNOT_TELL -- absence is only emptiness where it was measured", () => {
  // Deliberately NOT the rule applied to `bypass_pull_request_allowances` above. GitHub returns this key
  // in every protection body read here, so a body without it is unrecognised rather than cleared, and
  // there is no before/after to license reading it either way.
  const v = reviewRequirementVerdict({ reviewDecision: "APPROVED",
    protection: { status: HTTP_OK, protectedFlag: true,
      body: { required_pull_request_reviews: { required_approving_review_count: 1 } } } });
  assert.equal(v.code, VERDICT.CANNOT_TELL);
  assert.match(v.why, /always returns it/);
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
  // CANNOT_TELL FAILS HERE, and that is the point. An earlier version asserted only `!== DECORATIVE`, so
  // the one state this repository's own token actually reaches -- the exemption list forbidden -- exited
  // green and the pin established nothing about `bypass_pull_request_allowances`. #2022 requires it empty,
  // and "I could not look" is not "it is empty". Satisfying this needs a token with repository admin,
  // which is a true statement about the requirement rather than a limitation of the test.
  assert.equal(v.code, VERDICT.REQUIRED,
    `#${openPr.number}: ${v.why}.${v.code === VERDICT.CANNOT_TELL
      ? " Re-run with a token holding repository admin -- this session's `a11ign-ai-workers` has `permissions.admin: false`." : ""}`);
  // A pass prints WHAT it read. `ok 21` alone is indistinguishable from a check that asked nothing, and
  // this row is about a guard whose green run nobody had seen: the line below is what gets quoted.
  console.log(`  LIVE PASS on #${openPr.number}: ${v.why}`);
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

/**
 * THE OTHER EXEMPTION SURFACES, AND WHY ONLY ONE OF THE TWO IS PINNED HERE.
 *
 * `ceo` asked for `enforce_admins` and the `merge-queue-main` ruleset's `bypass_actors` pinned "only if
 * cheap" (#2022, comment 5787499206). `enforce_admins` is cheap and is pinned above: it arrives inside the
 * protection body this guard already reads, so it costs no call and one branch.
 *
 * THE RULESET'S `bypass_actors` IS NOT, AND THE REASON IS A MEASUREMENT RATHER THAN AN ESTIMATE OF EFFORT.
 * Read on 2026-09-23 against the same ruleset, seconds apart, by two identities:
 *
 *     as `DanBeckDev`        (admin:true)   {"bypass":[],"enforcement":"active","rules":["merge_queue"]}
 *     as `a11ign-ai-workers` (admin:false)  has("bypass_actors") => false        # the key is ABSENT
 *
 * So on THIS key absence is permission-dependent: it means "empty" to one token and "you may not see it"
 * to another, from the same object at the same moment. That is the exact opposite of the
 * `bypass_pull_request_allowances` finding above, where absence was measured as the cleared state at a
 * FIXED permission level on both sides of a real change. Pinning it would put two contradictory absence
 * rules in one guard, keyed on the token rather than on the field -- the shape this whole file exists to
 * refuse. Doing it properly means a third read (`GET /repos/{o}/{r}/rulesets/{id}` plus a permission probe
 * to interpret a missing key), which is a widening, so per `ceo`'s own "say so and I will take it as a
 * follow-up row" it is left out and reported on #2045 instead.
 *
 * What IS readable without admin, and is the likely shape of that follow-up: the same object carries
 * `current_user_can_bypass` (`"never"` for `a11ign-ai-workers` on 2026-09-23), which answers the exemption
 * question per identity and needs no admin at all. It answers it about the `merge_queue` rule, which is
 * the only rule this ruleset carries -- the review requirement lives in classic branch protection, not
 * here -- so it is not a substitute for the read above, only a cheaper instrument for a different row.
 */
