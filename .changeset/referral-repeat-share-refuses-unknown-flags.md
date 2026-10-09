---
"@a11ign/lab": patch
---

`scripts/referral-repeat-share.ts` refuses an unknown flag (`refuseUnknownFlags`, exit 2, as every other lab CLI does) instead of reading it as a file path, so control's `cli-flags` test, which discovers CLIs by reading their source, stops flagging it (a11ign/a11ign#4580, blocks #4575).
