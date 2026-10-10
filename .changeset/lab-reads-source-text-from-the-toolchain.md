---
"@a11ign/lab": patch
---

The lab's 40 source-reading tests import `stripComments` from `@a11ign/toolchain/lib/source-text` instead of `@a11ign/evidence/source-text`, which the core removes in its next evidence release (a11ign/a11ign#4712, #4425 phase 3). `devDependencies["@a11ign/toolchain"]` moves `0.1.5` to `0.7.0`, the first release that exports `./lib/source-text` in the 0.5 to 0.7 range (0.1.5, 0.2.0, 0.3.0 and 0.4.0 do not), and `ci.yml` reads that same field to install the layout check, so the layout check runs at 0.7.0 after this change. `stripComments` is byte-identical across the two on all 1,653 tracked text files of the lab and the core (a11ign/a11ign#4720).
