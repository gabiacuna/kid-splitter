import csv
import io
import re
from dataclasses import dataclass, field
from typing import Optional

CSV_INJECTION_CHARS = ("=", "+", "-", "@")
MAX_ROWS = 500
TAG_SEPARATOR = ","
_TAG_RE = re.compile(r'^[a-zA-Z0-9_-]+$')


@dataclass
class PreviewRow:
    row_index:      int
    first_name:     str
    last_name:      str
    tags:           list[str]
    status:         str
    status_message: Optional[str]


def _is_injection(value: str) -> bool:
    return bool(value) and value[0] in CSV_INJECTION_CHARS


def _parse_tags(raw: str) -> tuple[list[str], Optional[str]]:
    if not raw:
        return [], None
    parts = [t.strip() for t in raw.split(TAG_SEPARATOR)]
    for part in parts:
        if not part:
            continue
        if _is_injection(part):
            return [], f"Tag '{part}' starts with injection character"
        if not _TAG_RE.match(part):
            return [], f"Tag '{part}' contains invalid characters (use letters, digits, hyphens, underscores)"
    return [p for p in parts if p], None


async def parse_csv_preview(
    file_bytes: bytes,
    existing_names: set[str],
) -> list[PreviewRow]:
    text = file_bytes.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    # Normalise headers to lowercase, stripped
    if reader.fieldnames is None:
        return []
    reader.fieldnames = [f.strip().lower() for f in reader.fieldnames]

    rows: list[PreviewRow] = []
    seen_names: set[str] = set()
    raw_rows = list(reader)

    if len(raw_rows) > MAX_ROWS:
        raise ValueError(f"CSV exceeds {MAX_ROWS} row limit")

    for i, row in enumerate(raw_rows):
        first = (row.get("first_name") or "").strip()
        last  = (row.get("last_name") or "").strip()
        tags_raw = (row.get("tags") or "").strip()

        if _is_injection(first) or _is_injection(last):
            rows.append(PreviewRow(
                row_index=i,
                first_name=first,
                last_name=last,
                tags=[],
                status="missing_name",
                status_message="Name field starts with injection character",
            ))
            continue

        if not first or not last:
            rows.append(PreviewRow(
                row_index=i,
                first_name=first,
                last_name=last,
                tags=[],
                status="missing_name",
                status_message="first_name or last_name is blank",
            ))
            continue

        tags, tag_err = _parse_tags(tags_raw)
        if tag_err:
            rows.append(PreviewRow(
                row_index=i,
                first_name=first,
                last_name=last,
                tags=[],
                status="invalid_tag",
                status_message=tag_err,
            ))
            continue

        key = f"{first.lower()} {last.lower()}"
        if key in existing_names or key in seen_names:
            rows.append(PreviewRow(
                row_index=i,
                first_name=first,
                last_name=last,
                tags=tags,
                status="duplicate",
                status_message="Student already exists in cohort or appears twice in upload",
            ))
        else:
            seen_names.add(key)
            rows.append(PreviewRow(
                row_index=i,
                first_name=first,
                last_name=last,
                tags=tags,
                status="ok",
                status_message=None,
            ))

    return rows
