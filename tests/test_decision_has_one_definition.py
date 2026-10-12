""""Does this subtype fire?" must have ONE definition, and nothing may answer it privately.

It had two. `score.py` compared `value >= threshold` in its scoring loop, and
`evaluate-screenreader-acceptance.py` did the same thing again over numpy arrays. Adding the applicability
gate to the first left the second untouched — so the gate was live in the product and absent from the
held-out measurement that judges the product, and the acceptance run went on scoring pages the product
rules inapplicable.

The failure mode is worse than a plain bug. The gate was correct, committed, tested, and produced NO
CHANGE in the number, which reads as "the fix did not work" and argues for abandoning a correct change.
That is `refreshBrowseBuffer` exactly — a remedy reachable from one path, confirmed by results it had no
part in producing — committed here while fixing something else.

So: the evaluator must route through `applicability.decide`, and may not compare a subtype score to a
threshold itself. Asserted on source text because the alternative is loading a model and scoring a corpus,
and a guard that costs that much is one that does not run.

This file covers the lab's half only. `score.py` is the scorer package's own file and its half of the same
guard stays with the core, where that file lives.
"""
import ast
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

#: Every file that decides whether a subtype fires. A new one must be added here deliberately.
DECIDERS = [
    REPO / "scripts" / "evaluate-screenreader-acceptance.py",
]

ORDERING = (ast.Lt, ast.LtE, ast.Gt, ast.GtE)

#: The word the guard hunts. Matched against an operand's SOURCE TEXT, so `subtype_report["threshold"]`,
#: `float(report["threshold"])` and a bare `threshold` all count, and a subscript key cannot hide it.
THRESHOLD = re.compile(r"threshold", re.IGNORECASE)

#: ...but only where a SUBTYPE is being decided. A threshold comparison in the evaluator that is
#: legitimately not a decision is excluded by SHAPE rather than by an allowlist, because a name-based
#: exemption rots the moment a line moves: `metrics()` counts an already-decided 0/1 array against a fixed
#: cut; it is arithmetic over a verdict somebody else reached, not the verdict. It names no subtype,
#: and a subtype decision necessarily does.
#:
#: This exempted a second one until #1927: the repeat-stability check, as "a question about determinism,
#: not a finding about a page". It was a finding -- comparing raw scores, it failed the gate on a capture
#: the product ruled inapplicable (#1921) -- and it now calls `applicability.decide` like everything else.
#: The shape exemption still admits any comparison that does not name a subtype; on 2026-09-22
#: `metrics()` was the only one left in either decider. `test_acceptance_stability.py` pins the stability
#: case behaviourally, because this guard is what let it through.
SUBTYPE_NAME = re.compile(r"subtype", re.IGNORECASE)

#: ...where "names a subtype" means the comparison's own text OR a subtype the comparison sits INSIDE: a
#: parameter of the function around it, or the target of a loop or comprehension around it. The row's own
#: injection is `def _would_fire(subtype, score, threshold): return threshold <= score` -- the subtype is
#: on the `def` line and the comparison is on the next, so a test of the comparison's line alone can never
#: see it, whichever operators it learns.


def _operands_of(comparison: ast.Compare) -> list[ast.expr]:
    return [comparison.left, *comparison.comparators]


def _is_a_score_against_a_cut(comparison: ast.Compare, source: str) -> bool:
    """ORDERING operator, a threshold on one side, and on the OTHER something that is neither a literal
    nor itself a threshold -- which is to say a score.

    THE OPERAND SHAPE, NOT THE OPERATOR, and that is the whole of this function. The guard used to match
    `>=` and nothing else, so `floor <= score < float(report["threshold"])` -- a subtype decision written
    the other way round, in a decider -- passed it green (#2234, and it did, for the life of #2213's first
    head). Widening the operator alone catches `if not 0.0 <= subtype_threshold <= 1.0`, a RANGE CHECK on
    a configured cut: arithmetic about whether a number is valid, not a verdict about a page. What
    separates them is what the cut is compared TO: a score is neither a constant nor a threshold, and a
    range check compares the threshold to its own literal bounds. Direction never enters.

    A range check written with two VARIABLE bounds would read as a decision and trip the guard; that is
    the right way round to be wrong, and the fix is to say what the bounds are, not to exempt the line."""
    if not any(isinstance(op, ORDERING) for op in comparison.ops):
        return False
    operands = _operands_of(comparison)
    texts = [ast.get_source_segment(source, operand) or "" for operand in operands]
    has_a_cut = any(THRESHOLD.search(text) for text in texts)
    has_a_score = any(
        not isinstance(operand, ast.Constant) and not THRESHOLD.search(text)
        for operand, text in zip(operands, texts)
    )
    return has_a_cut and has_a_score


def _names_in(node: ast.AST) -> list[str]:
    return [n.id for n in ast.walk(node) if isinstance(n, ast.Name)] + [
        n.arg for n in ast.walk(node) if isinstance(n, ast.arg)
    ]


def _subtype_bound_by(ancestor: ast.AST) -> bool:
    """Does this enclosing node bind a subtype: a parameter, a `for` target or a comprehension target?"""
    if isinstance(ancestor, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
        bound = _names_in(ancestor.args)
    elif isinstance(ancestor, (ast.For, ast.AsyncFor)):
        bound = _names_in(ancestor.target)
    elif isinstance(ancestor, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
        bound = [name for generator in ancestor.generators for name in _names_in(generator.target)]
    else:
        return False
    return any(SUBTYPE_NAME.search(name) for name in bound)


def _names_a_subtype(node: ast.Compare, parents: dict[ast.AST, ast.AST], source: str) -> bool:
    if SUBTYPE_NAME.search(ast.get_source_segment(source, node) or ""):
        return True
    ancestor = parents.get(node)
    while ancestor is not None:
        if _subtype_bound_by(ancestor):
            return True
        ancestor = parents.get(ancestor)
    return False


def private_subtype_decisions(source: str) -> list[str]:
    """Every comparison in `source` that decides whether a subtype fires without `applicability.decide`.

    PARSED, NOT MATCHED. This was two regexes, and both examined the wrong thing: the first was so precise
    it matched nothing (its greedy subscript group consumed the `["threshold"]` it was hunting for, and the
    guard passed while examining nothing -- caught only by mutating the file it guards); the second, the
    blunt "a `>=`, then `threshold` later on the line", matched one operator and so was blind to the
    other four. A comparison is a tree with operands, and the operands are what tell a decision from a
    range check; a line pattern can only ever guess at them. The population is two files, so the parse costs nothing a regex saved.

    Whole-`Compare`-node granularity also retires the line-based reading: a comparison split over two
    lines is one node, and a comment can no longer put the word `subtype` beside a real decision."""
    tree = ast.parse(source)
    parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    return [
        f"line {node.lineno}: {(ast.get_source_segment(source, node) or '').strip()[:110]}"
        for node in ast.walk(tree)
        if isinstance(node, ast.Compare)
        and _is_a_score_against_a_cut(node, source)
        and _names_a_subtype(node, parents, source)
    ]


def executable(path: Path) -> str:
    """Source with comments stripped — these files explain the defect at length, and a guard a correct
    comment can break is one that gets weakened rather than fixed."""
    return "\n".join(
        line for line in path.read_text(encoding="utf-8").splitlines()
        if not line.lstrip().startswith("#")
    )


def test_the_deciders_are_real_files_so_this_cannot_pass_vacuously():
    for path in DECIDERS:
        assert path.exists(), f"{path} is listed as a decider and does not exist"
        assert len(executable(path)) > 1000, f"{path} read as nearly empty"


def test_every_decider_routes_through_the_shared_decision():
    for path in DECIDERS:
        source = executable(path)
        assert "applicability.decide(" in source, (
            f"{path.name} does not call applicability.decide. Both the product path and the held-out "
            f"evaluator must make the SAME decision, or the gate that judges the product measures "
            f"something the product does not do."
        )


def test_no_decider_compares_a_subtype_score_to_a_threshold_ITSELF():
    offenders = [
        f"{path.name}: {found}"
        for path in DECIDERS
        for found in private_subtype_decisions(path.read_text(encoding="utf-8"))
    ]
    assert offenders == [], (
        "A subtype decision is being made without the shared definition:\n  " + "\n  ".join(offenders)
        + "\n\nUse applicability.decide(subtype, score, threshold, record). A private comparison is how "
          "the applicability gate came to be live in scoring and absent from acceptance."
    )


#: POSITIVE CONTROL for the emptiness assertion above: `offenders == []` passes when the guard examines
#: nothing, which is how both earlier versions of it failed. Each of these is a private subtype decision
#: in a different spelling, and every one must be found.
PRIVATE_DECISIONS = {
    "the original >= form": "def f(subtype, value, report):\n    return value >= report['threshold']\n",
    "the same, cut on the left": "def f(subtype, score, threshold):\n    return threshold <= score\n",
    "strictly less": "def f(subtype, score, threshold):\n    return score < threshold\n",
    "strictly greater, cut first": "def f(subtype, score, threshold):\n    return threshold > score\n",
    "a band, as #2213 shipped it": (
        "def f(subtype, floor, score, subtype_report):\n"
        "    return floor is not None and floor <= score < float(subtype_report['threshold'])\n"
    ),
    "split over two lines": (
        "def f(subtype, score, threshold):\n    return (score\n            >= threshold)\n"
    ),
}

#: ...and these are NOT decisions, so the widened guard must leave them alone. Each one is the reason the
#: pattern is an operand shape and not an operator.
NOT_DECISIONS = {
    "a range check on the configured cut (score.py, `0.0 <= subtype_threshold <= 1.0`)": (
        "def f(subtype, subtype_threshold):\n    return 0.0 <= subtype_threshold <= 1.0\n"
    ),
    "the same, negated and reversed": (
        "def f(subtype, subtype_threshold):\n    return not 1.0 >= subtype_threshold >= 0.0\n"
    ),
    "arithmetic over an already-decided array (evaluator `metrics()`)": (
        "def f(scores, threshold):\n    return scores >= threshold\n"
    ),
    "membership, not ordering": "def f(subtype, report):\n    return 'threshold' in report\n",
    "an ordering that never mentions a cut": "def f(subtype, a, b):\n    return a >= b\n",
    "a comment naming a subtype beside a real, non-subtype comparison": (
        "def f(scores, threshold):\n    # subtype scores\n    return scores >= threshold\n"
    ),
}


def test_the_guard_finds_a_private_decision_in_EVERY_spelling():
    missed = [name for name, source in PRIVATE_DECISIONS.items() if not private_subtype_decisions(source)]
    assert missed == [], f"the guard is blind to: {missed}"


def test_the_guard_leaves_a_range_check_and_verdict_arithmetic_alone():
    accused = [name for name, source in NOT_DECISIONS.items() if private_subtype_decisions(source)]
    assert accused == [], f"the guard accuses a legitimate comparison: {accused}"


def test_a_reversed_decision_injected_into_a_REAL_decider_goes_red():
    """The row's own open-check, in memory: the same injection #2234 ran by hand against `score.py`, applied
    to the source text instead of the file, so a failing run cannot leave a decider dirty."""
    injection = "\n\ndef _would_fire(subtype, score, threshold):\n    return threshold <= score\n"
    for path in DECIDERS:
        source = path.read_text(encoding="utf-8")
        assert private_subtype_decisions(source) == [], f"{path.name} is not clean before the injection"
        assert private_subtype_decisions(source + injection), f"{path.name}: the injected decision went unseen"


def test_the_shared_decision_actually_combines_BOTH_halves():
    """A `decide` that ignored either half would satisfy every assertion above."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from _scorer_python import scorer_python

    sys.path.insert(0, str(scorer_python()))
    import applicability

    with_graphic = {"input": {"structure": {"graphics": ["graphic, a kiln"]}}}
    without = {"input": {"structure": {}}}
    # `filename-alt`, NOT `missing-alt`, and the choice is load-bearing rather than arbitrary.
    #
    # This test proves `decide` consults BOTH halves, so it needs a subtype that actually HAS a
    # precondition -- one without a precondition is applicable everywhere and the second assertion below
    # can never fail, which would make this test pass while examining nothing.
    #
    # It named `missing-alt` until 2026-09-01, when that subtype's precondition was removed:
    # `_has("graphics")` there required the very thing the defect makes invisible, because NVDA's sweep
    # walks straight past an image with no accessible name. `filename-alt` is the right example precisely
    # because its image IS announced -- the bad NAME is the defect, so a graphic is genuinely expected.
    subtype = "1.1.1:filename-alt"

    assert applicability.decide(subtype, 0.9, 0.5, with_graphic) is True
    assert applicability.decide(subtype, 0.1, 0.5, with_graphic) is False, "the threshold half is missing"
    assert applicability.decide(subtype, 0.9, 0.5, without) is False, "the applicability half is missing"
