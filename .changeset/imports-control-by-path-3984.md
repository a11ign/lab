---
"@a11ign/lab": patch
---

`gate:stability` can capture on a host that holds the lab LAID (a11ign/a11ign#3984). Two lab files imported `@a11ign/control` by NAME (`training/wake-by-hand.mjs`, `fleet-wake`, and `harnesses/occurrence-verdict-stability.mjs`, `layer-checkouts`), and on the lab host nothing provides that name: the package is on no registry and control is laid as `src/` with no manifest, so every canary died with `ERR_MODULE_NOT_FOUND` and 0 of 45 captures were taken. Both now import control's laid `src` by relative path, the way the lab already reaches the core's `guards/src`, and `layer-edges.baseline.json` records the two edges.
