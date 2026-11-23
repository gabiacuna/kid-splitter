import csv
import io
import re
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher
from dataclasses import dataclass, field
from typing import Optional

CSV_INJECTION_CHARS = ("=", "+", "-", "@")
MAX_ROWS = 500
TAG_SEPARATOR = ","
PREFERENCE_SEPARATOR = "|"
MAX_PREFERENCES = 10
_TAG_RE = re.compile(r'^[a-zA-Z0-9_-]+$')

_GENDER_ALIASES = {
    "b": "boy", "boy": "boy", "m": "boy", "male": "boy",
    "g": "girl", "girl": "girl", "f": "girl", "female": "girl",
    # Spanish exports. "m" stays boy (masculino); "mujer" is spelled out.
    "h": "boy", "hombre": "boy", "masculino": "boy", "nino": "boy",
    "mujer": "girl", "femenino": "girl", "nina": "girl",
}

# Header aliases (compared after normalize_name: lowercase, accents stripped).
_FIRST_NAME_HEADERS = ("first_name", "first name", "nombres", "nombre de pila")
_LAST_NAME_HEADERS  = ("last_name", "last name", "apellidos")
_FULL_NAME_HEADERS  = ("name", "full_name", "full name", "nombre", "nombre completo", "alumno", "estudiante")
_GENDER_HEADERS     = ("gender", "genero", "sexo")
_TAG_HEADERS        = ("tags", "etiquetas")
_PREFERENCE_PREFIXES = ("preferenc", "pair with")  # preferences, preferencia 1, Preferencia 2, ...

# Lower-case particles that belong to the following surname word ("De La Cruz").
_SURNAME_PARTICLES = {"de", "del", "la", "las", "los", "y", "san", "van", "von", "da", "di", "le"}

# Rows the confirm step imports. invalid_gender keeps the row (gender=None); duplicates are
# imported too (the teacher sees the warning and can remove the row). Single source of truth:
# the preview sends `importable` per row so the client never re-derives it.
IMPORTABLE_STATUSES = ("ok", "invalid_gender", "duplicate")


@dataclass
class PreviewRow:
    row_index:      int
    first_name:     str
    last_name:      str
    tags:           list[str]
    status:         str
    status_message: Optional[str]
    gender:         Optional[str] = None
    preferences:    list[str] = field(default_factory=list)  # raw classmate names


def _is_injection(value: str) -> bool:
    return bool(value) and value[0] in CSV_INJECTION_CHARS


# ---------------------------------------------------------------------------
# Preference ("pair with") name matching
# ---------------------------------------------------------------------------

@dataclass
class Candidate:
    key:     str   # identity of the roster entry (row index or student id) — used to exclude self
    first:   str
    last:    str

    @property
    def display(self) -> str:
        return f"{self.first} {self.last}"


@dataclass
class PreferenceMatchResult:
    name:            str
    status:          str            # matched | ambiguous | unresolved
    matched_display: Optional[str] = None
    matched_key:     Optional[str] = None
    suggestions:     list[str] = field(default_factory=list)  # displays the teacher can pick from


@dataclass
class ColumnNote:
    column: str           # header as written in the file
    action: str           # "tags" | "ignored"
    detail: str


@dataclass
class CsvPreview:
    rows:         list["PreviewRow"]
    column_notes: list[ColumnNote]


MAX_SUGGESTIONS = 3
# Extra columns become tags only when their values actually group students.
MAX_TAG_COLUMN_VALUES = 12
MAX_TAG_LEN = 30
MAX_TAGS = 10


def _name_units(full: str) -> list[str]:
    """Split a name into words, gluing surname particles onto the next word:
    'Bunster De La Cruz Samuel' -> ['Bunster', 'De La Cruz', 'Samuel']."""
    units: list[str] = []
    pending: list[str] = []
    for word in full.split():
        if normalize_name(word) in _SURNAME_PARTICLES:
            pending.append(word)
            continue
        units.append(" ".join(pending + [word]))
        pending = []
    if pending:
        units.append(" ".join(pending))
    return units


def split_surname_first(full: str) -> tuple[str, str]:
    """Split a Spanish-style 'Paterno Materno Nombre(s)' into (first, last).

    3+ units: first two are surnames, the rest is the given name ('Oyarzún Velarde Juan José').
    2 units: 'Surname Given'. 1 unit: can't split -> ('', '') so the row reports missing_name.
    The teacher can still correct names inline in the preview.
    """
    units = _name_units(full)
    if len(units) >= 3:
        return " ".join(units[2:]), " ".join(units[:2])
    if len(units) == 2:
        return units[1], units[0]
    return "", ""


def normalize_name(s: str) -> str:
    """Case-, accent- and whitespace-insensitive form, so 'José  Pérez' == 'jose perez'."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return " ".join(s.lower().split())


def parse_preferences(raw: str) -> list[str]:
    if not raw:
        return []
    seen: list[str] = []
    for part in raw.split(PREFERENCE_SEPARATOR):
        name = " ".join(part.split())
        if name and not _is_injection(name) and name not in seen:
            seen.append(name)
    return seen[:MAX_PREFERENCES]


@dataclass
class _Entry:
    candidate: Candidate
    forms:     set[str]   # normalised full-name forms
    words:     set[str]


class NameIndex:
    """Roster names normalised once, so each preference is a dict lookup instead of
    re-normalising every candidate (500 students × 3 preferences took ~7s before).

    Keys, in priority order:
      full     'emma baasch lopez', 'baasch lopez emma', 'emma baasch' (given + first surname)
      initial  'renata l'  (given + first-surname initial)
      first    'emma'      (given name alone; only a match if unique)
    """

    def __init__(self, candidates: list[Candidate]) -> None:
        self.entries: list[_Entry] = []
        self.full: dict[str, list[Candidate]] = defaultdict(list)
        self.initial: dict[str, list[Candidate]] = defaultdict(list)
        self.first: dict[str, list[Candidate]] = defaultdict(list)
        for c in candidates:
            units = _name_units(c.last)
            first_surname = units[0] if units else c.last
            first = normalize_name(c.first)
            forms = {
                normalize_name(c.display),
                normalize_name(f"{c.last} {c.first}"),
                normalize_name(f"{c.first} {first_surname}"),
            }
            for f in forms:
                self.full[f].append(c)
            if first_surname:
                self.initial[f"{first} {normalize_name(first_surname)[:1]}"].append(c)
            self.first[first].append(c)
            self.entries.append(_Entry(c, forms, set(normalize_name(c.display).split())))


def match_preference(name: str, index: NameIndex, self_key: Optional[str]) -> PreferenceMatchResult:
    """Full name first, then given name + surname initial, then a unique given name."""
    target = normalize_name(name)
    initial_key = target.rstrip(".")

    def hits(bucket: dict[str, list[Candidate]], key: str) -> list[Candidate]:
        return [c for c in bucket.get(key, ()) if c.key != self_key]

    found = (
        hits(index.full, target)
        or (hits(index.initial, initial_key) if len(initial_key.rpartition(" ")[2]) == 1 else [])
        or hits(index.first, target)
    )

    # The same person can appear twice (e.g. already in cohort and re-uploaded); collapse by name.
    distinct = {normalize_name(c.display): c for c in found}
    if len(distinct) == 1:
        c = next(iter(distinct.values()))
        return PreferenceMatchResult(name, "matched", c.display, c.key)
    if len(distinct) > 1:
        return PreferenceMatchResult(
            name, "ambiguous",
            suggestions=sorted(c.display for c in distinct.values())[:MAX_SUGGESTIONS * 2],
        )
    return PreferenceMatchResult(name, "unresolved", suggestions=_suggest(target, index, self_key))


def _suggest(target: str, index: NameIndex, self_key: Optional[str]) -> list[str]:
    """Closest roster names for a name that matched nobody: typos ("Irente" ~ "Irene")
    score by similarity, and sharing a whole word ("Jacinta Lobos" -> Jacinta Latuz,
    Catalina Lobos) also counts, so the teacher can say which student was meant."""
    words = set(target.split())
    scored: dict[str, float] = {}
    for e in index.entries:
        if e.candidate.key == self_key:
            continue
        ratio = max(SequenceMatcher(None, target, f).ratio() for f in e.forms)
        shared = words & e.words
        score = max(ratio, 0.6 + 0.1 * len(shared) if shared else 0.0)
        if score >= 0.6:
            d = e.candidate.display
            scored[d] = max(score, scored.get(d, 0.0))
    return [d for d, _ in sorted(scored.items(), key=lambda kv: (-kv[1], kv[0]))[:MAX_SUGGESTIONS]]


def slug(s: str) -> str:
    """Tag-safe form: 'Curso' + '2°A' -> 'curso', '2a'."""
    s = normalize_name(s.replace("°", "").replace("º", "").replace("ª", ""))
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _plan_extra_columns(original: list[str], used: set[str], raw_rows: list[dict]) -> tuple[list[str], list[ColumnNote]]:
    """Decide which unrecognised columns become tags. A column qualifies when its values
    group students (few distinct values, e.g. 'Curso': 2°A/2°B). Per-student identifiers
    (all values unique, e.g. 'N°') and free text (many values) are ignored."""
    tag_cols: list[str] = []
    notes: list[ColumnNote] = []
    for orig in original:
        h = normalize_name(orig)
        if h in used or not h:
            continue
        values = [(r.get(h) or "").strip() for r in raw_rows]
        filled = [v for v in values if v]
        distinct = {slug(v) for v in filled} - {""}
        if not distinct:
            notes.append(ColumnNote(orig, "ignored", "column is empty"))
        elif all(v.isdigit() for v in filled):
            notes.append(ColumnNote(orig, "ignored", "numbers only (looks like a list number)"))
        elif len(filled) > 1 and len(distinct) == len(filled):
            notes.append(ColumnNote(orig, "ignored", "every row has a different value (looks like an ID)"))
        elif len(distinct) > MAX_TAG_COLUMN_VALUES:
            notes.append(ColumnNote(orig, "ignored", f"too many different values ({len(distinct)}) to use as tags"))
        else:
            tag_cols.append(h)
            examples = ", ".join(sorted(_column_tag(h, v) for v in distinct)[:4])
            notes.append(ColumnNote(orig, "tags", f"added as tags: {examples}"))
    return tag_cols, notes


def _column_tag(header: str, value: str) -> str:
    prefix = slug(header)
    v = slug(value)
    return (f"{prefix}-{v}" if prefix else v)[:MAX_TAG_LEN].strip("-")


def _parse_gender(raw: str) -> tuple[Optional[str], Optional[str]]:
    """Returns (gender, error). Empty/absent is silently None; unrecognised is None + error."""
    if not raw:
        return None, None
    gender = _GENDER_ALIASES.get(raw.lower())
    if gender is None:
        return None, f"Gender '{raw}' not recognised (use boy/girl) — imported as unknown"
    return gender, None


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
) -> CsvPreview:
    text = file_bytes.decode("utf-8-sig", errors="replace")  # -sig: tolerate Excel's BOM
    reader = csv.DictReader(io.StringIO(text))

    # Normalise headers: lowercase, accents stripped, whitespace collapsed
    if reader.fieldnames is None:
        return CsvPreview([], [])
    original_headers = [f.strip() for f in reader.fieldnames]
    reader.fieldnames = [normalize_name(f) for f in reader.fieldnames]
    headers = reader.fieldnames

    def pick(aliases: tuple[str, ...]) -> Optional[str]:
        return next((h for h in headers if h in aliases), None)

    first_col, last_col = pick(_FIRST_NAME_HEADERS), pick(_LAST_NAME_HEADERS)
    full_col = None if (first_col and last_col) else pick(_FULL_NAME_HEADERS)
    gender_col, tags_col = pick(_GENDER_HEADERS), pick(_TAG_HEADERS)
    pref_cols = [h for h in headers if h.startswith(_PREFERENCE_PREFIXES)]

    rows: list[PreviewRow] = []
    seen_names: set[str] = set()
    raw_rows = list(reader)

    if len(raw_rows) > MAX_ROWS:
        raise ValueError(f"CSV exceeds {MAX_ROWS} row limit")

    used = {c for c in (first_col, last_col, full_col, gender_col, tags_col) if c} | set(pref_cols)
    if not full_col and not first_col:
        used |= {"first_name", "last_name"}
    tag_cols, column_notes = _plan_extra_columns(original_headers, used, raw_rows)

    for i, row in enumerate(raw_rows):
        if full_col:
            first, last = split_surname_first((row.get(full_col) or "").strip())
        else:
            first = (row.get(first_col or "first_name") or "").strip()
            last  = (row.get(last_col or "last_name") or "").strip()
        tags_raw = (row.get(tags_col or "tags") or "").strip()
        gender, gender_err = _parse_gender(normalize_name(row.get(gender_col or "gender") or ""))
        # One pipe-separated column, or several "Preferencia N" columns, or both.
        preferences = parse_preferences(
            PREFERENCE_SEPARATOR.join((row.get(c) or "").strip() for c in pref_cols)
        )

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
        for c in tag_cols:
            v = (row.get(c) or "").strip()
            t = _column_tag(c, v) if v else ""
            if t and t not in tags:
                tags.append(t)
        tags = tags[:MAX_TAGS]
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
                gender=gender,
                preferences=preferences,
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
                status="invalid_gender" if gender_err else "ok",
                status_message=gender_err,
                gender=gender,
                preferences=preferences,
            ))

    return CsvPreview(rows, column_notes)
