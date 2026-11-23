from io import BytesIO

from openpyxl import load_workbook

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # run as `uv run python tests/test_export.py`

from app.services.export import build_roster_workbook, content_disposition, safe_filename_stem


def test_workbook_layout_and_injection():
    data = build_roster_workbook([(1, "Ana Núñez"), (1, "=HYPERLINK(\"x\") Evil"), (2, "-2+3 Minus"), (3, "@SUM(A1) At")])
    ws = load_workbook(BytesIO(data)).active
    assert [c.value for c in ws[1]] == ["Class", "Student"] and ws["A1"].font.bold
    assert [ws.cell(r, 1).value for r in range(2, 6)] == ["Class A", "Class A", "Class B", "Class C"]
    assert ws["B2"].value == "Ana Núñez"
    for r in range(3, 6):
        assert ws.cell(r, 2).data_type == "s" and ws.cell(r, 2).quotePrefix


def test_filename_sanitised():
    stem = safe_filename_stem('../Año "2"\r\nX/Y')
    assert not any(ch in stem for ch in '"/\\\r\n')
    header = content_disposition(f"{stem}-class-list.xlsx")
    assert "\n" not in header and "filename*=UTF-8''" in header and "%C3%B1" in header


if __name__ == "__main__":  # no pytest dependency: `uv run python tests/test_export.py`
    test_workbook_layout_and_injection()
    test_filename_sanitised()
    print("ok")
