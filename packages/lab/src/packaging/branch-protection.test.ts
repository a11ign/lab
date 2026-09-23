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

type BranchRule = { type?: string; ruleset_id?: number; parameters?: { required_approving_review_count?: number } };
type RulesetBinding = {
  /** `GET /repos/{o}/{r}/rules/branches/main` -- any token that can read the repo; null when unreadable. */
  branchRules: BranchRule[] | null;
  /** `enforcement` of the ruleset the biting rule came from; null when unreadable. */
  enforcement: string | null;
  /** `current_user_can_bypass`: "always" | "pull_requests_only" | "never" | "exempt"; null when unreadable. */
  canBypass: string | null;
};

/** The only value that means "this identity is bound"; every other value, known or not, means it is not. */
const NOT_BYPASSABLE = "never";

/** Existence and strength, from the branch-keyed endpoint. Most restrictive wins, as requirements compose. */
function ruleAppliesVerdict({ branchRules, enforcement, canBypass }: RulesetBinding) {
  if (branchRules === null) {
    return { code: BINDING.CANNOT_TELL as BindingCode,
      why: "`rules/branches/main` could not be read, so nothing is known about which rules apply" };
  }
  const prRules = branchRules.filter((r) => r.type === "pull_request");
  if (prRules.length === 0) {
    return { code: BINDING.ABSENT as BindingCode,
      why: "no `pull_request` rule applies to `main`: the ruleset surface requires no approval -- the pre-#2086 shape" };
  }
  const counts = prRules.map((r) => r.parameters?.required_approving_review_count);
  if (counts.some((c) => typeof c !== "number")) {
    // Deliberately NOT read as zero. GitHub returns this parameter on every `pull_request` rule seen here,
    // so a rule without it is an unrecognised shape rather than a cleared field -- the same discipline
    // `enforce_admins` gets above, and for the same reason: nobody has measured the absent case.
    return { code: BINDING.CANNOT_TELL as BindingCode,
      why: "a `pull_request` rule carries no `required_approving_review_count` -- an unrecognised shape, not a cleared field" };
  }
  const required = Math.max(...(counts as number[]));
  if (required < 1) {
    return { code: BINDING.DECORATIVE as BindingCode,
      why: `the \`pull_request\` rule applies and asks for ${required} approvals: it exists and demands nothing` };
  }
  return bindsMeVerdict({ enforcement, canBypass }, `a \`pull_request\` rule requires ${required} approval(s) on \`main\``);
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
function bindsMeVerdict({ enforcement, canBypass }: Omit<RulesetBinding, "branchRules">, why: string) {
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

const BINDS = (over: Partial<RulesetBinding> = {}): RulesetBinding => ({
  branchRules: [
    { type: "merge_queue", ruleset_id: 23681721 },
    { type: "pull_request", ruleset_id: 23681721, parameters: { required_approving_review_count: 1 } },
  ],
  enforcement: "active",
  canBypass: "never",
  ...over,
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
});

/**
 * Both halves of the ruleset state, with the id taken from the branch-keyed read rather than hardcoded.
 *
 * #2086's own Open-check flagged the hardcoded `rulesets/23681721` as rot waiting to happen, with "re-read
 * the list for its id" as the manual recovery. Taking `ruleset_id` off the rule that was actually found
 * removes the id from this file altogether: there is nothing left to go stale, and a rule served by a
 * different or re-created ruleset is followed automatically.
 */
function liveRulesetBinding(): RulesetBinding {
  let branchRules: BranchRule[];
  try {
    branchRules = JSON.parse(gh(["api", "repos/a11ign/a11ign/rules/branches/main"]));
  } catch (cause) {
    console.log(`  \`rules/branches/main\` could not be read (${String(cause)}).`);
    return { branchRules: null, enforcement: null, canBypass: null };
  }
  const rulesetId = branchRules?.find((r) => r.type === "pull_request")?.ruleset_id;
  if (rulesetId === undefined) return { branchRules, enforcement: null, canBypass: null };
  try {
    const ruleset = JSON.parse(gh(["api", `repos/a11ign/a11ign/rulesets/${rulesetId}`]));
    return { branchRules, enforcement: ruleset.enforcement ?? null, canBypass: ruleset.current_user_can_bypass ?? null };
  } catch (cause) {
    console.log(`  \`rulesets/${rulesetId}\` could not be read (${String(cause)}); the exemption half is unavailable.`);
    return { branchRules, enforcement: null, canBypass: null };
  }
}

/**
 * THE OTHER EXEMPTION SURFACES, AND WHICH OF THEM THIS FILE PINS.
 *
 * `ceo` asked for `enforce_admins` and the `merge-queue-main` ruleset's `bypass_actors` pinned "only if
 * cheap" (#2022, comment 5787499206). `enforce_admins` is cheap and is pinned above: it arrives inside the
 * protection body this guard already reads, so it costs no call and one branch.
 *
 * THE RULESET'S `bypass_actors` IS STILL NOT PINNED, AND THE REASON IS A MEASUREMENT RATHER THAN AN
 * ESTIMATE OF EFFORT. Read on 2026-09-23 against the same ruleset, seconds apart, by two identities:
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
 * FIXED permission level on both sides of a real change. Pinning it would put two contradictory absence
 * rules in one guard, keyed on the token rather than on the field -- the shape this whole file exists to
 * refuse.
 *
 * WHAT #2086 ADDED INSTEAD, AND THE ONE LINE OF THIS BLOCK THAT WENT STALE. Until `ceo`'s ruling this
 * paragraph ended "the review requirement lives in classic branch protection, not here", and that is no
 * longer true: `merge-queue-main` has carried a `pull_request` rule since 2026-09-23T09:03Z. The sentence
 * is corrected rather than deleted because the reasoning around it still holds --
 * `current_user_can_bypass` answers the exemption question PER IDENTITY and needs no admin, and it is
 * still not a substitute for the admin read above, only a cheaper instrument that certifies less.
 *
 * TWO THINGS THIS FILE DELIBERATELY DOES NOT ASSERT, so that a later reader does not mistake the silence
 * for an oversight:
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
 *     #2086's Region of one file. Reported to `product-manager` as the follow-up rather than smuggled in.
 */
