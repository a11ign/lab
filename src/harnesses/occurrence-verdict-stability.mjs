// TRANSITIONAL (a11ign/a11ign#4519): the harness is `occurrence-verdict-stability.ts`. This name stays for ONE release only because the core at the
// `CORE_REF` this repository's CI pins still names it (package.json, workflows), and `referenced-scripts.test.ts` reads those names. It THROWS rather
// than re-exporting: `occurrence-verdict-stability.ts` runs only when it is the entry file, so a re-export would exit 0 having measured nothing.
throw new Error("occurrence-verdict-stability.mjs is now occurrence-verdict-stability.ts (a11ign/a11ign#4519): run the .ts");
