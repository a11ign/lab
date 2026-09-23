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
 *
 * ------------------------------------------------------------------------------------------------------
 * #2086: THE SAME REQUIREMENT NOW HAS A SECOND SURFACE, AND THIS FILE READS BOTH.
 *
 * Everything above reaches a pass only on a token holding repository admin, which no session and no CI job
 * here holds. `ceo` ruled on 2026-09-23 (#2086) and made the edit personally, because creating it needs
 * the very permission the row exists to route around: `merge-queue-main` now carries a `pull_request` rule
 * with `required_approving_review_count: 1` beside its `merge_queue` rule, and that object IS readable by
 * `a11ign-ai-workers`.
 *
 * THE RULING WAS **ADD, NOT SWAP**, and its reason is the part worth keeping: the row assumed a second
 * surface meant a second place to be exempt. It does not. **Requirements compose and exemptions do not** --
 * classic protection and rulesets are evaluated together and the most restrictive applies, so an identity
 * must be exempt in BOTH to merge without a review. The ruleset rule therefore cannot open a hole, only
 * close one, and classic `required_pull_request_reviews` STAYS as the authoritative read: it is the only
 * surface whose exemption list can be ENUMERATED rather than merely queried for one identity.
 *
 * SO THE TWO HALVES OF THIS FILE ANSWER DIFFERENT QUESTIONS AND MUST NEVER BE COLLAPSED. `VERDICT.REQUIRED`
 * above means "the rule bites and NOBODY is exempt" and needs admin. `BINDING.BINDS_ME` below means "the
 * rule applies and I cannot bypass it" and needs nothing -- it is strictly weaker, named so it cannot be
 * quoted as the stronger claim, and a test pins that no member of one vocabulary equals `REQUIRED`.
 * What CI can now catch that no unattended check could catch before: the requirement being dropped
 * entirely, or the CI identity itself acquiring a bypass. What it still cannot catch: a THIRD PARTY
 * gaining one. That asymmetry is the honest summary, and the full reasoning is at `BINDING` below.
 *
 * ------------------------------------------------------------------------------------------------------
 * #2086 done-when #1 -- THE CANONICAL WORDING OF THE LIMITATION, and the reason it is recorded HERE.
 *
 * The row asked for this reason to be written into `.claude/rules/agent-practices.md` as well. It is not,
 * and the ruling that says so is worth keeping beside it: `ceo` left the choice to `product-manager`, who
 * dropped the clause on 2026-09-23T09:22Z because WHAT IS BEING RECORDED IS A GUARD'S LIMITATION, whose
 * reader is whoever runs the guard. The rules file carries what a session needs in order to ACT. There IS a
 * rules-file consequence -- the shipped "`main` REQUIRES an approving review" section names
 * `bypass_pull_request_allowances` as THE exemption instrument, and after `ceo`'s edit the requirement
 * lives on two surfaces and that paragraph knows one -- and it is filed as #2093, blocked by this row so
 * that it can quote the four sentences below rather than reword them twice.
 *
 * A SESSION OR A CI JOB ASKING "IS THE REVIEW REQUIREMENT STILL THERE" MUST PICK ITS INSTRUMENT BY WHAT IT
 * HOLDS, AND SAY WHICH IT USED:
 *
 *   - WITH REPOSITORY ADMIN: `branches/main/protection`, via `A11Y_CHECK_BRANCH_PROTECTION=1`. It is the
 *     only surface whose exemption list can be ENUMERATED, so it is the only one that can answer "nobody is
 *     exempt". It remains the authoritative read and the complete instrument.
 *   - WITHOUT ADMIN -- every session and every CI job here: `rules/branches/main` plus `rulesets/{id}`, via
 *     `A11Y_CHECK_MAIN_RULESET=1`. It answers the exemption question FOR THE ASKING IDENTITY ONLY.
 *     `current_user_can_bypass: "never"` means "I am bound". It does NOT mean "nobody is exempt", and
 *     `bypass_actors` -- the field that could say -- is withheld from a token without write access to the
 *     ruleset, its absence meaning "you may not look" rather than "the list is empty".
 *
 * So a green run of the cheap instrument is evidence that the requirement EXISTS and that the runner cannot
 * walk past it. Quoting it as evidence that nobody can walk past it is the overclaim #2022 exists to
 * prevent, and it does not become acceptable by being cheap.
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
type ReviewRule = { required_approving_review_count?: number; bypass_pull_request_allowances?: BypassAllowances;
  /** #2084: whether an approving review survives a push. Classic protection's half of the pair. */
  dismiss_stale_reviews?: boolean };

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
 * sides AT A FIXED PERMISSION LEVEL -- the permission held still and the key moved.
 *
 * THE SIBLING KEY WHOSE ABSENCE MEANS THE OPPOSITE, and why one guard may hold both rules (#2119). The
 * ruleset's `bypass_actors` was measured the other way round: one object, one moment, two permission
 * levels, key present to one and absent to the other. So absence there is the view being WITHHELD, and
 * `bypassActorsVerdict` below refuses to clear on it. Neither rule is a general rule about absence -- each
 * is keyed on ITS OWN FIELD's measurement, which is what stops the pair being a contradiction. Keying
 * either on the TOKEN would be the contradiction, and is what that verdict's own tests forbid.
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

/** The one `gh` shell-out every live read here goes through. It throws; each caller catches by name. */
const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

test("#2022 LIVE: `main` requires an approving review, asked of GitHub", () => {
  // OPT-IN, for `arm-pr-labels-live.test.ts`'s reason: a test that spawns `gh` whenever a token happens
  // to be present asks GitHub on every local run and inside the acceptance job. An agent asks deliberately.
  if (process.env.A11Y_CHECK_BRANCH_PROTECTION !== "1") {
    console.log("  NOT RUN: the live branch-protection read is opt-in -- `A11Y_CHECK_BRANCH_PROTECTION=1 npx tsx "
      + "--test packages/lab/src/packaging/branch-protection.test.ts` asks GitHub whether the requirement bites. The "
      + "verdict logic above ran against synthetic inputs; nothing here read the live branch.");
    return;
  }
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

// --- #2086: the same requirement, read by a token that holds no admin -------------------------------

/**
 * #2086: THE SECOND SURFACE, AND WHY ITS VERDICT IS DELIBERATELY WEAKER THAN THE ONE ABOVE.
 *
 * Everything above needs repository admin to reach a pass, because the question "is anyone exempt" is
 * answered by `bypass_pull_request_allowances`, and that endpoint 404s at `a11ign-ai-workers` -- the
 * identity every session and the CI job here authenticates as. `ceo`'s 2026-09-23 ruling on #2086 adds a
 * `pull_request` rule to the `merge-queue-main` ruleset so the SAME requirement is also readable without
 * admin, and rules "ADD, do not SWAP": classic protection stays and remains the authoritative read.
 *
 * THE RULING'S REASON, BECAUSE IT INVERTS WHAT THE ROW ASSUMED. The row treated a second surface as a
 * second place to be exempt. It is not: requirements COMPOSE and exemptions do NOT -- classic protection
 * and rulesets are evaluated together and the most restrictive applies, so an identity must be exempt in
 * BOTH to merge without a review. Adding the ruleset rule cannot open a hole, only close one.
 *
 * WHAT THIS BUYS, AND WHAT IT DOES NOT -- `ceo`'s own summary, kept verbatim because a reader who takes
 * this check for more than it is has recreated the failure #2022 exists to prevent:
 *
 *     Both surfaces already bind everyone, so the edit buys a READABLE surface, not a stricter one. What
 *     CI can now catch that no unattended check could catch before: the requirement being dropped
 *     entirely, or the CI identity itself acquiring a bypass. What it still cannot catch: a THIRD PARTY
 *     gaining one. That asymmetry is the honest summary.
 *
 * SO THIS VERDICT REPORTS EXACTLY TWO THINGS and says so in its own name: a `pull_request` rule requiring
 * at least one approval applies to `main`, and `current_user_can_bypass` is `"never"` FOR THE IDENTITY
 * RUNNING THE CHECK. It CANNOT enumerate who else is exempt. `bypass_actors` is the field that could, and
 * GitHub documents it as returned "only if the user making the API request has write access to the
 * ruleset" -- measured here as present-and-`[]` to `DanBeckDev` and ABSENT to `a11ign-ai-workers`, from
 * the same object at the same moment. The COMPLETE read is still the admin-only opt-in command above.
 * `BINDS_ME` is named the way it is so that no future reader can quote it as `REQUIRED`.
 *
 * THE MEASUREMENT `ceo` ASKED FOR, AND THE ANSWER, WHICH IS "NOT KNOWABLE HERE" (#2086 ruling, §3).
 * The ruling asked whether `rules/branches/{branch}` OMITS rules the calling identity can bypass -- if it
 * did, the rule's mere presence in that list would assert existence AND non-bypassability in one
 * observation. Two independent checks say do not lean on it:
 *
 *   1. MEASURED 2026-09-23, both identities, same minute -- and NON-DISCRIMINATING, which is the finding:
 *          as `DanBeckDev`        (admin:true)   rules/branches/main => ["merge_queue","pull_request"]
 *          as `a11ign-ai-workers` (admin:false)  rules/branches/main => ["merge_queue","pull_request"]
 *      Identical, but `bypass_actors` is `[]`, so NEITHER identity can bypass and both readings are
 *      consistent with either hypothesis. The experiment has no discriminating power at this
 *      configuration, and manufacturing one would mean granting a live bypass on `main`.
 *   2. GitHub's OpenAPI description of the endpoint is SILENT on identity: "All active rules that apply
 *      will be returned, regardless of the level at which they are configured... Rules in rulesets with
 *      'evaluate' or 'disabled' enforcement statuses are not returned." Enforcement status is the only
 *      documented filter.
 *
 * So the guard does NOT lean on it: presence proves EXISTENCE only, and `current_user_can_bypass` carries
 * the whole exemption claim on its own -- the "if false" arm of the ruling, recorded as asked.
 */
const BINDING = {
  /** The rule exists, demands an approval, and THIS identity cannot bypass it. Never a claim about others. */
  BINDS_ME: "BINDS_ME",
  /** No `pull_request` rule applies to `main` at all. */
  ABSENT: "ABSENT",
  /** One applies and asks for nothing, or its ruleset is not enforced. */
  DECORATIVE: "DECORATIVE",
  /** It applies and bites, and this identity walks past it. */
  EXEMPT: "EXEMPT",
  /** One of the two facts could not be read. Never a pass. */
  CANNOT_TELL: "CANNOT_TELL",
} as const;
type BindingCode = (typeof BINDING)[keyof typeof BINDING];

type BranchRule = { type?: string; ruleset_id?: number; parameters?: { required_approving_review_count?: number;
  /** #2084: the RULESET's half of the same pair, and a DIFFERENT FIELD -- see `STALENESS` below. */
  dismiss_stale_reviews_on_push?: boolean } };
type RulesetMeta = {
  /** `enforcement` of ONE ruleset: "active" | "evaluate" | "disabled"; null when unreadable. */
  enforcement: string | null;
  /** `current_user_can_bypass`: "always" | "pull_requests_only" | "never" | "exempt"; null when unreadable. */
  canBypass: string | null;
  /**
   * #2119: `bypass_actors`'s PRESENCE and value, taken from the same object, so it costs no extra call.
   *
   * OPTIONAL, AND READ BY NOTHING IN THE BINDING VERDICT BELOW -- which is the point rather than an
   * omission. It answers "who ELSE is exempt", and `BINDS_ME` must never claim that; feeding it in would
   * drop the CI identity, which can never read the field, from `BINDS_ME` to `CANNOT_TELL` and take the
   * unattended check down with it. Synthetic binding fixtures leave it out and get the same verdict.
   */
  exemptions?: ExemptionRead | null;
};
type RulesetBinding = {
  /** `GET /repos/{o}/{r}/rules/branches/main` -- any token that can read the repo; null when unreadable. */
  branchRules: BranchRule[] | null;
  /**
   * Keyed by `ruleset_id`: one entry per contributing ruleset that was actually read.
   *
   * A MISSING ENTRY IS NOT AN EMPTY ONE, and this is the third absence rule in this file, decided the same
   * way as the other two: nobody has measured what a missing ruleset read means, so it is CANNOT_TELL. A
   * `pull_request` rule whose ruleset is absent from this map is a rule whose binding state was never
   * examined, and the verdict below fails closed on it.
   */
  rulesets: Record<number, RulesetMeta>;
};

/** The only value that means "this identity is bound"; every other value, known or not, means it is not. */
const NOT_BYPASSABLE = "never";

/** Existence and strength, from the branch-keyed endpoint. Most restrictive wins, as requirements compose. */
function ruleAppliesVerdict({ branchRules, rulesets }: RulesetBinding) {
  if (branchRules === null) {
    return { code: BINDING.CANNOT_TELL as BindingCode,
      why: "`rules/branches/main` could not be read, so nothing is known about which rules apply" };
  }
  const prRules = branchRules.filter((r) => r.type === "pull_request");
  if (prRules.length === 0) {
    return { code: BINDING.ABSENT as BindingCode,
      why: "no `pull_request` rule applies to `main`: the ruleset surface requires no approval -- the pre-#2086 shape" };
  }
  return strongestBinding(prRules.map((rule) => contributingRuleVerdict(rule, rulesets)));
}

/**
 * ONE RULE, JUDGED AGAINST ITS OWN RULESET -- the #2090 review blocker, and why it was a real defect.
 *
 * The first version took the count from `Math.max` over EVERY contributing `pull_request` rule and the
 * exemption state from whichever ruleset happened to serve the FIRST of them. GitHub documents that several
 * rulesets can contribute rules to one branch, and the branch-keyed endpoint returns all of them, so those
 * two halves could come from different rulesets: a rule demanding 5 approvals inside an `evaluate` ruleset,
 * printed as binding because an unrelated `active` ruleset's rule happened to be listed first. It was also
 * ORDER-DEPENDENT -- the same two rulesets in the other order produced a different verdict -- which is the
 * fingerprint of the bug and what the tests below pin.
 *
 * A rule binds ME only if ITS OWN ruleset is `active` AND ITS OWN `current_user_can_bypass` is `never`.
 * Nothing about one ruleset may be attributed to another.
 */
function contributingRuleVerdict(rule: BranchRule, rulesets: Record<number, RulesetMeta>) {
  const count = rule.parameters?.required_approving_review_count;
  if (typeof count !== "number") {
    // Deliberately NOT read as zero. GitHub returns this parameter on every `pull_request` rule seen here,
    // so a rule without it is an unrecognised shape rather than a cleared field -- the same discipline
    // `enforce_admins` gets above, and for the same reason: nobody has measured the absent case.
    return { code: BINDING.CANNOT_TELL as BindingCode, required: 0,
      why: "a `pull_request` rule carries no `required_approving_review_count` -- an unrecognised shape, not a cleared field" };
  }
  const why = `a \`pull_request\` rule requires ${count} approval(s) on \`main\``;
  if (count < 1) {
    return { code: BINDING.DECORATIVE as BindingCode, required: count,
      why: `the \`pull_request\` rule applies and asks for ${count} approvals: it exists and demands nothing` };
  }
  const meta = rule.ruleset_id === undefined ? undefined : rulesets[rule.ruleset_id];
  if (meta === undefined) {
    return { code: BINDING.CANNOT_TELL as BindingCode, required: count,
      why: `${why}, but the ruleset serving it (${rule.ruleset_id ?? "the rule carries no `ruleset_id`"}) was never`
        + " read: its `enforcement` and `current_user_can_bypass` are unknown, so whether THIS rule binds me is unknown" };
  }
  return { ...bindsMeVerdict(meta, why), required: count };
}

/**
 * MANY RULES, ONE VERDICT, AND IT FAILS CLOSED.
 *
 * `CANNOT_TELL` on ANY contributing rule decides the whole read, even when another rule is known to bind:
 * the reviewer's second arm, "fail closed when any contributing rule is unexamined". Passing on the rules
 * that happened to be readable is how a check certifies a branch it only partly looked at.
 *
 * Otherwise the most restrictive rule that ACTUALLY BINDS ME wins, because requirements compose: a rule
 * that is decorative or that I bypass contributes nothing and weakens nothing. With no binding rule at all,
 * `EXEMPT` is preferred over `DECORATIVE` -- both mean "not bound", and the one naming a live bypass of the
 * identity running the check is the one worth printing.
 */
function strongestBinding(verdicts: Array<{ code: BindingCode; why: string; required: number }>) {
  const unexamined = verdicts.find((v) => v.code === BINDING.CANNOT_TELL);
  if (unexamined) return { code: BINDING.CANNOT_TELL as BindingCode, why: unexamined.why };
  const binding = verdicts.filter((v) => v.code === BINDING.BINDS_ME);
  if (binding.length > 0) return binding.reduce((a, b) => (b.required > a.required ? b : a));
  return verdicts.find((v) => v.code === BINDING.EXEMPT) ?? verdicts[0];
}

/**
 * The exemption half, and the ONLY thing this check can say about it: whether the caller is bound.
 *
 * ANYTHING THAT IS NOT EXACTLY `"never"` IS TREATED AS A BYPASS, including a value this code has never
 * seen. GitHub's schema lists FOUR values -- `always`, `pull_requests_only`, `never`, `exempt` -- and a
 * check written as "is it one of the bypassing ones" would have to enumerate three and would have missed
 * `exempt`, which is not mentioned anywhere in the row, the ruling, or any reading taken here.
 * `pull_requests_only` matters most of all: it is a bypass of precisely the rule being asserted.
 */
function bindsMeVerdict({ enforcement, canBypass }: RulesetMeta, why: string) {
  if (enforcement === null) {
    return { code: BINDING.CANNOT_TELL as BindingCode,
      why: `${why}, but the ruleset's \`enforcement\` could not be read, so it may be evaluated rather than enforced` };
  }
  if (enforcement !== "active") {
    return { code: BINDING.DECORATIVE as BindingCode,
      why: `${why}, but its ruleset's enforcement is "${enforcement}": evaluated or disabled, and it blocks nothing` };
  }
  if (canBypass === null) {
    return { code: BINDING.CANNOT_TELL as BindingCode,
      why: `${why}, but \`current_user_can_bypass\` could not be read: "I could not look" is not "I am bound"` };
  }
  if (canBypass !== NOT_BYPASSABLE) {
    return { code: BINDING.EXEMPT as BindingCode,
      why: `${why}, but \`current_user_can_bypass\` reads "${canBypass}": the identity running this check walks past it` };
  }
  return { code: BINDING.BINDS_ME as BindingCode,
    why: `${why}, and \`current_user_can_bypass\` is "never" for the identity running this check`
      + " -- who ELSE may bypass is not knowable without admin" };
}

// --- #2086: the verdict, against synthetic inputs ----------------------------------------------------

const LIVE_RULES: BranchRule[] = [
  { type: "merge_queue", ruleset_id: 23681721 },
  { type: "pull_request", ruleset_id: 23681721, parameters: { required_approving_review_count: 1 } },
];

/**
 * `enforcement`/`canBypass` give EVERY ruleset named in `branchRules` the same metadata, which is the live
 * shape: one ruleset, `merge-queue-main`, serves both rules. Tests where the rulesets must DIFFER pass
 * `rulesets` explicitly -- and that is the whole of the #2090 review blocker, so those tests are below.
 */
const BINDS = ({ branchRules = LIVE_RULES, enforcement = "active", canBypass = NOT_BYPASSABLE, rulesets }: {
  branchRules?: BranchRule[] | null;
  enforcement?: string | null;
  canBypass?: string | null;
  rulesets?: Record<number, RulesetMeta>;
} = {}): RulesetBinding => ({
  branchRules,
  rulesets: rulesets ?? Object.fromEntries((branchRules ?? []).map((r) => [r.ruleset_id, { enforcement, canBypass }])),
});

/** Two rulesets contributing to `main`, each with its own state -- the shape the blocker was about. */
const TWO_RULESETS = ({ first, second, rulesets }: {
  first: number; second: number; rulesets: Record<number, RulesetMeta>;
}): RulesetBinding => ({
  branchRules: [
    { type: "pull_request", ruleset_id: 1, parameters: { required_approving_review_count: first } },
    { type: "pull_request", ruleset_id: 2, parameters: { required_approving_review_count: second } },
  ],
  rulesets,
});

test("#2086: the live shape read as `a11ign-ai-workers` BINDS_ME -- the state this row exists to certify", () => {
  // Byte-for-byte the 2026-09-23T09:06Z reading, taken with `permissions.admin: false`. #2045's live test
  // cannot reach a pass on this token at all; this one must, or the swap bought nothing.
  const v = ruleAppliesVerdict(BINDS());
  assert.equal(v.code, BINDING.BINDS_ME);
  assert.match(v.why, /not knowable without admin/, "the limitation is in the verdict's own words, not implied");
});

test("#2086: no `pull_request` rule is ABSENT -- the pre-ruling shape, and the regression this catches", () => {
  // `["merge_queue"]` is exactly what the row's Open-check read before `ceo` made the edit. It is also
  // what a CI run would read if the rule were ever dropped: the one regression this check is for.
  const v = ruleAppliesVerdict(BINDS({ branchRules: [{ type: "merge_queue", ruleset_id: 23681721 }] }));
  assert.equal(v.code, BINDING.ABSENT);
  assert.notEqual(v.code, BINDING.BINDS_ME);
});

test("#2086: an EMPTY rule list is ABSENT, and an unreadable one is CANNOT_TELL -- never the same answer", () => {
  // The absence-vs-broken split, at the top of the read rather than only deep inside it.
  assert.equal(ruleAppliesVerdict(BINDS({ branchRules: [] })).code, BINDING.ABSENT);
  const v = ruleAppliesVerdict(BINDS({ branchRules: null }));
  assert.equal(v.code, BINDING.CANNOT_TELL);
  assert.match(v.why, /could not be read/);
});

test("#2086: `required_approving_review_count: 0` is DECORATIVE -- the rule exists and demands nothing", () => {
  const v = ruleAppliesVerdict(BINDS({
    branchRules: [{ type: "pull_request", ruleset_id: 1, parameters: { required_approving_review_count: 0 } }],
  }));
  assert.equal(v.code, BINDING.DECORATIVE);
  assert.match(v.why, /demands nothing/);
});

test("#2086: a MISSING count is CANNOT_TELL, not zero -- absence is only emptiness where it was measured", () => {
  const v = ruleAppliesVerdict(BINDS({ branchRules: [{ type: "pull_request", ruleset_id: 1 }] }));
  assert.equal(v.code, BINDING.CANNOT_TELL);
  assert.notEqual(v.code, BINDING.DECORATIVE, "reading it as 0 would invent a measurement nobody took");
});

test("#2086: the MOST RESTRICTIVE of several `pull_request` rules wins -- requirements compose", () => {
  // `ceo`'s ruling turns on this: two surfaces cannot weaken each other. The same holds within one list,
  // where a repository-level and an organisation-level ruleset may each contribute a rule.
  const v = ruleAppliesVerdict(BINDS({
    branchRules: [
      { type: "pull_request", ruleset_id: 1, parameters: { required_approving_review_count: 0 } },
      { type: "pull_request", ruleset_id: 2, parameters: { required_approving_review_count: 2 } },
    ],
  }));
  assert.equal(v.code, BINDING.BINDS_ME);
  assert.match(v.why, /requires 2 approval/);
});

const ACTIVE_BINDING: RulesetMeta = { enforcement: "active", canBypass: NOT_BYPASSABLE };

test("#2090 BLOCKER: a rule I BYPASS never lends its count to a rule that binds me", () => {
  // THE REVIEW FINDING, AS THE STATE THAT PRODUCED IT. Ruleset 1 binds me and asks for 1; ruleset 2 asks
  // for 5 and I walk past it. The first version took the count from `Math.max` over both rules and the
  // exemption state from the FIRST rule's ruleset alone, and so printed "requires 5 approval(s)" with
  // BINDS_ME -- certifying a requirement that does not bind the identity running the check.
  const v = ruleAppliesVerdict(TWO_RULESETS({ first: 1, second: 5,
    rulesets: { 1: ACTIVE_BINDING, 2: { enforcement: "active", canBypass: "always" } } }));
  assert.equal(v.code, BINDING.BINDS_ME);
  assert.match(v.why, /requires 1 approval/, "only the rule that actually binds me may set the number");
  assert.doesNotMatch(v.why, /requires 5 approval/, "the bypassed rule's count is not mine to claim");
});

test("#2090 BLOCKER: the verdict does not depend on which ruleset is listed first", () => {
  // THE FINGERPRINT OF THE DEFECT, and the cheapest way to catch its return. Reading the exemption state
  // off `branchRules.find(...)` made the answer a property of GitHub's response ORDER: the same two
  // rulesets swapped gave BINDS_ME one way and EXEMPT the other. Both orders must now agree.
  const rulesets = { 1: { enforcement: "active", canBypass: "always" }, 2: ACTIVE_BINDING };
  const forward = ruleAppliesVerdict(TWO_RULESETS({ first: 5, second: 1, rulesets }));
  const reversed = ruleAppliesVerdict({
    branchRules: [...(TWO_RULESETS({ first: 5, second: 1, rulesets }).branchRules ?? [])].reverse(), rulesets,
  });
  assert.equal(forward.code, BINDING.BINDS_ME);
  assert.deepEqual(forward, reversed, "order-dependence here IS the bug");
});

test("#2090 BLOCKER: a rule in an `evaluate` ruleset lends nothing to one in an `active` ruleset", () => {
  // The same confusion through the other field. `rules/branches/{branch}` is documented to exclude
  // non-active rulesets, so this should be unreachable live -- but the count and the enforcement came from
  // different objects, and a documented filter is not a measured one.
  const v = ruleAppliesVerdict(TWO_RULESETS({ first: 1, second: 5,
    rulesets: { 1: ACTIVE_BINDING, 2: { enforcement: "evaluate", canBypass: NOT_BYPASSABLE } } }));
  assert.equal(v.code, BINDING.BINDS_ME);
  assert.match(v.why, /requires 1 approval/);
  assert.doesNotMatch(v.why, /requires 5 approval/);
});

test("#2090 BLOCKER: an UNEXAMINED contributing ruleset is CANNOT_TELL even though another rule binds", () => {
  // FAIL CLOSED, the reviewer's second arm. Ruleset 2's metadata was never fetched -- the live reader drops
  // a ruleset it could not read rather than inventing one -- so its rule may demand more than the rule that
  // did bind. Passing on the readable half is how a check certifies a branch it only partly looked at.
  const v = ruleAppliesVerdict(TWO_RULESETS({ first: 1, second: 5, rulesets: { 1: ACTIVE_BINDING } }));
  assert.equal(v.code, BINDING.CANNOT_TELL);
  assert.notEqual(v.code, BINDING.BINDS_ME, "one readable ruleset is not a reading of the branch");
  assert.match(v.why, /was never\s+read/);
});

test("#2090 BLOCKER: a `pull_request` rule with NO `ruleset_id` cannot be attributed, so it is CANNOT_TELL", () => {
  // The positive control for the attribution itself: with no id there is no ruleset to ask about, and
  // reading that as "use whichever ruleset we already have" is the defect one step further on.
  const v = ruleAppliesVerdict({
    branchRules: [{ type: "pull_request", parameters: { required_approving_review_count: 1 } }],
    rulesets: { 23681721: ACTIVE_BINDING },
  });
  assert.equal(v.code, BINDING.CANNOT_TELL);
  assert.match(v.why, /carries no `ruleset_id`/);
});

test("#2090: two rulesets that BOTH bind me still take the most restrictive -- composition is unchanged", () => {
  // The positive control for the fail-closed rules above: judging each rule against its own ruleset must
  // not have cost the composition the ruling turns on. Both active, both binding, 1 and 2 -> 2.
  const v = ruleAppliesVerdict(TWO_RULESETS({ first: 1, second: 2,
    rulesets: { 1: ACTIVE_BINDING, 2: ACTIVE_BINDING } }));
  assert.equal(v.code, BINDING.BINDS_ME);
  assert.match(v.why, /requires 2 approval/);
});

test("#2086 THE OVERCLAIM THIS CHECK EXISTS TO REFUSE: a bypassing caller is EXEMPT, never BINDS_ME", () => {
  // Done-when #4, and the condition `ceo` ruled "add" on. A check that reads the rule's presence and stops
  // would go green here while the identity running it merges without any review at all.
  for (const canBypass of ["always", "pull_requests_only", "exempt"]) {
    const v = ruleAppliesVerdict(BINDS({ canBypass }));
    assert.equal(v.code, BINDING.EXEMPT, `\`current_user_can_bypass: "${canBypass}"\` must never bind`);
    assert.notEqual(v.code, BINDING.BINDS_ME);
    assert.match(v.why, new RegExp(canBypass), "the verdict names the value it read");
  }
});

test("#2086: `exempt` is in GitHub's enum and nowhere in this row -- which is why the test is `!== never`", () => {
  // THE POSITIVE CONTROL FOR THE `!== "never"` SHAPE. An allowlist of known-bypassing values would have
  // been written from the row's own vocabulary (`always`, `pull_requests_only`) and would have passed
  // `exempt` straight through to BINDS_ME. The schema lists four; this guard recognises exactly one.
  assert.equal(ruleAppliesVerdict(BINDS({ canBypass: "a_value_github_has_not_shipped_yet" })).code, BINDING.EXEMPT);
  assert.equal(ruleAppliesVerdict(BINDS({ canBypass: NOT_BYPASSABLE })).code, BINDING.BINDS_ME);
});

test("#2086: an unreadable `current_user_can_bypass` is CANNOT_TELL -- \"I could not look\" is not \"I am bound\"", () => {
  const v = ruleAppliesVerdict(BINDS({ canBypass: null }));
  assert.equal(v.code, BINDING.CANNOT_TELL);
  assert.notEqual(v.code, BINDING.BINDS_ME);
});

test("#2086: an `evaluate` or `disabled` ruleset is DECORATIVE, and an unreadable enforcement CANNOT_TELL", () => {
  // GitHub documents `rules/branches/{branch}` as already excluding non-active rulesets, so this branch
  // should be unreachable against the real API. It is checked anyway because the `enforcement` field
  // arrives in the `rulesets/{id}` read this guard is already making for `current_user_can_bypass`, so it
  // costs no call -- and a documented filter is not a measured one.
  assert.equal(ruleAppliesVerdict(BINDS({ enforcement: "evaluate" })).code, BINDING.DECORATIVE);
  assert.equal(ruleAppliesVerdict(BINDS({ enforcement: "disabled" })).code, BINDING.DECORATIVE);
  assert.equal(ruleAppliesVerdict(BINDS({ enforcement: null })).code, BINDING.CANNOT_TELL);
});

test("#2086: BINDS_ME IS NOT A SPELLING OF REQUIRED -- the cheap instrument certifies strictly less", () => {
  // The whole of done-when #4 as one assertion. `REQUIRED` above means "the rule bites and NOBODY is
  // exempt", reachable only on an admin token. Nothing in this vocabulary may ever equal it, because the
  // next edit that wants "one verdict type for both surfaces" is how the overclaim gets in.
  assert.equal(Object.values(BINDING).includes(VERDICT.REQUIRED as never), false);
  assert.notEqual(BINDING.BINDS_ME as string, VERDICT.REQUIRED as string);
  assert.equal(new Set(Object.values(BINDING)).size, 5, "and the five are genuinely distinct");
});

// --- #2086: the live read, which needs NO admin -----------------------------------------------------

test("#2086 LIVE: the `pull_request` rule applies to `main` and this identity cannot bypass it", () => {
  // OPT-IN, and under its OWN switch rather than `A11Y_CHECK_BRANCH_PROTECTION`. The two live reads have
  // different permission requirements: the one above cannot pass without repository admin, so a single
  // switch would make this one impossible to enable anywhere admin is absent -- which is everywhere the
  // CI job runs, and the entire point of #2086.
  if (process.env.A11Y_CHECK_MAIN_RULESET !== "1") {
    console.log("  NOT RUN: the live ruleset read is opt-in -- `A11Y_CHECK_MAIN_RULESET=1 npx tsx --test "
      + "packages/lab/src/packaging/branch-protection.test.ts` asks GitHub whether the ruleset's "
      + "`pull_request` rule binds THIS identity. It needs no admin. The verdict logic above ran against "
      + "synthetic inputs; nothing here read the live ruleset.");
    return;
  }
  const binding = liveRulesetBinding();
  if (binding.branchRules === null) {
    // Never an empty catch and never a pass: a check that could not ask reports that it could not ask.
    console.log("  SKIPPED: `rules/branches/main` could not be asked. NOT a pass.");
    return;
  }
  const v = ruleAppliesVerdict(binding);
  assert.equal(v.code, BINDING.BINDS_ME, v.why);
  // A pass prints WHAT it read, and what it did NOT establish. `ok 30` alone would be quoted as proof
  // that nobody can bypass the requirement, which is the one thing this check cannot say.
  console.log(`  LIVE PASS (no admin required): ${v.why}`);
  // #2119: and the third surface, named rather than eyeballed. On this token it prints WITHHELD.
  reportExemptionSurface(binding, "LIVE");
});

/**
 * Both halves of the ruleset state, with the ids taken from the branch-keyed read rather than hardcoded.
 *
 * #2086's own Open-check flagged the hardcoded `rulesets/23681721` as rot waiting to happen, with "re-read
 * the list for its id" as the manual recovery. Taking `ruleset_id` off the rules that were actually found
 * removes the id from this file altogether: there is nothing left to go stale, and a rule served by a
 * different or re-created ruleset is followed automatically.
 *
 * ONE READ PER CONTRIBUTING RULESET, NOT ONE PER BRANCH (#2090 review blocker). GitHub returns the rules of
 * EVERY active ruleset that applies, repository- and organisation-level alike, so `find(...)` answered for
 * whichever was listed first. Today that is one call, because one ruleset serves both rules here; the loop
 * is what keeps the verdict honest if a second ever appears, and a ruleset that could not be read is simply
 * left OUT of the map, where `contributingRuleVerdict` fails closed on it.
 */
function liveRulesetBinding(): RulesetBinding {
  let branchRules: BranchRule[];
  try {
    branchRules = JSON.parse(gh(["api", "repos/a11ign/a11ign/rules/branches/main"]));
  } catch (cause) {
    console.log(`  \`rules/branches/main\` could not be read (${String(cause)}).`);
    return { branchRules: null, rulesets: {} };
  }
  const ids = new Set((branchRules ?? [])
    .filter((r) => r.type === "pull_request")
    .map((r) => r.ruleset_id)
    .filter((id): id is number => typeof id === "number"));
  const rulesets: Record<number, RulesetMeta> = {};
  for (const id of ids) {
    const meta = liveRulesetMeta(id);
    if (meta) rulesets[id] = meta;
  }
  return { branchRules, rulesets };
}

/** One ruleset's own `enforcement` and `current_user_can_bypass`; null when the object could not be read. */
function liveRulesetMeta(id: number): RulesetMeta | null {
  try {
    const ruleset = JSON.parse(gh(["api", `repos/a11ign/a11ign/rulesets/${id}`]));
    // The whole object, deliberately unprojected: `--jq` would flatten the one thing #2119 is about.
    return { enforcement: ruleset.enforcement ?? null, canBypass: ruleset.current_user_can_bypass ?? null,
      exemptions: exemptionRead(ruleset) };
  } catch (cause) {
    // Never an empty catch, and deliberately NOT an entry in the map: an unread ruleset is unexamined,
    // which the verdict reports as CANNOT_TELL rather than letting the readable rulesets answer for it.
    console.log(`  \`rulesets/${id}\` could not be read (${String(cause)}); that ruleset's exemption half is unavailable.`);
    return null;
  }
}

// --- #2119: the THIRD exemption surface, whose absence rule is the OPPOSITE of the first ------------

/**
 * #2119: `bypass_actors` ON THE RULESET -- PINNED AS A DISCRIMINATOR, NOT AS AN ASSERTION.
 *
 * `main` has three exemption surfaces and this file now judges all three. This one is pinned last and
 * pinned DIFFERENTLY, because its absence means the opposite of `bypass_pull_request_allowances`'s, and
 * getting that wrong is not a theoretical risk: `assert.deepEqual(ruleset.bypass_actors ?? [], [])` is a
 * plausible line to write, it passes on every unattended run, and what it certifies is that nobody looked.
 *
 * THE TWO READINGS THIS IS KEYED ON. One ruleset (23681721), one moment, two identities -- measured by
 * `product-manager` on 2026-09-23 at `1a8f1c101`, the non-admin half re-measured here at 11:08:41Z:
 *
 *     as `DanBeckDev`        (admin:true)   {"bypass_actors":[],  "can_bypass":"never","has_bypass_key":true}
 *     as `a11ign-ai-workers` (admin:false)  {"bypass_actors":null,"can_bypass":"never","has_bypass_key":false}
 *
 * THE KEY IS PRESENT TO ONE AND ABSENT TO THE OTHER, FROM THE SAME OBJECT AT THE SAME MOMENT. GitHub
 * documents exactly that -- "to prevent leaking sensitive information, the `bypass_actors` property is only
 * returned if the user making the API request has write access to the ruleset" -- so schema and measurement
 * agree, and on THIS field absence can never be read as emptiness.
 *
 * WHY THAT DOES NOT CONTRADICT `exemptIdentities`, WHICH READS ITS OWN ABSENCE AS EMPTINESS. Each rule is
 * keyed on the FIELD, and each field earned its own measurement by holding a different thing still:
 *
 *   - `bypass_pull_request_allowances` was read at a FIXED permission level, on BOTH SIDES of a real change:
 *     key present with `DanBeckDev` in it on 09-22, key absent on 09-23 with the count still 1. The
 *     permission held still and the key moved, so absence there is the CLEARED state.
 *   - `bypass_actors` was read at ONE MOMENT by TWO permission levels. The object held still and the
 *     permission moved, and the key moved with it -- so absence here is the VIEW being WITHHELD.
 *
 * Both are measurements, and neither is a general rule about absence. A guard keyed on the TOKEN instead
 * ("I hold admin, so absence means empty") would be reading its own credentials rather than GitHub's
 * answer, which is the shape this whole file exists to refuse. So `exemptIdentities` is left EXACTLY as it
 * is, and this is a separate vocabulary rather than a branch inside it.
 *
 * AND `has()` IS THE ONLY HONEST DISCRIMINATOR, AT THE COMMAND LINE TOO. The non-admin reading above prints
 * `"bypass_actors":null`: jq's `{bypass_actors}` shorthand emits the key for a field that is not there, so
 * even the hand-run command quoted in #2119 shows `null` rather than a gap, and only its `has_bypass_key`
 * line says which state it is in. TypeScript's `??` collapses those same two states the same way. The
 * extractor below therefore reads key PRESENCE, and never the value's nullishness.
 *
 * WHAT THIS BUYS, AS THE ROW ITSELF PUTS IT: nothing the unattended check could not do before, because the
 * CI identity can never read the field. The admin-run read stops being eyeballed and becomes a verdict with
 * a name, and the trap above is closed by a test instead of by this paragraph.
 */
const EXEMPTIONS = {
  /** The key was returned AND the list is empty: no actor bypasses this ruleset. Needs write access. */
  CLEARED: "CLEARED",
  /** The key was returned and names actors: the holes ARE enumerable here, so the verdict prints them. */
  EXEMPTED: "EXEMPTED",
  /** The key was not returned. Its own named state -- "you may not look", never "the list is empty". */
  WITHHELD: "WITHHELD",
  /** The ruleset was never read, or the key came back as a shape nobody here has measured. */
  CANNOT_TELL: "CANNOT_TELL",
} as const;
type ExemptionCode = (typeof EXEMPTIONS)[keyof typeof EXEMPTIONS];

/**
 * Key presence carried SEPARATELY from the value, because that separation is the whole discriminator.
 *
 * `value` is `unknown` on purpose: a present key holding something other than a list is a shape nobody has
 * measured here, and typing it as an array would be the assumption this row exists to refuse.
 */
type ExemptionRead = { present: boolean; value: unknown };

/** null in, null out: a ruleset nobody could read has no exemption state to extract, not an empty one. */
function exemptionRead(ruleset: object | null): ExemptionRead | null {
  if (ruleset === null) return null;
  return {
    present: Object.hasOwn(ruleset, "bypass_actors"),
    value: (ruleset as { bypass_actors?: unknown }).bypass_actors,
  };
}

/** A count is where an investigation stops; the verdict names who, in GitHub's own actor vocabulary. */
function describeActor(actor: unknown): string {
  const { actor_type: type, actor_id: id, bypass_mode: mode } = (actor ?? {}) as
    { actor_type?: string; actor_id?: number; bypass_mode?: string };
  if (type === undefined && id === undefined) return JSON.stringify(actor) ?? String(actor);
  return `${type ?? "actor"}#${id ?? "?"}${mode === undefined ? "" : ` (${mode})`}`;
}

/** The third surface's verdict, decided on whether the KEY came back -- never on who is asking. */
function bypassActorsVerdict(read: ExemptionRead | null) {
  const none: string[] = [];
  if (read === null) {
    return { code: EXEMPTIONS.CANNOT_TELL as ExemptionCode, actors: none,
      why: "the ruleset object was never read, so its exemption list was never examined" };
  }
  if (!read.present) {
    return { code: EXEMPTIONS.WITHHELD as ExemptionCode, actors: none,
      why: "`bypass_actors` is absent from the ruleset object: GitHub returns it only to a token with write "
        + "access to the ruleset, so this is the view being withheld and NOT an empty list" };
  }
  if (!Array.isArray(read.value)) {
    return { code: EXEMPTIONS.CANNOT_TELL as ExemptionCode, actors: none,
      why: `\`bypass_actors\` is present but reads ${JSON.stringify(read.value)} rather than a list: an `
        + "unrecognised shape rather than a cleared field" };
  }
  const actors = read.value.map(describeActor);
  if (actors.length > 0) {
    return { code: EXEMPTIONS.EXEMPTED as ExemptionCode, actors,
      why: `\`bypass_actors\` was returned and names ${actors.length}: ${actors.join(", ")}` };
  }
  return { code: EXEMPTIONS.CLEARED as ExemptionCode, actors,
    why: "`bypass_actors` was returned and is empty: no actor bypasses this ruleset" };
}

/**
 * THE TWO READINGS AS JSON TEXT, and not as object literals, because the finding IS which key is in the
 * text. `{ bypass_actors: undefined }` reads as PRESENT to `Object.hasOwn` and as ABSENT to `??` -- a
 * fixture that quietly picks a side of the very question under test. Parsing the bytes cannot do that.
 *
 * Fields other than the three at issue are elided. `has_bypass_key` in the quoted output above is jq's own
 * `has()` and not a field GitHub returns, so it is deliberately absent from both fixtures.
 */
const RULESET_AS_ADMIN = '{"id":23681721,"enforcement":"active","current_user_can_bypass":"never","bypass_actors":[]}';
const RULESET_AS_CI = '{"id":23681721,"enforcement":"active","current_user_can_bypass":"never"}';

test("#2119: the ADMIN reading reaches CLEARED and the CI reading MUST NOT -- one object, one moment", () => {
  // DONE-WHEN 3, both halves in one test on purpose. The refusal is what the row asks for; the admin half
  // beside it is this file's own positive-control shape -- "the state this guard exists to certify must be
  // reachable" -- without which the row would ship a verdict whose pass nobody has ever seen.
  const admin = bypassActorsVerdict(exemptionRead(JSON.parse(RULESET_AS_ADMIN)));
  assert.equal(admin.code, EXEMPTIONS.CLEARED);
  assert.match(admin.why, /was returned and is empty/);

  const ci = bypassActorsVerdict(exemptionRead(JSON.parse(RULESET_AS_CI)));
  assert.equal(ci.code, EXEMPTIONS.WITHHELD);
  assert.notEqual(ci.code, EXEMPTIONS.CLEARED, "the CI identity cannot see the list, so it must never clear it");
  assert.match(ci.why, /NOT an empty list/);
});

test("#2119 THE TRAP THIS ROW CLOSES: `bypass_actors ?? []` reads the WITHHELD state as an empty list", () => {
  // WRITTEN AS THE MUTATION RATHER THAN DESCRIBED, because a paragraph was the only thing stopping it.
  // The first assertion is the defect, demonstrated on the real CI reading: the naive line passes, silently
  // and wrongly, on every unattended run. The second is the discriminator refusing the same input.
  const ruleset = JSON.parse(RULESET_AS_CI);
  assert.deepEqual((ruleset as { bypass_actors?: unknown[] }).bypass_actors ?? [], [],
    "the naive assertion DOES pass on a reading that saw nothing -- that is the trap, pinned so it cannot "
    + "be written back in by accident");
  assert.equal(bypassActorsVerdict(exemptionRead(ruleset)).code, EXEMPTIONS.WITHHELD,
    "and the discriminator, keyed on the KEY rather than on the value, refuses it");
});

test("#2119: a NON-EMPTY `bypass_actors` is EXEMPTED and NAMES the holes", () => {
  // The surface's whole reason for existing: unlike `enforce_admins`, this hole has identities to print,
  // and unlike `current_user_can_bypass` it can name someone other than the caller.
  const v = bypassActorsVerdict(exemptionRead(JSON.parse(
    '{"bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}]}')));
  assert.equal(v.code, EXEMPTIONS.EXEMPTED);
  assert.notEqual(v.code, EXEMPTIONS.CLEARED, "a list with someone in it is not a cleared one");
  assert.match(v.why, /RepositoryRole#5 \(always\)/, "a count is where an investigation stops");
});

test("#2119: an unread ruleset and a present-but-unrecognised value are CANNOT_TELL, and neither is WITHHELD", () => {
  // PRESENT-AND-NULL IS NOT ABSENT, and it is the one pair `??` genuinely cannot tell apart. Nobody here
  // has seen GitHub return it, so it gets the discipline `enforce_admins` gets above: a shape nobody has
  // measured is unrecognised, not cleared, and not the documented withholding either.
  assert.equal(bypassActorsVerdict(null).code, EXEMPTIONS.CANNOT_TELL);
  const odd = bypassActorsVerdict(exemptionRead(JSON.parse('{"bypass_actors":null}')));
  assert.equal(odd.code, EXEMPTIONS.CANNOT_TELL);
  assert.notEqual(odd.code, EXEMPTIONS.WITHHELD, "the key came back; it just came back as a shape nobody has seen");
  assert.notEqual(odd.code, EXEMPTIONS.CLEARED);
});

test("#2119: WITHHELD is its own state, and no member of this vocabulary spells REQUIRED or BINDS_ME", () => {
  // The same guard the other two vocabularies carry. A later edit wanting "one verdict type for all three
  // surfaces" is how the overclaim gets in, and collapsing WITHHELD into CANNOT_TELL is how this row's
  // finding gets forgotten: the view being withheld is DOCUMENTED and MEASURED, not merely unknown.
  assert.equal(new Set(Object.values(EXEMPTIONS)).size, 4, "and the four are genuinely distinct");
  assert.notEqual(EXEMPTIONS.WITHHELD as string, EXEMPTIONS.CANNOT_TELL as string);
  assert.equal(Object.values(EXEMPTIONS).includes(VERDICT.REQUIRED as never), false);
  assert.equal(Object.values(EXEMPTIONS).includes(BINDING.BINDS_ME as never), false);
});

test("#2119 DONE-WHEN 4: reading the exemption surface leaves `BINDS_ME` alone, on BOTH real readings", () => {
  // THE ONE THING THIS ROW MAY NOT DO. If `bypass_actors` fed back into the binding verdict, the CI
  // identity -- which can never read the field -- would drop from BINDS_ME to CANNOT_TELL, and the
  // unattended check `ceo` ruled in on #2086 would go red for the whole of this row's benefit. Both
  // readings are carried through the same path the live reader uses, and both must still bind.
  for (const text of [RULESET_AS_ADMIN, RULESET_AS_CI]) {
    const ruleset = JSON.parse(text);
    const meta: RulesetMeta = { enforcement: ruleset.enforcement, canBypass: ruleset.current_user_can_bypass,
      exemptions: exemptionRead(ruleset) };
    const v = ruleAppliesVerdict({ branchRules: LIVE_RULES, rulesets: { 23681721: meta } });
    assert.equal(v.code, BINDING.BINDS_ME, `the ${Object.hasOwn(ruleset, "bypass_actors") ? "admin" : "CI"} reading: ${v.why}`);
  }
});

/**
 * #2119: the exemption surface, printed beside the binding verdict on a live run.
 *
 * IT ASSERTS ONLY `!== EXEMPTED`, and that is the strongest honest assertion available here. On the CI
 * identity the field is WITHHELD and there is nothing to assert; on an admin run it is CLEARED and the
 * assertion holds; if an actor is ever added, an admin run goes red and names it. Asserting CLEARED instead
 * would make the unattended check unpassable on the only token that ever runs it -- done-when 4 again, from
 * the other side. The printed line is what an admin run gets quoted from, replacing an eyeballed `--jq`.
 */
function reportExemptionSurface({ rulesets }: RulesetBinding, source: string) {
  for (const [id, meta] of Object.entries(rulesets)) {
    const v = bypassActorsVerdict(meta.exemptions ?? null);
    // `source` IS NOT DECORATION. The fixtures below carry the real ruleset id, because they ARE readings
    // of it -- so without this prefix the test transcript prints four "ruleset 23681721 exemption surface"
    // lines, one live and three synthetic, and a reader quoting CLEARED out of it would be quoting a
    // fixture as a measurement. That is this repository's own apparatus-reading failure, one line wide.
    console.log(`  ${source} ruleset ${id} exemption surface: ${v.code} -- ${v.why}`);
    assert.notEqual(v.code, EXEMPTIONS.EXEMPTED,
      `ruleset ${id}: ${v.why}. Those actors walk past the \`pull_request\` rule this check just certified.`);
  }
}

test("#2119: the live run's own assertion, driven WITHOUT the network -- EXEMPTED is its only failing state", () => {
  // `reportExemptionSurface` is reached only from the opt-in live test above, and neither live read has
  // ever run unattended (#2120). Without this it would ship an assertion whose failing state nobody has
  // seen -- and "all mutants red" is not the same as "the pass is reachable", so both are driven here.
  const surface = (text: string): RulesetBinding => ({
    branchRules: LIVE_RULES,
    rulesets: {
      23681721: { enforcement: "active", canBypass: NOT_BYPASSABLE, exemptions: exemptionRead(JSON.parse(text)) },
    },
  });
  // The CI reading passes because there is nothing it may assert; the admin reading because it CLEARED.
  reportExemptionSurface(surface(RULESET_AS_CI), "FIXTURE(read as a11ign-ai-workers)");
  reportExemptionSurface(surface(RULESET_AS_ADMIN), "FIXTURE(read as DanBeckDev)");
  assert.throws(
    () => reportExemptionSurface(
      surface('{"bypass_actors":[{"actor_id":5,"actor_type":"Team","bypass_mode":"always"}]}'),
      "FIXTURE(a hole nobody has measured here)"),
    /Team#5/,
    "an actor added to the ruleset must fail an admin run, and the failure must NAME it rather than count it");
});

/**
 * THE OTHER EXEMPTION SURFACES, AND WHICH OF THEM THIS FILE PINS.
 *
 * `ceo` asked for `enforce_admins` and the `merge-queue-main` ruleset's `bypass_actors` pinned "only if
 * cheap" (#2022, comment 5787499206). `enforce_admins` is cheap and is pinned above: it arrives inside the
 * protection body this guard already reads, so it costs no call and one branch.
 *
 * THE RULESET'S `bypass_actors` IS NOW PINNED TOO, AS OF #2119 -- AS A DISCRIMINATOR RATHER THAN AS AN
 * ASSERTION. Read on 2026-09-23 against the same ruleset, seconds apart, by two identities:
 *
 *     as `DanBeckDev`        (admin:true)   {"bypass_actors":[], "current_user_can_bypass":"never"}
 *     as `a11ign-ai-workers` (admin:false)  has("bypass_actors") => false        # the key is ABSENT
 *
 * So on THIS key absence is permission-dependent: it means "empty" to one token and "you may not see it"
 * to another, from the same object at the same moment. GitHub documents exactly that -- "to prevent
 * leaking sensitive information, the `bypass_actors` property is only returned if the user making the API
 * request has write access to the ruleset" -- so the measurement and the schema agree, and the absence
 * can never be read as emptiness on the CI token. That is the exact opposite of the
 * `bypass_pull_request_allowances` finding above, where absence was measured as the cleared state at a
 * FIXED permission level on both sides of a real change.
 *
 * UNTIL #2119 THAT WAS THE REASON NOT TO PIN IT, and the reason was half right. A naive assertion WOULD
 * have put two contradictory absence rules in one guard keyed on the TOKEN -- but the fix for that is to
 * key the verdict on the FIELD, which `EXEMPTIONS`/`bypassActorsVerdict` above do: a returned-and-empty
 * list CLEARS, a returned list with actors in it is EXEMPTED and names them, and an ABSENT key is its own
 * WITHHELD state that can never clear. What the row bought is bounded and it is worth saying plainly:
 * nothing the unattended check could not do before, because the CI identity can never read the field. The
 * admin-run read became a named verdict, and the trap became a test instead of this paragraph.
 *
 * WHAT #2086 ADDED INSTEAD, AND THE ONE LINE OF THIS BLOCK THAT WENT STALE. Until `ceo`'s ruling this
 * paragraph ended "the review requirement lives in classic branch protection, not here", and that is no
 * longer true: `merge-queue-main` has carried a `pull_request` rule since 2026-09-23T09:03Z. The sentence
 * is corrected rather than deleted because the reasoning around it still holds --
 * `current_user_can_bypass` answers the exemption question PER IDENTITY and needs no admin, and it is
 * still not a substitute for the admin read above, only a cheaper instrument that certifies less.
 *
 * TWO THINGS THIS FILE STILL DELIBERATELY DOES NOT ASSERT, so that a later reader does not mistake the
 * silence for an oversight:
 *
 *   - `require_extra_approval_for_unattributed_changes`. GitHub defaulted it to `true` when the rule was
 *     created and `ceo` set it to `false` explicitly, because most commits here are authored by
 *     `github-actions[bot]` and agent identities and a second approval would have been demanded on nearly
 *     every PR (#2086 ruling, §2 -- "a mirrored rule is not mirrored until you read back the parameters
 *     the API filled in for you"). It is left unpinned because it is a WALL rather than a HOLE: were it
 *     to flip back, merges would stop, loudly, which is not the silent failure this guard is for.
 *   - Whether the check runs UNATTENDED. `A11Y_CHECK_MAIN_RULESET=1` makes the read possible on the CI
 *     token; it does not schedule it. A workflow step that sets it -- and that asserts the `LIVE PASS`
 *     line was actually printed, since a skip is green -- lives in `.github/workflows/` and so outside
 *     the Region of this file. Reported to `product-manager` rather than smuggled in, and filed as #2120;
 *     #2119 restates it as out of scope for the same reason. NEITHER live read has ever run unattended,
 *     so nothing above should be quoted as something CI checks until that row lands.
 */

// --- #2084: DOES A REVIEW OUTLIVE THE HEAD IT WAS POSTED ON? ----------------------------------------

/**
 * #2084: THE STALENESS SURFACES, AND THE RULING THAT DECIDED THEM -- BOTH READ, NEITHER ASSUMED.
 *
 * `main` decides review staleness on TWO INDEPENDENT FIELDS with two different names, and #2084's own
 * amendment is explicit that they are not one setting seen twice: classic protection's
 * `dismiss_stale_reviews` and the `merge-queue-main` ruleset's `dismiss_stale_reviews_on_push`. They agree
 * today -- both `false` -- and CHANGING ONE DOES NOT MOVE THE OTHER. So a guard pointed at one surface
 * reads green while the other is flipped, which is the exact failure the amendment asked this file to
 * prevent, and it is why `surfacesAgree` below is a verdict of its own rather than a sentence here.
 *
 * WHICH CREDENTIAL READS WHICH, because the row required this file to say so:
 *
 *   - CLASSIC (`branches/main/protection`) -- REPOSITORY ADMIN ONLY. Measured 2026-09-23T17:4xZ, this
 *     host, same minute: `a11ign-ai-workers` gets `404 Not Found` while `branches/main.protected` reads
 *     `true` (so FORBIDDEN, never absent), and `DanBeckDev` reads the body. No session and no CI job here
 *     holds admin, so on every unattended run this surface is `CANNOT_TELL` -- loudly, and never a pass.
 *   - RULESET (`rules/branches/main`) -- ANY TOKEN THAT CAN READ THE REPOSITORY. Measured the same minute
 *     as `a11ign-ai-workers`: the `pull_request` rule of ruleset `23681721` carries
 *     `dismiss_stale_reviews_on_push: false`. THIS is the surface the live assertion below rests on,
 *     for #2086's reason: it is the only one an unattended check can actually reach.
 *
 * THE RULING IS RECORDED AS A CONSTANT RATHER THAN AS AN ASSERTION LITERAL (`RULED_STALENESS`), so that a
 * later decision to dismiss stale reviews is ONE EDIT in a named place with its reasoning attached, and
 * the test then goes red until the live configuration follows. A bare `assert.equal(v, KEEPS)` would read
 * as "this is how it must be" rather than "this is what was decided, on this evidence, on this date".
 *
 * WHAT WAS DECIDED, AND WHY IT IS NOT WHAT #2084's DONE-WHEN 1 ASKED FOR. The row asked for
 * `dismiss_stale_reviews: true`. Two measurements taken while building it say that lever does not do what
 * the row needs and costs what the row did not price:
 *
 *   1. IT DOES NOT CLEAR A REFUSAL, WHICH IS THE DIRECTION #2049 WAS STUCK IN. Every official statement of
 *      this setting is scoped to APPROVING reviews -- "dismiss stale pull request approvals",
 *      "the approving review is dismissed as stale", and the ruleset parameter's own "New, reviewable
 *      commits pushed will dismiss previous pull request review approvals." A `CHANGES_REQUESTED` is not
 *      an approval, so turning this on would not have unblocked #2049, the live instance the row is built
 *      on. (GitHub does not state the negative outright; the scope is consistent across every official
 *      surface, and this repository's own #2049 reading agrees with it.)
 *   2. IT WOULD STALL A THIRD OF THIS REPOSITORY'S MERGES. GitHub documents the Update-branch button as a
 *      dismissal trigger by name, with no carve-out for base-originated updates -- and
 *      `update-branch-sweep.mjs` runs exactly that on every armed, green pull request after every merge.
 *      Measured over the 40 most recent merged pull requests at `468a74f1b`: all 40 carried an APPROVED
 *      review, all 40 were approved AT the head that merged (so a content push would have cost nothing),
 *      median approval-to-merge latency 6.5 minutes -- and 15 OF THE 40 had another pull request merge to
 *      `main` inside that window, which is one sweep each. Under `dismiss_stale_reviews: true` those
 *      fifteen lose the approval that armed them and stop, and until #2084's own fourth done-when landed
 *      NOTHING IN THIS ORG WOULD HAVE SAID SO.
 *
 * So the ruling is KEEPS on both surfaces, and the real defect is closed by READING the field instead:
 * `work-gate.mjs`'s `pr-review-blocked`. `.claude/rules/agent-practices.md` carries the ruling in full and
 * names what would reopen it -- the 0-of-40 figure moving is the measurement that flips direction 2.
 */
const STALENESS = {
  /** A push dismisses the approving review: no approval outlives the diff it approved. */
  DISMISSES: "DISMISSES",
  /** A review outlives the head it was posted on. The #2084 state, on both surfaces today. */
  KEEPS: "KEEPS",
  /** The surface could not be read, or answered a shape nobody here has measured. NEVER a pass. */
  CANNOT_TELL: "CANNOT_TELL",
} as const;
type StalenessCode = (typeof STALENESS)[keyof typeof STALENESS];

/**
 * THE DECISION OF 2026-09-23, IN ONE PLACE. Change this and the live read below enforces the new one.
 * It is deliberately NOT spelled inline at the assertion: a literal there states a requirement, and what
 * this file can honestly state is a decision, with a date and an argument that a reader can check.
 */
const RULED_STALENESS: StalenessCode = STALENESS.KEEPS;

/** CLASSIC protection's half. Admin-only, so `CANNOT_TELL` is the expected answer on every session here. */
function classicStalenessVerdict(protection: ProtectionRead) {
  const read = protectionReadVerdict(protection);
  if (read.code !== READ.READABLE) {
    return { code: STALENESS.CANNOT_TELL as StalenessCode,
      why: `classic \`dismiss_stale_reviews\` is unreadable: ${read.why}` };
  }
  const reviews = protection.body?.required_pull_request_reviews;
  if (!reviews) {
    return { code: STALENESS.KEEPS as StalenessCode,
      why: "the protection object carries no `required_pull_request_reviews`, so nothing dismisses anything" };
  }
  return dismissalOf(reviews.dismiss_stale_reviews, "classic `dismiss_stale_reviews`");
}

/**
 * THE RULESET's half, and the one an unattended run can actually reach.
 *
 * FAILS CLOSED ON A RULE IT CANNOT JUDGE, exactly as `strongestBinding` does, and for the same reason: a
 * verdict taken from the rules that happened to be readable is a verdict about part of the branch. Several
 * `pull_request` rules may contribute, and if any of them dismisses, a review here is dismissed -- so
 * `DISMISSES` on any one rule decides the whole read.
 */
function rulesetStalenessVerdict(branchRules: BranchRule[] | null) {
  if (branchRules === null) {
    return { code: STALENESS.CANNOT_TELL as StalenessCode,
      why: "`rules/branches/main` could not be read, so the ruleset surface was never examined" };
  }
  const verdicts = branchRules.filter((r) => r.type === "pull_request")
    .map((r) => dismissalOf(r.parameters?.dismiss_stale_reviews_on_push,
      "the ruleset's `dismiss_stale_reviews_on_push`"));
  if (verdicts.length === 0) {
    return { code: STALENESS.KEEPS as StalenessCode,
      why: "no `pull_request` rule applies to `main`, so the ruleset surface dismisses nothing" };
  }
  return verdicts.find((v) => v.code === STALENESS.CANNOT_TELL)
    ?? verdicts.find((v) => v.code === STALENESS.DISMISSES)
    ?? verdicts[0];
}

/**
 * ONE BOOLEAN, THREE ANSWERS. An ABSENT field is `CANNOT_TELL` and never `false`, which is this file's
 * standing discipline for `enforce_admins` and `required_approving_review_count` and is owed here for the
 * same reason: GitHub returns this key on every protection body and every `pull_request` rule read here,
 * so a read without it is an unrecognised shape rather than a cleared field. Reading it as `false` would
 * invent the reassuring answer on the one question this row is about.
 */
function dismissalOf(value: boolean | undefined, field: string) {
  if (typeof value !== "boolean") {
    return { code: STALENESS.CANNOT_TELL as StalenessCode,
      why: `${field} is ${JSON.stringify(value)} rather than a boolean: an unrecognised shape, not a cleared field` };
  }
  return value
    ? { code: STALENESS.DISMISSES as StalenessCode, why: `${field} is true: a push dismisses an approving review` }
    : { code: STALENESS.KEEPS as StalenessCode,
      why: `${field} is false: a review outlives the head it was posted on -- the #2084 state` };
}

/**
 * THE AMENDMENT'S OWN REQUIREMENT, AS A VERDICT. #2084 asked this file to name WHICH surface it means "or
 * a later fix flips one while the acceptance reads green off the other". Naming one is necessary and not
 * sufficient: the failure it describes is the two surfaces DISAGREEING, and only a reader of both can see
 * that. `CANNOT_TELL` on either is not a disagreement -- it is an unexamined half, and it says so.
 */
function surfacesAgree(classic: { code: StalenessCode; why: string }, ruleset: { code: StalenessCode; why: string }) {
  if (classic.code === STALENESS.CANNOT_TELL || ruleset.code === STALENESS.CANNOT_TELL) {
    return { agree: null,
      why: `one surface was not examined -- classic: ${classic.why}; ruleset: ${ruleset.why}` };
  }
  return { agree: classic.code === ruleset.code,
    why: `classic says ${classic.code} and the ruleset says ${ruleset.code}` };
}

const NO_DISMISSAL_RULES: BranchRule[] = [
  { type: "merge_queue", ruleset_id: 23681721 },
  { type: "pull_request", ruleset_id: 23681721,
    parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: false } },
];

test("#2084 THE LIVE SHAPE, BOTH SURFACES: today `main` KEEPS a stale review, and that is the ruling", () => {
  // Byte-for-byte the 2026-09-23 readings: the ruleset rule as `a11ign-ai-workers`, the protection body as
  // `DanBeckDev`. This is the state the row was filed about, and the state the ruling deliberately leaves.
  const ruleset = rulesetStalenessVerdict(NO_DISMISSAL_RULES);
  assert.equal(ruleset.code, STALENESS.KEEPS);
  assert.match(ruleset.why, /the #2084 state/);
  const classic = classicStalenessVerdict({ status: HTTP_OK, protectedFlag: true,
    body: { required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: false },
      enforce_admins: { enabled: true } } });
  assert.equal(classic.code, STALENESS.KEEPS);
  assert.deepEqual(surfacesAgree(classic, ruleset).agree, true);
});

test("#2084: `true` on either surface is DISMISSES -- the state this guard would have to certify", () => {
  // THE POSITIVE CONTROL. Without it the pair above is satisfied by a function that only ever says KEEPS,
  // and the ruling would rest on a verdict whose other value nobody has seen produced.
  assert.equal(rulesetStalenessVerdict([{ type: "pull_request", ruleset_id: 1,
    parameters: { dismiss_stale_reviews_on_push: true } }]).code, STALENESS.DISMISSES);
  assert.equal(classicStalenessVerdict({ status: HTTP_OK, protectedFlag: true,
    body: { required_pull_request_reviews: { dismiss_stale_reviews: true } } }).code, STALENESS.DISMISSES);
});

test("#2084 THE FAILURE THE AMENDMENT NAMED: one surface flipped and the other not is a DISAGREEMENT", () => {
  // "a later fix flips one while the acceptance reads green off the other", in the row's own words. A
  // guard that read only the surface it was pointed at would go green on exactly this input.
  const classic = classicStalenessVerdict({ status: HTTP_OK, protectedFlag: true,
    body: { required_pull_request_reviews: { dismiss_stale_reviews: true } } });
  const ruleset = rulesetStalenessVerdict(NO_DISMISSAL_RULES);
  const agreement = surfacesAgree(classic, ruleset);
  assert.equal(agreement.agree, false);
  assert.match(agreement.why, /classic says DISMISSES and the ruleset says KEEPS/,
    "a disagreement must print both readings, or the reader cannot tell which surface to go and fix");
});

test("#2084: a FORBIDDEN classic read is CANNOT_TELL, and CANNOT_TELL is not a disagreement", () => {
  // The state every session and every CI job here is actually in, and the reason the live assertion below
  // rests on the ruleset. Folding it into KEEPS would report "a review outlives its head" on the strength
  // of a 404, which is the trap the top of this file forbids by name.
  const classic = classicStalenessVerdict({ ...FORBIDDEN_HERE, body: null });
  assert.equal(classic.code, STALENESS.CANNOT_TELL);
  assert.match(classic.why, /FORBIDDEN to this token, NOT absent/);
  const agreement = surfacesAgree(classic, rulesetStalenessVerdict(NO_DISMISSAL_RULES));
  assert.equal(agreement.agree, null, "an unexamined half is not agreement and is not disagreement");
  assert.match(agreement.why, /one surface was not examined/);
});

test("#2084: an ABSENT dismissal field is CANNOT_TELL on BOTH surfaces, never `false`", () => {
  // The same discipline `enforce_admins` and `required_approving_review_count` get above, and owed here
  // for the same reason: GitHub returns these keys on every body and every rule read here, so a read
  // without one is an unrecognised shape. Reading it as `false` would invent the reassuring answer.
  assert.equal(rulesetStalenessVerdict([{ type: "pull_request", ruleset_id: 1,
    parameters: { required_approving_review_count: 1 } }]).code, STALENESS.CANNOT_TELL);
  assert.equal(classicStalenessVerdict({ status: HTTP_OK, protectedFlag: true,
    body: { required_pull_request_reviews: { required_approving_review_count: 1 } } }).code, STALENESS.CANNOT_TELL);
});

test("#2084: an unexaminable ruleset rule FAILS CLOSED even beside one that is readable", () => {
  // `strongestBinding`'s rule, owed here too: a verdict taken from the rules that happened to be readable
  // is a verdict about part of the branch. And `DISMISSES` on ANY contributing rule decides the read,
  // because dismissal composes -- one rule dismissing is enough to dismiss.
  assert.equal(rulesetStalenessVerdict([
    { type: "pull_request", ruleset_id: 1, parameters: { dismiss_stale_reviews_on_push: false } },
    { type: "pull_request", ruleset_id: 2, parameters: {} }]).code, STALENESS.CANNOT_TELL);
  assert.equal(rulesetStalenessVerdict([
    { type: "pull_request", ruleset_id: 1, parameters: { dismiss_stale_reviews_on_push: false } },
    { type: "pull_request", ruleset_id: 2, parameters: { dismiss_stale_reviews_on_push: true } }]).code,
  STALENESS.DISMISSES);
});

test("#2084: the three staleness verdicts are distinct, and none of them spells REQUIRED or BINDS_ME", () => {
  // The guard every vocabulary in this file carries. A later edit wanting one verdict type for every
  // question about `main` is how a weaker claim gets quoted as a stronger one.
  assert.equal(new Set(Object.values(STALENESS)).size, 3);
  assert.equal(Object.values(STALENESS).includes(VERDICT.REQUIRED as never), false);
  assert.equal(Object.values(STALENESS).includes(BINDING.BINDS_ME as never), false);
});

test("#2084 LIVE: `main`'s staleness configuration still matches the recorded ruling", () => {
  // OPT-IN under `A11Y_CHECK_MAIN_RULESET`, sharing #2086's switch rather than minting a third: it is the
  // same endpoint, the same call and the same permission requirement -- none. The classic half is read
  // too and REPORTED rather than asserted, because it cannot be reached without admin, and a check that
  // asserted it would be unpassable on the only token that ever runs unattended.
  if (process.env.A11Y_CHECK_MAIN_RULESET !== "1") {
    console.log("  NOT RUN: the live staleness read is opt-in -- `A11Y_CHECK_MAIN_RULESET=1` asks GitHub "
      + "whether a review outlives the head it was posted on. The verdict logic above ran against "
      + "synthetic inputs; nothing here read the live branch.");
    return;
  }
  const binding = liveRulesetBinding();
  if (binding.branchRules === null) {
    // Never an empty catch and never a pass: a check that could not ask reports that it could not ask.
    console.log("  SKIPPED: `rules/branches/main` could not be asked. NOT a pass.");
    return;
  }
  const ruleset = rulesetStalenessVerdict(binding.branchRules);
  const classic = classicStalenessVerdict(liveProtection(gh));
  console.log(`  LIVE classic surface  : ${classic.code} -- ${classic.why}`);
  console.log(`  LIVE ruleset surface  : ${ruleset.code} -- ${ruleset.why}`);
  console.log(`  LIVE surfaces agree?  : ${JSON.stringify(surfacesAgree(classic, ruleset))}`);
  // THE ASSERTION IS AGAINST THE RECORDED DECISION, IN EITHER DIRECTION. It goes red if somebody turns
  // dismissal on without the ruling that prices it (15 of the last 40 merges stalling, and a refusal still
  // not cleared), and it goes red if the ruling is later changed to DISMISSES and the branch has not
  // followed. "Goes red when it is false" was the row's wording for a decision it expected to go the other
  // way; this is that requirement keyed on the decision rather than on one of its two possible values.
  assert.equal(ruleset.code, RULED_STALENESS,
    `the ruleset surface reads ${ruleset.code} and the 2026-09-23 ruling is ${RULED_STALENESS}: ${ruleset.why}. `
    + "Either the branch was changed without the ruling, or the ruling changed and the branch has not followed.");
  const agreement = surfacesAgree(classic, ruleset);
  assert.notEqual(agreement.agree, false,
    `the two staleness surfaces DISAGREE -- ${agreement.why}. #2084's amendment: changing one does not move `
    + "the other, so a guard reading either alone goes green while the branch is half-configured.");
  console.log(`  LIVE PASS (no admin required): \`main\` ${ruleset.code} a stale review, as ruled 2026-09-23`);
});
