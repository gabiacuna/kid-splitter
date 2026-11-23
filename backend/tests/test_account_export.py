"""Run: uv run python tests/test_account_export.py"""
import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from openpyxl import load_workbook

from app.services.export import CohortExport, build_account_workbook


def test_account_workbook():
    data = [
        CohortExport("4º Básico: A/B", 2026, [
            ("s1", "Sofía", "Arce", "girl", "curso-2a"),
            ("s2", "=cmd", "Toro", "", ""),            # formula-looking name stays text
        ], [("soft_priority", {"s1": 1, "s2": 2}), ("balanced_sizes", {"s1": 2})]),
        CohortExport("4º Básico: A/B", None, [], []),    # duplicate name -> unique sheet title
    ]
    wb = load_workbook(BytesIO(build_account_workbook("Colegio Ñuñoa", "2026-11-23 18:00 UTC", data)))
    assert wb.sheetnames[0] == "Summary"
    titles = wb.sheetnames[1:]
    assert len(set(t.lower() for t in titles)) == 2 and all(len(t) <= 31 and ":" not in t and "/" not in t for t in titles)
    s = wb["Summary"]
    assert s["B1"].value == "Colegio Ñuñoa" and s["A5"].value == "4º Básico: A/B" and s["C5"].value == 2
    ws = wb[titles[0]]
    assert [c.value for c in ws[1]] == ["First name", "Last name", "Gender", "Tags", "Class — Soft priority", "Class — Balanced sizes"]
    assert [c.value for c in ws[2]] == ["Sofía", "Arce", "Girl", "curso-2a", "Class A", "Class B"]
    assert ws["A3"].value == "=cmd" and ws["A3"].data_type == "s" and ws["A3"].quotePrefix
    assert ws["F3"].value is None  # not placed in that option


if __name__ == "__main__":
    test_account_workbook()
    print("ok")
