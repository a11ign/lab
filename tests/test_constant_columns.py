"""A feature with ONE value across the whole corpus is invisible to every other check here.

**A change made on 2026-09-03 walked straight into this.** Two crossed columns were added keyed on
`observed["stateChanges"]`, which no capture carries, so both read 0.0 on every record — a dead column
that looks like coverage. It would have survived a full retrain, because each existing check asks a
narrower question:

- `corpus:starvation` asks whether a feature is constant on a SUBTYPE's positives. A corpus-wide constant
  is constant there too, so it appears once per subtype as more entries on a work list nobody can
  complete, rather than once as the fact that explains all of them.
- `scorer:shortcuts` reads TRAINED WEIGHTS, so it cannot speak until a train has been paid for.
- `corpus:distribution` asks whether an ARRAY FIELD is empty on every record. A computed feature is not a
  field and is not in the export at all — so it is structurally blind to this, and it had been NAMED as
  the gate for exactly this question in `schema-migration.json`. **A gate named for a fault it cannot
  express** is how the gap was found.

Tested here rather than end to end because the local `runs/` copy predates the `parsed` block and the
audit correctly refuses it — so an integration test would prove only that the refusal works.
"""
import importlib.util
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _scorer_python import scorer_python  # noqa: E402

sys.path.insert(0, str(scorer_python()))

ROOT = Path(__file__).resolve().parents[1]

_spec = importlib.util.spec_from_file_location(
    "shortcuts_audit", ROOT / "scripts" / "audit-scorer-shortcuts.py")
audit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit)

from screenreader_features import FEATURE_NAMES  # noqa: E402

A, B, C = FEATURE_NAMES[0], FEATURE_NAMES[1], FEATURE_NAMES[2]


def rec(**values):
    """One (featurevalues, subtypes) pair, in the shape `read_records` produces."""
    full = {name: 0.0 for name in FEATURE_NAMES}
    full.update(values)
    return (full, set())


def names(result):
    return {name for name, _ in result}


def test_a_column_constant_at_zero_is_reported():
    # The dead-column case: the featurizer reads something no capture carries.
    result = audit.constant_columns([rec(**{A: 1.0}), rec(**{A: 0.0}), rec(**{A: 1.0})])
    assert B in names(result), "a feature that is 0.0 on every record was not reported"


def test_a_column_constant_at_ONE_is_reported_just_as_loudly():
    # `transcript_present` reads 1.0 everywhere because every capture has a transcript — honest, useless,
    # and a head giving it weight has learned an intercept with extra steps. CLAUDE.md names this the
    # half the veto audit cannot see: *"a constant-1 column is invisible to the veto audit, which only
    # flags constancy at zero."* A check that looked only for zeros would reproduce that blindness.
    result = audit.constant_columns([rec(**{A: 1.0, B: 1.0}), rec(**{A: 0.0, B: 1.0})])
    assert B in names(result)
    assert A not in names(result)


def test_it_reports_the_VALUE_so_the_two_faults_are_distinguishable():
    # "Constant" is not one finding. Constant at 0 usually means the featurizer reads something absent;
    # constant at 1 usually means the corpus has no counter-example. They need opposite work, and a bare
    # name would send a reader to the wrong one.
    result = dict(audit.constant_columns([rec(**{A: 1.0, B: 1.0}), rec(**{A: 0.0, B: 1.0})]))
    assert result[B] == 1.0
    assert result[C] == 0.0


def test_a_varying_column_is_never_reported():
    result = audit.constant_columns([rec(**{A: 1.0}), rec(**{A: 0.0})])
    assert A not in names(result)


def test_no_records_is_not_EVERY_column_constant():
    # The examined-nothing failure, which this repo names more than any other. With no records, every
    # column is trivially constant — reporting all of them would bury a real finding under noise on the
    # one run where the input was empty. `read_records` already refuses an unfeaturizable corpus; this is
    # the same refusal one layer in.
    assert audit.constant_columns([]) == []
