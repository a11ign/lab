---
"@a11ign/lab": patch
---

lab follows the core past the js-to-ts renames (#4273, #4274) and the agent-org reach rules (#4408, #4409, #4411): `CORE_REF` moves to `a7d6a4158`, the pin on the tool's tag is gone (`ci.yml` resolves the newest tag again, and `ci-composition.test.ts` asserts the resolver), relative specifiers into the core name `.ts` where the core renamed, and `scripts/tool-source.ts` resolves the tool's sources through its declared exports because `scripts/agent-org-newest-tag.mjs` no longer exports `toolModule`, `toolPath` and `toolUrl`. The `layer-edges` baseline is regenerated with dispositions carried across the renames (a11ign/a11ign#4427).
