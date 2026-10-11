"""Where the published `@a11ign/scorer` keeps its Python, for the tests that import its featurizer.

These tests used to put `packages/scorer/python` on `sys.path`, a path into the CORE's tree. The lab does not
read another repository's source (ADR 0045, Decision 1 rule 2): the featurizer ships in the package, so it is
found where Node would find the package, in the nearest `node_modules/@a11ign/scorer` above this file. A lab
checkout with its own install has one at its root; the lab laid inside the core finds the workspace's link.

`A11Y_SCORER_PYTHON` names the directory outright, for a host that holds the package somewhere else.
"""
from __future__ import annotations

import os
from pathlib import Path


def scorer_python() -> Path:
    named = os.environ.get("A11Y_SCORER_PYTHON")
    if named:
        return Path(named)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "node_modules" / "@a11ign" / "scorer" / "python"
        if (candidate / "screenreader_features.py").is_file():
            return candidate
    raise FileNotFoundError(
        "no node_modules/@a11ign/scorer/python above this file: install the lab's dependencies, or set "
        "A11Y_SCORER_PYTHON to the directory holding screenreader_features.py")
