"""Offline gender guess from a given name, used only as a suggestion on CSV import.

No network calls: children's names never leave the server. Unknown or ambiguous
names return None and the teacher fills them in.
"""
import csv
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Optional

_NAMES_FILE = Path(__file__).resolve().parent.parent / "data" / "given_names.csv"


@lru_cache(maxsize=1)
def _name_table() -> dict[str, str]:
    with _NAMES_FILE.open(encoding="utf-8") as f:
        rows = (line for line in f if not line.startswith("#"))
        return {r["name"]: r["gender"] for r in csv.DictReader(rows)}


def guess_gender(first_name: str) -> Optional[str]:
    """'boy' | 'girl' | None. Uses the first word of the given name, so compound
    names follow Spanish convention: 'María José' -> girl, 'José María' -> boy."""
    # Same folding as csv_import.normalize_name (not imported: csv_import imports this module).
    folded = unicodedata.normalize("NFKD", first_name)
    words = "".join(ch for ch in folded if not unicodedata.combining(ch)).lower().split()
    if not words:
        return None
    return _name_table().get(words[0])
