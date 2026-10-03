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

function violations(config: Config): string[] {
  const npm = (config.updates ?? []).find((u) => u["package-ecosystem"] === "npm" && u.directory === "/");
  if (!npm) return ["no `npm` update at directory `/`"];
  const found: string[] = [];
  if (npm.schedule?.interval !== "daily") found.push(`schedule is ${npm.schedule?.interval}, not daily`);
  for (const [name, group] of Object.entries(npm.groups ?? {})) {
    if (batchesEverything(group)) found.push(`group \`${name}\` batches every package into one pull request`);
  }
  if (!npm["commit-message"]?.prefix) found.push("no commit-message prefix to recognise a dependency pull request by");
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
  assert.deepEqual(violations(read()), []);
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
  // A per-package group is small and stays allowed, or "refuses every group" would pass the above.
  assert.deepEqual(violations({ ...good, updates: [{ ...npm, groups: { vitest: { patterns: ["vitest*"] } } }] }), []);
});

test("#3133 POSITIVE CONTROL: the manifests declare range dependencies and the `agent-org` git pin", () => {
  const all = declared();
  assert.ok(all.length > 0, "the population this config serves is not empty");
  assert.ok(all.some(([, spec]) => /^[\^~]/.test(spec)), "and holds registry ranges");
  const pin = all.find(([name]) => name === "agent-org");
  assert.match(pin?.[1] ?? "", /^github:a11ign\/agent-org#semver:/, "and holds the git pin Dependabot must read");
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
