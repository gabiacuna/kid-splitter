import re
import unicodedata
from dataclasses import dataclass
from typing import Optional
from io import BytesIO
from urllib.parse import quote

from openpyxl import Workbook
from openpyxl.styles import Font

from .csv_import import CSV_INJECTION_CHARS

# CSV import rejects these as name prefixes; export also covers tab/CR, which Excel can
# treat as formula starters too.
FORMULA_PREFIXES = CSV_INJECTION_CHARS + ("\t", "\r")

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# Mirror of VARIANTS in frontend/src/lib/solutions.ts (teacher-facing names).
VARIANT_NAMES = {
    "balanced_sizes": "Balanced sizes",
    "soft_priority": "Soft priority",
    "diversity_mix": "Diversity mix",
}


def class_label(class_number: int) -> str:
    """Mirror of classLabel() in frontend/src/lib/classes.ts: 1 -> "Class A"."""
    return f"Class {chr(64 + class_number)}"


def _as_text(ws, min_row: int = 2) -> None:
    """Names come from uploaded CSVs. Force string type (openpyxl would store a leading "="
    as a formula) and quote-prefix =,+,-,@ so Excel/Sheets keep them as text."""
    for row in ws.iter_rows(min_row=min_row):
        for cell in row:
            if not isinstance(cell.value, str):
                continue  # numbers (e.g. summary counts) stay numbers
            cell.data_type = "s"
            if str(cell.value)[:1] in FORMULA_PREFIXES:
                cell.quotePrefix = True


def _header(ws, values: list[str]) -> None:
    ws.append(values)
    for cell in ws[ws.max_row]:
        cell.font = Font(bold=True)


def _sheet_title(name: str, taken: set[str]) -> str:
    """Excel sheet names: ≤31 chars, no []:*?/\\, unique (case-insensitive)."""
    base = re.sub(r"[\[\]:*?/\\]", " ", name).strip()[:28] or "Cohort"
    title, n = base, 2
    while title.lower() in taken:
        title = f"{base[:28 - len(str(n)) - 1]} {n}"
        n += 1
    taken.add(title.lower())
    return title


@dataclass
class CohortExport:
    name:      str
    year:      Optional[int]
    students:  list[tuple[str, str, str, str, Optional[str]]]  # id, first, last, gender, tags
    solutions: list[tuple[str, dict[str, int]]]                 # (variant label, student_id -> class)


GENDER_TEXT = {"boy": "Boy", "girl": "Girl"}


def build_account_workbook(school: str, exported_at: str, cohorts: list[CohortExport]) -> bytes:
    """Everything a teacher has, for keeping before deleting the account: a summary sheet
    plus one sheet per cohort (students, gender, tags, and the class each latest solution
    option puts them in)."""
    wb = Workbook()
    summary = wb.active
    summary.title = "Summary"
    summary.append(["School", school])
    summary.append(["Exported", exported_at])
    summary.append([])
    _header(summary, ["Cohort", "Year", "Students", "Solution options"])
    for c in cohorts:
        summary.append([c.name, c.year or "", len(c.students), len(c.solutions)])
    _as_text(summary, min_row=5)
    summary.column_dimensions["A"].width = 32

    taken = {"summary"}
    for c in cohorts:
        ws = wb.create_sheet(_sheet_title(c.name, taken))
        option_cols = [f"Class — {VARIANT_NAMES.get(label, label)}" for label, _ in c.solutions]
        _header(ws, ["First name", "Last name", "Gender", "Tags", *option_cols])
        for sid, first, last, gender, tags in c.students:
            ws.append([first, last, GENDER_TEXT.get(gender or "", ""), tags or "",
                       *[class_label(a[sid]) if sid in a else "" for _, a in c.solutions]])
        _as_text(ws)
        ws.freeze_panes = "A2"
        for col, width in zip("ABCDEFG", (18, 24, 8, 20, 22, 22, 22)):
            ws.column_dimensions[col].width = width

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_roster_workbook(rows: list[tuple[int, str]]) -> bytes:
    """rows: (class_number, student full name), already sorted."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Class list"
    ws.append(["Class", "Student"])
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for class_number, name in rows:
        ws.append([class_label(class_number), name])
    _as_text(ws)
    ws.freeze_panes = "A2"
    longest = max((len(n) for _, n in rows), default=0)
    ws.column_dimensions["A"].width = 12
    ws.column_dimensions["B"].width = min(max(longest + 2, 20), 60)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def safe_filename_stem(text: str, fallback: str = "class-list") -> str:
    """Teacher-supplied text -> something safe in a Content-Disposition filename."""
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r'[\x00-\x1f\x7f"\\/:*?<>|;%]+', " ", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text[:80] or fallback


def content_disposition(filename: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode()
    ascii_name = re.sub(r"[^A-Za-z0-9._ -]", "_", ascii_name) or "class-list.xlsx"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename, safe='')}"
