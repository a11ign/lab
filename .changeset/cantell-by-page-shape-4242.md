---
"@a11ign/lab": patch
---

`packages/lab/scripts/cantell-by-page-shape.mjs` groups the recorded abstention sweep's calibration pages by the shape their corpus entry declares (`demonstrates` matching `/table|filter/i`, else other) and prints, per group, the page count, the mean `cantTell` criteria per page and the share of pages on which 4.1.3 and 3.3.1 are `cantTell`, with whether the table/filter mean is at least twice the other group's. It scores nothing and refuses, exit 2, when no sweep is recorded. a11ign/a11ign#4242.
