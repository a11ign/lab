/**
 * #3133 — THE PLATFORM OPENS DEPENDENCY PULL REQUESTS, AND `.github/dependabot.yml` SAYS HOW.
 *
 * ADR 0041 decision 4: "a new release of a dependency opens a dependency PR in each consumer, so the platform
 * does it." The file is the whole mechanism, so the test pins the four choices the row names: the `npm`
 * ecosystem at the root, a daily schedule, NO catch-all group (small and frequent is the point), and a title
 * prefix the org's gate recognises a dependency pull request by.
 *
 * `violations()` is the instrument and is run on the real file AND on fixtures that each break one choice,
 * because a checker that has never said no is not known to be able to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO = resolve(import.meta.dirname, "../../../..");
const CONFIG = ".github/dependabot.yml";

interface Update {
  "package-ecosystem"?: string;
  directory?: string;
  schedule?: { interval?: string };
  groups?: Record<string, { patterns?: string[] }>;
  "commit-message"?: { prefix?: string };
  ignore?: { "dependency-name"?: string }[];
}
interface Config { version?: number; updates?: Update[] }

const read = (): Config => parseYaml(readFileSync(resolve(REPO, CONFIG), "utf8")) as Config;

/** A group with no `patterns`, or one that matches every name, is the one-PR-for-everything the row refuses. */
const batchesEverything = (group: { patterns?: string[] }) =>
  !group.patterns?.length || group.patterns.some((p) => /^\*+$/.test(p));

/** `npm` covers the registry; `github-actions` covers the sha pin of the reusable release workflow (#3775). */
const ECOSYSTEMS = ["npm", "github-actions"] as const;

/**
 * #3804: `consumer-gate.yml` is generated and holds its `a11ign/a11ign` pin at four sites a check compares, so the
 * `github-actions` entry ignores exactly that and nothing else: `a11ign/toolchain` and the `actions/*` pins stay moving.
 */
const GENERATED_PIN = "a11ign/a11ign";

const ignoredNames = (update: Update) => (update.ignore ?? []).map((i) => i["dependency-name"]).sort();

function actionsIgnoreViolations(update: Update): string[] {
  const ignored = ignoredNames(update);
  const found: string[] = [];
  if (!ignored.includes(GENERATED_PIN)) found.push(`\`${GENERATED_PIN}\` is not ignored: Dependabot would rewrite one of the four sites of the generated pin`);
  const others = ignored.filter((name) => name !== GENERATED_PIN);
  if (others.length) found.push(`ignores ${others.join(", ")}, which must keep moving`);
  return found;
}

function violations(config: Config, ecosystem: (typeof ECOSYSTEMS)[number] = "npm"): string[] {
  const update = (config.updates ?? []).find((u) => u["package-ecosystem"] === ecosystem && u.directory === "/");
  if (!update) return [`no \`${ecosystem}\` update at directory \`/\``];
  const found: string[] = [];
  if (update.schedule?.interval !== "daily") found.push(`schedule is ${update.schedule?.interval}, not daily`);
  for (const [name, group] of Object.entries(update.groups ?? {})) {
    if (batchesEverything(group)) found.push(`group \`${name}\` batches every package into one pull request`);
  }
  if (!update["commit-message"]?.prefix) found.push("no commit-message prefix to recognise a dependency pull request by");
  if (ecosystem === "github-actions") found.push(...actionsIgnoreViolations(update));
  return found;
}

/** The root manifest plus one per `packages/*` directory, which is the workspace `pnpm-workspace.yaml` declares. */
const manifests = () => {
  const packages = readdirSync(resolve(REPO, "packages")).map((d) => `packages/${d}/package.json`);
  const files = ["package.json", ...packages].filter((f) => existsSync(resolve(REPO, f)));
  return files.map((f) => JSON.parse(readFileSync(resolve(REPO, f), "utf8")) as
    { name: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string> });
};

const declared = () => manifests().flatMap((m) =>
  [m.dependencies, m.devDependencies, m.optionalDependencies].flatMap((d) => Object.entries(d ?? {})));

test("#3133: the committed dependabot.yml is accepted", () => {
  for (const ecosystem of ECOSYSTEMS) assert.deepEqual(violations(read(), ecosystem), [], ecosystem);
  assert.equal(read().version, 2);
});

test("#3133 POSITIVE CONTROL: the checker REFUSES a config that breaks each choice", () => {
  const good = read();
  const [npm] = good.updates as [Update];
  assert.match(violations({ ...good, updates: [] })[0] as string, /no `npm` update/);
  assert.match(violations({ ...good, updates: [{ ...npm, "package-ecosystem": "github-actions" }] })[0] as string, /no `npm` update/);
  assert.match(violations({ ...good, updates: [{ ...npm, schedule: { interval: "weekly" } }] })[0] as string, /not daily/);
  assert.match(violations({ ...good, updates: [{ ...npm, groups: { all: { patterns: ["*"] } } }] })[0] as string, /every package/);
  assert.match(violations({ ...good, updates: [{ ...npm, groups: { all: {} } }] })[0] as string, /every package/);
  assert.match(violations({ ...good, updates: [{ ...npm, "commit-message": {} }] })[0] as string, /prefix/);
  // #3775: the same refusals hold for the `github-actions` entry, and the file without it is refused NAMING it.
  const withoutActions = { ...good, updates: good.updates?.filter((u) => u["package-ecosystem"] !== "github-actions") };
  assert.match(violations(withoutActions, "github-actions")[0] as string, /no `github-actions` update/);
  const actions = good.updates?.find((u) => u["package-ecosystem"] === "github-actions") as Update;
  assert.match(violations({ ...good, updates: [{ ...actions, schedule: { interval: "weekly" } }] }, "github-actions")[0] as string, /not daily/);
  assert.match(violations({ ...good, updates: [{ ...actions, groups: { all: { patterns: ["*"] } } }] }, "github-actions")[0] as string, /every package/);
  assert.match(violations({ ...good, updates: [{ ...actions, "commit-message": {} }] }, "github-actions")[0] as string, /prefix/);
  // #3804: the generated pin is ignored, and ONLY it. Each refusal is shown on a fixture that breaks that one choice.
  assert.match(violations({ ...good, updates: [{ ...actions, ignore: undefined }] }, "github-actions")[0] as string, /`a11ign\/a11ign` is not ignored/);
  assert.match(violations({ ...good, updates: [{ ...actions, ignore: [{ "dependency-name": "a11ign/toolchain" }] }] }, "github-actions").join("\n"), /not ignored/);
  const overBroad = { ...actions, ignore: [GENERATED_PIN, "a11ign/toolchain", "actions/checkout"].map((name) => ({ "dependency-name": name })) };
  assert.match(violations({ ...good, updates: [overBroad] }, "github-actions")[0] as string, /ignores a11ign\/toolchain, actions\/checkout, which must keep moving/);
  // And the `npm` entry is not asked for it, or the check above would be an `npm` rule in disguise.
  assert.deepEqual(violations({ ...good, updates: [{ ...npm, ignore: [] }] }), []);
  // A per-package group is small and stays allowed, or "refuses every group" would pass the above.
  assert.deepEqual(violations({ ...good, updates: [{ ...npm, groups: { vitest: { patterns: ["vitest*"] } } }] }), []);
});

test("#3133 POSITIVE CONTROL: the manifests declare range dependencies", () => {
  const all = declared();
  assert.ok(all.length > 0, "the population this config serves is not empty");
  assert.ok(all.some(([, spec]) => /^[\^~]/.test(spec)), "and holds registry ranges");
});

test("#3133: `ignore` is exactly the workspace members the manifests depend on", () => {
  const members = new Set(manifests().map((m) => m.name));
  const internal = [...new Set(declared().map(([name]) => name).filter((name) => members.has(name)))].sort();
  const ignored = (read().updates?.[0]?.ignore ?? []).map((i) => i["dependency-name"]).sort();
  assert.ok(internal.includes("@a11ign/evidence"), "the derivation finds a member it must find");
  assert.deepEqual(ignored, internal,
    "a workspace member is pinned and linked, so Dependabot must not offer the registry's copy over it; "
    + "a member that left the workspace is consumed by range and must come OFF this list");
});
