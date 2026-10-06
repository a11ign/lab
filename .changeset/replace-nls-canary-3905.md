---
"@a11ign/lab": patch
---

`gate:stability` replaces its `nls.uk` canary with W3C's APG disclosure-navigation page (a11ign/a11ign#3905). The `nls.uk` page is first-visit-only by construction (Civic Cookie Control, `notifyOnce: true`), so a cold profile's first capture was a different page from the other four and the gate read UNSTABLE for a reason that is the page's. The replacement serves no client storage and no consent panel; the gate's harness is unchanged and does not discard a first capture.
