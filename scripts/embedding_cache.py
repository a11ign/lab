"""Cache the frozen encoder's output, because it is a deterministic function of unchanged inputs.

Measured on the lab container (2 cores of an i3-7100T): `encode_records` 144.1 s over 35,764 evidence
units and `encode_documents` 101.6 s over 2,006 documents -- 245.8 s of a ~290 s training run, so **85%
of a retrain is recomputing embeddings that did not change**. Four retrains in one evening paid it four
times over byte-identical input while iterating on LABELS and POOLING, neither of which the encoder sees:
labels live in `target`, and pooling only selects which precomputed view a head reads.

This is worth more than a GPU and costs nothing. There is no GPU on this host anyway -- integrated
HD Graphics 630, and onnxruntime offers only CPUExecutionProvider -- but even with one, a cache removes
the work rather than making it faster.

## It lives in the LAB, not in the scorer package

`screenreader_features.py` is shipped and runs at inference, where a capture is encoded once and never
again. Caching there would add disk I/O and a staleness risk to the hot path for no gain. The programs
that re-encode the same corpus repeatedly are all lab tooling, so the wrapper is too.

## The key is the whole contract, not just the text

A stale embedding is invisible: it produces confident numbers from the wrong representation, which is
this repo's most expensive recurring failure. So the key covers everything that can change a vector --
the encoder's own bytes, `max_length`, the feature schema version, the engineered feature names, their
scale and their multipliers, and a hash of exactly the record `input` fields that get encoded.

It deliberately does NOT cover `target`. Relabelling changes what the heads learn and cannot change what
the encoder produced; excluding it is the entire point, and including it would silently disable the cache
for the workflow it exists to serve.

## Verified by the artifact, not by the timing

Cold and warm runs produce a BYTE-IDENTICAL `training-report.json`. The weight files differ, and that is
not the cache: two warm runs differ from each other too, so training is not bit-reproducible on CPU
despite the fixed seed -- parallel reductions in torch do not have a fixed order. Worth knowing before
anyone diffs two weight files and concludes something changed. The report is the comparable artifact.

Measured on this Mac: 86.3 s cold, 19.5 s warm, and 818 s of CPU down to 72 s.

## It grows, and clearing it is deliberately manual

One entry per distinct corpus fingerprint, ~62 MB each, under `runs/` (gitignored). A label iteration
does not add one; a change to the pages, the encoder or the feature schema does. `rm -rf` is the whole
management story, and like `corpus:snapshot` it is left to a human rather than automated away, because
the failure mode of an over-eager cleanup here is a 4-minute recompute and the failure mode of a stale
entry is silence.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

CACHE_ROOT = Path(os.environ.get("A11Y_EMBEDDING_CACHE", "runs/embedding-cache"))


def _fingerprint(training: Any, records: list[dict[str, Any]], encoder_file: Path, max_length: int) -> str:
    digest = hashlib.sha256()
    # Every term is length-prefixed via json.dumps, so two different fields cannot concatenate into the
    # same byte string -- the classic way a composite key collides without anyone noticing.
    for part in (
        training.sha256(encoder_file),
        str(max_length),
        training.FEATURE_SCHEMA_VERSION,
        json.dumps(list(training.FEATURE_NAMES)),
        str(training.ENGINEERED_FEATURE_SCALE),
        json.dumps(training.ENGINEERED_FEATURE_MULTIPLIERS, sort_keys=True),
    ):
        digest.update(json.dumps(part).encode("utf-8"))
    for record in records:
        digest.update(json.dumps(record.get("input"), sort_keys=True).encode("utf-8"))
    return digest.hexdigest()[:32]


def cached_encode(training: Any, records: list[dict[str, Any]], encoder: Path, max_length: int) -> tuple[Any, Any, int, int]:
    """`(unit_features, document_features, document_offsets, dimension, structured_dimension)`, cached.

    Both views together under ONE key, because every caller needs both and a half-populated cache is a
    way for the two to come from different encoder versions.
    """
    import numpy as np

    encoder_file = training.assert_encoder(encoder)
    key = _fingerprint(training, records, encoder_file, max_length)
    path = CACHE_ROOT / f"{key}.npz"
    if path.is_file():
        with np.load(path) as stored:
            return (
                stored["units"], stored["documents"], stored["offsets"].tolist(),
                int(stored["dimension"]), int(stored["structured_dimension"]),
            )
    units, dimension, structured_dimension = training.encode_records(records, encoder, max_length)
    documents, offsets = training.encode_documents(records, encoder, max_length)
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    # Written to a temporary name and renamed, so an interrupted run cannot leave a truncated file that
    # a later run loads as though it were complete.
    #
    # The temporary name must END in `.npz`: `np.savez` silently appends the extension when it is absent,
    # so a `.npz.partial` target produced `.npz.partial.npz` on disk and the rename then failed on a file
    # that had never existed. Loudly, which is the only reason it is not still there.
    temporary = path.with_name(path.name + ".partial.npz")
    np.savez(
        temporary, units=units, documents=documents, offsets=np.asarray(offsets, dtype=np.int64),
        dimension=dimension, structured_dimension=structured_dimension,
    )
    temporary.replace(path)
    return units, documents, offsets, dimension, structured_dimension
