import re
import unicodedata
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
    # Names come from uploaded CSVs. Force string type (openpyxl would store a leading "="
    # as a formula) and mark =,+,-,@ prefixes as quote-prefixed so Excel/Sheets keep them text.
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.data_type = "s"
            if str(cell.value)[:1] in FORMULA_PREFIXES:
                cell.quotePrefix = True
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
