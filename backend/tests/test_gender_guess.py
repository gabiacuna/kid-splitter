"""Offline gender guess from given names. Run: uv run pytest tests/test_gender_guess.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from app.services.gender_guess import guess_gender


@pytest.mark.parametrize("name,expected", [
    ("Emma", "girl"),
    ("Vicente", "boy"),
    ("Trinidad", "girl"),       # ends in -d, but a girl's name in Chile
    ("Matías", "boy"),          # ends in -s
    ("MATIAS", "boy"),          # case- and accent-insensitive
    ("Begoña", "girl"),
    ("María José", "girl"),     # compound names follow the first word
    ("José María", "boy"),
    ("Juan José", "boy"),
    ("  Josefa  ", "girl"),
])
def test_known_names(name, expected):
    assert guess_gender(name) == expected


@pytest.mark.parametrize("name", ["Alexis", "Ariel", "Kalani", "", "   "])
def test_ambiguous_or_unknown_names_are_not_guessed(name):
    assert guess_gender(name) is None
