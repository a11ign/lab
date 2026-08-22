"""A MECHANISM PROBE for ADR 0015. Its output must never train a shipped model.

ADR 0015 measured 225 free vetoes: every head penalises features that are 0 on all of its training
positives, because the corpus gives each page exactly one defect. Decision 1 is to generate pages that
fail one way while carrying other criteria's evidence. That is days of capture, so this splices the effect
out of records already on disk and answers one question first: DOES removing the separation remove the
vetoes?

It composes each record with a donor from another family, rotating donors so every marker feature is
paired with every subtype's positives rather than left to chance. Two kinds of donor, and the difference
is the interesting part:

  - Most markers are CONFORMANT structure a real page carries incidentally (tables, named fields, a
    post-submit message). A clean record donates those and the label is unchanged.
  - `vague_link_present`, `generic_heading_present` and `unnamed_graphic_present` are on NO clean record,
    because they ARE failures (2.4.4, 2.4.6, 1.1.1). Nothing conformant can supply them, so those need a
    failing donor and the label is the UNION -- a page failing two criteria at once, which is what a real
    page does and what this corpus has never contained.

`family` is preserved so a composed record and its original can never straddle the train/test split.

MEASURED (see ADR 0015, "Proved 2026-08-22"): vetoes 279 -> 113, and the spread across three real pages
announcing the identical control fell 0.4139 -> 0.0526. It also cost 8 held-out false positives on 3.3.2,
which is why this is a probe and not a corpus: spliced transcripts are not coherent pages, so it cannot
tell "the veto was load-bearing" from "the input is incoherent". Only real multi-defect pages can.
"""
import json, sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, "packages/scorer/python")
import screenreader_features as F

src, dst = sys.argv[1], sys.argv[2]
records = [json.loads(l) for l in Path(src).read_text().splitlines() if l.strip()]

def clean(r):
    t = r.get("target", {})
    return not (t.get("subtypes") or []) and not (t.get("criteria") or [])

# The features a real page would carry from OTHER criteria. A donor is filed under each one it has, so a
# record can be paired with a donor that supplies the specific structure its positives never see.
MARKERS = ["table_present", "form_field_named", "vague_link_present", "generic_heading_present",
           "state_changed", "unnamed_graphic_present", "status_update_announced", "post_submit_present",
           "plain_heading_candidate_present", "form_change_present", "table_header_associated"]

# Two kinds of donor, and the difference is not cosmetic.
#
# Most markers are CONFORMANT structure a real page carries incidentally -- tables, named fields, a
# post-submit message. A clean record can donate those and the composed label is unchanged.
#
# But `vague_link_present`, `generic_heading_present` and `unnamed_graphic_present` are never on a clean
# record, because they ARE failures (2.4.4, 2.4.6, 1.1.1). Nothing conformant can supply them. So those
# need a FAILING donor and the composed label is the UNION -- a page that fails two criteria at once,
# which is what a real page does and what this corpus has never contained.
conformant_donors, failing_donors = defaultdict(list), defaultdict(list)
for r in records:
    v = F.structured_feature_values(r)
    for m in MARKERS:
        if v[m]:
            (conformant_donors if clean(r) else failing_donors)[m].append(r)
donors = {m: (conformant_donors[m] or failing_donors[m]) for m in MARKERS}
missing = [m for m in MARKERS if not donors[m]]
if missing:
    raise SystemExit(f"nothing in the corpus carries {missing} -- cannot compose without inventing evidence")
print("markers needing a FAILING donor (no conformant page has them):",
      [m for m in MARKERS if not conformant_donors[m]])

def merge(a, b):
    return list(a or []) + list(b or [])

composed = []
for index, record in enumerate(records):
    # One composed record per marker per record would be 11x the corpus. Rotate instead, so every marker
    # is paired with every subtype's positives across the corpus without multiplying its size.
    marker = MARKERS[index % len(MARKERS)]
    pool = [d for d in donors[marker] if d["provenance"]["family"] != record["provenance"]["family"]]
    if not pool:
        continue
    donor = pool[index % len(pool)]
    s, ds = record["input"].get("structure") or {}, donor["input"].get("structure") or {}
    i, di = record["input"].get("interaction") or {}, donor["input"].get("interaction") or {}
    units = merge(record["input"].get("evidenceUnits"), donor["input"].get("evidenceUnits"))
    composed.append({
        "input": {**record["input"],
                  "transcript": merge(record["input"].get("transcript"), donor["input"].get("transcript")),
                  "structure": {k: merge(s.get(k), ds.get(k))
                                for k in ("headings", "landmarks", "formFields", "graphics", "links",
                                          "lists", "tableCells")},
                  "interaction": {**i,
                                  "controls": merge(i.get("controls"), di.get("controls")),
                                  "stateChanges": merge(i.get("stateChanges"), di.get("stateChanges")),
                                  "formChanges": merge(i.get("formChanges"), di.get("formChanges")),
                                  "postSubmitFields": merge(i.get("postSubmitFields"),
                                                            di.get("postSubmitFields"))},
                  "evidenceUnits": units,
                  "evidenceText": "\n".join(u["text"] for u in units)},
        # The union, so a composed record claims exactly the defects its two halves had. For a clean
        # donor this is the original's label unchanged; for a failing donor it is a genuinely two-defect
        # page, which is the case the corpus has never contained.
        "target": {**record["target"],
                   "criteria": sorted(set(record["target"].get("criteria") or [])
                                      | set(donor["target"].get("criteria") or [])),
                   "subtypes": sorted(set(record["target"].get("subtypes") or [])
                                      | set(donor["target"].get("subtypes") or [])),
                   "label": "clean" if clean(record) and clean(donor) else "violation"},
        "provenance": {**record["provenance"],
                       "caseId": f"{record['provenance']['caseId']}+{marker}",
                       "mutation": f"{record['provenance'].get('mutation','')} PLUS the conformant "
                                   f"structure of {donor['provenance']['caseId']} ({marker})"},
    })

Path(dst).write_text("\n".join(json.dumps(r) for r in records + composed) + "\n")
print(f"{len(records)} original + {len(composed)} composed -> {dst}")
