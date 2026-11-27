"""CSV import: parsing, duplicates, keyed matching and confirm planning (no database).
Run: uv run pytest tests/test_csv_import.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from app.routers.students import is_csv_upload
from app.services.csv_import import (
    Candidate, ExistingStudent, ImportFormatError, NameIndex, PreferenceOwner,
    decode_csv, detect_delimiter, match_preference, parse_csv_preview, plan_preference_pairs,
    split_given_first, split_surname_first,
)


def preview(text: str | bytes, existing=(), name_order="surname_first"):
    data = text if isinstance(text, bytes) else text.encode("utf-8")
    return asyncio.run(parse_csv_preview(data, list(existing), name_order))


# --- file format -----------------------------------------------------------------

def test_semicolon_and_tab_delimiters():
    p = preview("first_name;last_name;tags\nAna;Soto;apoyo,lectura\n")
    assert p.delimiter == ";"
    assert (p.rows[0].first_name, p.rows[0].last_name, p.rows[0].tags) == ("Ana", "Soto", ["apoyo", "lectura"])
    assert detect_delimiter("first_name\tlast_name\nA\tB") == "\t"
    assert detect_delimiter('"a;b",c,d\n') == ","  # delimiters inside quotes don't count
    assert detect_delimiter("nombre\nAna") == ","


def test_cp1252_fallback_keeps_accents():
    text, enc = decode_csv("nombres,apellidos\nIñaki,Muñoz\n".encode("cp1252"))
    assert enc == "cp1252" and "Muñoz" in text
    p = preview("nombres,apellidos\nIñaki,Muñoz\n".encode("cp1252"))
    assert p.encoding == "cp1252" and p.rows[0].last_name == "Muñoz"
    # UTF-8 with Excel's BOM still works.
    assert preview("﻿first_name,last_name\nA,B\n").rows[0].first_name == "A"


def test_no_header_row_is_an_explicit_error():
    with pytest.raises(ImportFormatError) as e:
        preview("Ana,Soto\nLuis,Pérez\n")
    assert e.value.code == "no_name_column"
    with pytest.raises(ImportFormatError) as e:
        preview("   \n")
    assert e.value.code == "empty_file"


def test_too_many_rows_has_a_code():
    with pytest.raises(ImportFormatError) as e:
        preview("first_name,last_name\n" + "A,B\n" * 501)
    assert e.value.code == "too_many_rows"


def test_name_order_toggle():
    assert split_surname_first("Oyarzún Velarde Juan José") == ("Juan José", "Oyarzún Velarde")
    assert split_given_first("Juan José Oyarzún Velarde") == ("Juan José", "Oyarzún Velarde")
    assert split_given_first("Ana Soto") == ("Ana", "Soto")
    p = preview("nombre\nAna María Soto Pérez\n", name_order="given_first")
    assert (p.rows[0].first_name, p.rows[0].last_name) == ("Ana María", "Soto Pérez")
    assert p.name_split and p.name_split.order == "given_first" and p.name_split.example_first == "Ana María"


def test_status_codes_for_translation():
    p = preview("first_name,last_name,gender,tags\n,Soto,,\nAna,Soto,x,\nLuis,Paz,,bad tag\n")
    assert [r.status_code for r in p.rows] == ["missing_name", "invalid_gender", "invalid_tag"]
    assert p.rows[0].status_params == {"reason": "blank"}
    assert p.rows[1].status_params == {"value": "x"}
    assert p.rows[2].status_params["tag"] == "bad tag"


def test_mime_types():
    assert is_csv_upload("text/csv", "a.csv")
    assert is_csv_upload("application/vnd.ms-excel", "lista.CSV")
    assert is_csv_upload("text/plain", "a.csv")
    assert is_csv_upload("", "a.csv")
    assert not is_csv_upload("application/vnd.ms-excel", "a.xlsx")
    assert not is_csv_upload("image/png", "a.csv")


# --- duplicates -------------------------------------------------------------------

def test_in_upload_duplicates_exact_and_similar():
    p = preview(
        "first_name,last_name,gender,tags\n"
        "Ana,Soto,girl,apoyo\n"
        " Ana , Soto ,girl,apoyo\n"   # identical after trimming
        "Ana,Soto,boy,apoyo\n"        # same name, gender differs
    )
    a, b, c = p.rows
    assert a.status == "ok" and a.importable
    assert b.status == "duplicate_exact" and not b.importable and b.status_params == {"of": "row", "line": "2"}
    assert c.status == "duplicate_similar" and c.importable and c.status_params["fields"] == "gender"


def test_existing_duplicates_exact_and_similar():
    existing = [
        ExistingStudent("s-ana", "Ana", "Soto", "girl", ["apoyo"]),
        ExistingStudent("s-luis", "Luis", "Paz", None, []),
    ]
    p = preview("first_name,last_name,gender,tags,preferences\nana,SOTO,girl,apoyo,Luis Paz\nLuis,Paz,boy,,\n", existing)
    ana, luis = p.rows
    assert ana.status == "duplicate_exact" and ana.existing_student_id == "s-ana" and not ana.importable
    assert ana.owner_key == "s-ana" and ana.preferences == ["Luis Paz"]
    assert luis.status == "duplicate_similar" and luis.status_params == {"of": "existing", "fields": "gender"}


# --- keyed matching -----------------------------------------------------------------

def test_match_returns_keys_and_excludes_self():
    idx = NameIndex([
        Candidate("s1", "Emma", "Ruiz"), Candidate("row:3", "Emma", "Soto"), Candidate("row:4", "Lucas", "Pérez"),
    ])
    m = match_preference("Emma", idx, self_key="row:4")
    assert m.status == "ambiguous"
    assert [(c.key, c.source, c.row_index) for c in m.suggestions] == [("s1", "existing", None), ("row:3", "upload", 3)]
    m = match_preference("emma soto", idx, self_key=None)
    assert (m.status, m.matched_key) == ("matched", "row:3")
    assert match_preference("Emma Soto", idx, self_key="row:3").status != "matched"  # a student can't pick themself
    m = match_preference("Lucas Perex", idx, self_key=None)
    assert m.status == "unresolved" and m.suggestions[0].key == "row:4"


def test_same_name_different_students_is_ambiguous():
    idx = NameIndex([Candidate("s1", "Emma", "Ruiz"), Candidate("row:2", "Emma", "Ruiz")])
    m = match_preference("Emma Ruiz", idx, self_key=None)
    assert m.status == "ambiguous" and {c.key for c in m.suggestions} == {"s1", "row:2"}


# --- confirm planning -------------------------------------------------------------

def test_plan_resolves_keys_dedupes_and_reports():
    owners = [
        PreferenceOwner("new-a", "Ana Soto", ["row:1", "s-old", "row:9", "nope", "new-a", "row:1"]),
        PreferenceOwner("new-b", "Luis Paz", ["row:0"]),                  # mutual with Ana -> one rule
        PreferenceOwner("s-old", "Old Kid", ["row:1", "row:0"], existing=True),
    ]
    rows = {"row:0": "new-a", "row:1": "new-b"}
    plan = plan_preference_pairs(owners, rows, {"s-old", "s-other"}, existing_pairs={frozenset(("s-old", "new-b"))})
    assert {frozenset(p) for p in plan.pairs} == {frozenset(("new-a", "new-b")), frozenset(("new-a", "s-old"))}
    assert len(plan.pairs) == 2
    assert [(s.owner, s.target_key, s.reason) for s in plan.skipped] == [
        ("Ana Soto", "row:9", "target_not_imported"), ("Ana Soto", "nope", "unknown_student"),
    ]
    # Old Kid -> new-b already existed, Old Kid -> new-a was created by Ana's listing first.
    assert plan.per_existing == {}


def test_plan_counts_rules_added_to_existing_students():
    plan = plan_preference_pairs([PreferenceOwner("s-old", "Old Kid", ["row:0"], existing=True)], {"row:0": "n1"}, {"s-old"}, set())
    assert plan.pairs == [("s-old", "n1")] and plan.per_existing == {"s-old": 1}
