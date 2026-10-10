// TRANSITIONAL (a11ign/a11ign#4519): the gate is `qualification-status.ts`. This name stays for ONE release only because `@a11ign/control` at the tag the core pins
// (`post-qualification-status.ts`, v0.3.2 and earlier) imports `../../lab/src/gates/qualification-status.mjs`. A re-export, so that import keeps resolving.
export * from "./qualification-status.ts";
