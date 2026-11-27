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

# Rows imported by default. invalid_gender keeps the row (gender=None). A duplicate_similar
# (same name, something differs) is imported and flagged; a duplicate_exact is not. The
# preview sends `importable` per row; the teacher can still include/exclude any row.
IMPORTABLE_STATUSES = ("ok", "invalid_gender", "duplicate_similar")

NAME_ORDERS = ("surname_first", "given_first")
DELIMITERS = (",", ";", "\t")


class ImportFormatError(ValueError):
    """A file the preview can't use at all. `code` is stable; the frontend translates it."""

    def __init__(self, code: str, message: str, **params: str) -> None:
        super().__init__(message)
        self.code = code
        self.params = params


@dataclass
class ExistingStudent:
    id:     str
    first:  str
    last:   str
    gender: Optional[str] = None
    tags:   list[str] = field(default_factory=list)


@dataclass
class PreviewRow:
    row_index:      int
    first_name:     str
    last_name:      str
    tags:           list[str]
    status:         str
    status_message: Optional[str]                      # English, for API readers
    gender:         Optional[str] = None
    preferences:    list[str] = field(default_factory=list)  # raw classmate names
    status_code:    Optional[str] = None               # stable; the UI translates code + params
    status_params:  dict[str, str] = field(default_factory=dict)
    # duplicate_exact of a student already in the cohort: that student's id. Its
    # preferences are added to that student instead of creating a copy.
    existing_student_id: Optional[str] = None

    @property
    def importable(self) -> bool:
        return self.status in IMPORTABLE_STATUSES

    @property
    def owner_key(self) -> str:
        """Who this row's preferences belong to: the existing twin, or the new row."""
        return self.existing_student_id or row_key(self.row_index)


def row_key(row_index: int) -> str:
    return f"row:{row_index}"


def _is_injection(value: str) -> bool:
    return bool(value) and value[0] in CSV_INJECTION_CHARS


# ---------------------------------------------------------------------------
# Preference ("pair with") name matching
# ---------------------------------------------------------------------------

@dataclass
class Candidate:
    # Stable identity: an existing student's id, or "row:<row_index>" for an upload row.
    # The client sends these keys back on confirm, so names are never re-matched.
    key:     str
    first:   str
    last:    str

    @property
    def display(self) -> str:
        return f"{self.first} {self.last}"

    @property
    def source(self) -> str:
        return "upload" if self.key.startswith("row:") else "existing"

    @property
    def row_index(self) -> Optional[int]:
        return int(self.key[4:]) if self.key.startswith("row:") else None


@dataclass
class PreferenceMatchResult:
    name:            str
    status:          str            # matched | ambiguous | unresolved
    matched_display: Optional[str] = None
    matched_key:     Optional[str] = None
    suggestions:     list[Candidate] = field(default_factory=list)  # candidates the teacher can pick from


@dataclass
class ColumnNote:
    column: str           # header as written in the file
    action: str           # "tags" | "ignored"
    detail: str           # English
    code:   str = ""      # tags | empty | numbers_only | unique_values | too_many_values
    params: dict[str, str] = field(default_factory=dict)


@dataclass
class NameSplit:
    """How a single full-name column was split, so the teacher can check and flip it."""
    column:        str
    order:         str            # surname_first | given_first
    example_full:  str
    example_first: str
    example_last:  str


@dataclass
class CsvPreview:
    rows:         list["PreviewRow"]
    column_notes: list[ColumnNote]
    name_split:   Optional[NameSplit] = None
    delimiter:    str = ","
    encoding:     str = "utf-8"


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


def split_given_first(full: str) -> tuple[str, str]:
    """'Juan José Oyarzún Velarde' -> ('Juan José', 'Oyarzún Velarde'): with 3+ units the last
    two are surnames; with 2 it's 'Given Surname'. 1 unit -> ('', '') (missing name)."""
    units = _name_units(full)
    if len(units) >= 3:
        return " ".join(units[:-2]), " ".join(units[-2:])
    if len(units) == 2:
        return units[0], units[1]
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

    # Distinct by key: two different students with the same name are a real ambiguity
    # (exact duplicates never reach the index, so the same person can't appear twice).
    distinct = {c.key: c for c in found}
    if len(distinct) == 1:
        c = next(iter(distinct.values()))
        return PreferenceMatchResult(name, "matched", c.display, c.key)
    if len(distinct) > 1:
        ordered = sorted(distinct.values(), key=lambda c: (normalize_name(c.display), c.source != "existing", c.key))
        return PreferenceMatchResult(name, "ambiguous", suggestions=ordered[:MAX_SUGGESTIONS * 2])
    return PreferenceMatchResult(name, "unresolved", suggestions=_suggest(target, index, self_key))


def _suggest(target: str, index: NameIndex, self_key: Optional[str]) -> list[Candidate]:
    """Closest roster names for a name that matched nobody: typos ("Irente" ~ "Irene")
    score by similarity, and sharing a whole word ("Jacinta Lobos" -> Jacinta Latuz,
    Catalina Lobos) also counts, so the teacher can say which student was meant."""
    words = set(target.split())
    scored: dict[str, tuple[float, Candidate]] = {}
    for e in index.entries:
        if e.candidate.key == self_key:
            continue
        ratio = max(SequenceMatcher(None, target, f).ratio() for f in e.forms)
        shared = words & e.words
        score = max(ratio, 0.6 + 0.1 * len(shared) if shared else 0.0)
        if score >= 0.6:
            k = e.candidate.key
            if k not in scored or score > scored[k][0]:
                scored[k] = (score, e.candidate)
    ranked = sorted(scored.values(), key=lambda sc: (-sc[0], sc[1].display, sc[1].key))
    return [c for _, c in ranked[:MAX_SUGGESTIONS]]


# ---------------------------------------------------------------------------
# Confirm: turn the teacher's chosen keys into "together" pairs
# ---------------------------------------------------------------------------

@dataclass
class PreferenceOwner:
    key:        str            # student id it resolves to after creation
    display:    str
    pref_keys:  list[str]
    existing:   bool = False   # preferences added to a student who was already in the cohort


@dataclass
class SkippedPreference:
    owner:      str
    target_key: str
    reason:     str            # target_not_imported | unknown_student


@dataclass
class PairPlan:
    pairs:            list[tuple[str, str]]
    skipped:          list[SkippedPreference]
    per_existing:     dict[str, int]          # existing owner student id -> new pairs


def plan_preference_pairs(
    owners: list[PreferenceOwner],
    row_to_student: dict[str, str],
    cohort_student_ids: set[str],
    existing_pairs: set[frozenset[str]],
) -> PairPlan:
    """Resolve keys directly — `row:N` to the student created for row N, anything else must
    be a student of this cohort. Self-pairs are ignored; mutual listings and rules that
    already exist produce no second rule. Pure, so it's unit-tested without a database."""
    pairs: list[tuple[str, str]] = []
    skipped: list[SkippedPreference] = []
    per_existing: dict[str, int] = {}
    seen = set(existing_pairs)
    for o in owners:
        for k in dict.fromkeys(o.pref_keys):  # dedupe, keep order
            if k == o.key:
                continue  # self, by id
            if k.startswith("row:"):
                target = row_to_student.get(k)
                if target is None:
                    skipped.append(SkippedPreference(o.display, k, "target_not_imported"))
                    continue
            elif k in cohort_student_ids:
                target = k
            else:
                skipped.append(SkippedPreference(o.display, k, "unknown_student"))
                continue
            if target == o.key:
                continue
            pair = frozenset((o.key, target))
            if pair in seen:
                continue
            seen.add(pair)
            pairs.append((o.key, target))
            if o.existing:
                per_existing[o.key] = per_existing.get(o.key, 0) + 1
    return PairPlan(pairs, skipped, per_existing)


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
            notes.append(ColumnNote(orig, "ignored", "column is empty", "empty"))
        elif all(v.isdigit() for v in filled):
            notes.append(ColumnNote(orig, "ignored", "numbers only (looks like a list number)", "numbers_only"))
        elif len(filled) > 1 and len(distinct) == len(filled):
            notes.append(ColumnNote(orig, "ignored", "every row has a different value (looks like an ID)", "unique_values"))
        elif len(distinct) > MAX_TAG_COLUMN_VALUES:
            notes.append(ColumnNote(orig, "ignored", f"too many different values ({len(distinct)}) to use as tags",
                                    "too_many_values", {"count": str(len(distinct))}))
        else:
            tag_cols.append(h)
            examples = ", ".join(sorted(_column_tag(h, v) for v in distinct)[:4])
            notes.append(ColumnNote(orig, "tags", f"added as tags: {examples}", "tags", {"examples": examples}))
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


def _parse_tags(raw: str) -> tuple[list[str], Optional[str], dict[str, str]]:
    """(tags, english error, params for the error code)."""
    if not raw:
        return [], None, {}
    parts = [t.strip() for t in raw.split(TAG_SEPARATOR)]
    for part in parts:
        if not part:
            continue
        if _is_injection(part):
            return [], f"Tag '{part}' starts with injection character", {"tag": part, "reason": "injection"}
        if not _TAG_RE.match(part):
            return [], f"Tag '{part}' contains invalid characters (use letters, digits, hyphens, underscores)", {"tag": part, "reason": "chars"}
    return [p for p in parts if p], None, {}


def decode_csv(file_bytes: bytes) -> tuple[str, str]:
    """UTF-8 (BOM tolerated) first; Excel on Windows saves cp1252; latin-1 never fails.
    No `errors="replace"`: a wrong guess would silently turn "Muñoz" into "Mu�oz"."""
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return file_bytes.decode(enc), ("utf-8" if enc == "utf-8-sig" else enc)
        except UnicodeDecodeError:
            continue
    raise AssertionError("latin-1 decodes any byte string")  # pragma: no cover


def detect_delimiter(text: str) -> str:
    """Spanish-locale Excel writes ';'. Pick whichever of , ; tab appears most in the header
    line (outside quotes); ties and nothing found fall back to ','."""
    first = next((line for line in text.splitlines() if line.strip()), "")
    unquoted = re.sub(r'"[^"]*"', "", first)
    counts = {d: unquoted.count(d) for d in DELIMITERS}
    best = max(DELIMITERS, key=lambda d: (counts[d], d == ","))
    return best if counts[best] > 0 else ","


def _norm_full(first: str, last: str) -> str:
    return normalize_name(f"{first} {last}")


async def parse_csv_preview(
    file_bytes: bytes,
    existing: list[ExistingStudent],
    name_order: str = "surname_first",
) -> CsvPreview:
    text, encoding = decode_csv(file_bytes)
    if not text.strip():
        raise ImportFormatError("empty_file", "The file is empty")
    delimiter = detect_delimiter(text)
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)

    # Normalise headers: lowercase, accents stripped, whitespace collapsed
    if reader.fieldnames is None:
        raise ImportFormatError("empty_file", "The file is empty")
    original_headers = [f.strip() for f in reader.fieldnames]
    reader.fieldnames = [normalize_name(f) for f in reader.fieldnames]
    headers = reader.fieldnames

    def pick(aliases: tuple[str, ...]) -> Optional[str]:
        return next((h for h in headers if h in aliases), None)

    first_col, last_col = pick(_FIRST_NAME_HEADERS), pick(_LAST_NAME_HEADERS)
    full_col = None if (first_col and last_col) else pick(_FULL_NAME_HEADERS)
    gender_col, tags_col = pick(_GENDER_HEADERS), pick(_TAG_HEADERS)
    pref_cols = [h for h in headers if h.startswith(_PREFERENCE_PREFIXES)]

    # Without a recognisable name column the first line is probably data, not a header.
    if not full_col and not (first_col and last_col):
        raise ImportFormatError(
            "no_name_column",
            "No name column found. The first row must be a header such as first_name,last_name or nombre",
            headers=", ".join(h for h in original_headers if h)[:200],
        )

    splitter = split_given_first if name_order == "given_first" else split_surname_first
    raw_rows = list(reader)

    if len(raw_rows) > MAX_ROWS:
        raise ImportFormatError("too_many_rows", f"CSV exceeds {MAX_ROWS} row limit", max=str(MAX_ROWS))

    used = {c for c in (first_col, last_col, full_col, gender_col, tags_col) if c} | set(pref_cols)
    tag_cols, column_notes = _plan_extra_columns(original_headers, used, raw_rows)
    header_of = dict(zip(headers, original_headers))

    existing_by_name: dict[str, ExistingStudent] = {}
    for e in existing:
        existing_by_name.setdefault(_norm_full(e.first, e.last), e)
    # First row seen per normalised name, with its trimmed cells, for in-upload duplicates.
    seen_rows: dict[str, tuple[int, dict[str, str]]] = {}

    rows: list[PreviewRow] = []
    name_split: Optional[NameSplit] = None

    for i, row in enumerate(raw_rows):
        cells = {k: (v or "").strip() for k, v in row.items() if k is not None and isinstance(v, str)}
        if full_col:
            full = cells.get(full_col, "")
            first, last = splitter(full)
            if name_split is None and first and last:
                name_split = NameSplit(header_of.get(full_col, full_col), name_order, full, first, last)
        else:
            first = cells.get(first_col or "", "")
            last  = cells.get(last_col or "", "")
        tags_raw = cells.get(tags_col or "", "")
        gender_raw = cells.get(gender_col or "", "")
        gender, gender_err = _parse_gender(normalize_name(gender_raw))
        # One pipe-separated column, or several "Preferencia N" columns, or both.
        preferences = parse_preferences(PREFERENCE_SEPARATOR.join(cells.get(c, "") for c in pref_cols))

        def bad(status: str, msg: str, code: str, **params: str) -> PreviewRow:
            return PreviewRow(row_index=i, first_name=first, last_name=last, tags=[], status=status,
                              status_message=msg, status_code=code, status_params=params)

        if _is_injection(first) or _is_injection(last):
            rows.append(bad("missing_name", "Name field starts with injection character", "missing_name", reason="injection"))
            continue
        if not first or not last:
            rows.append(bad("missing_name", "first_name or last_name is blank", "missing_name", reason="blank"))
            continue

        tags, tag_err, tag_params = _parse_tags(tags_raw)
        for c in tag_cols:
            v = cells.get(c, "")
            t = _column_tag(c, v) if v else ""
            if t and t not in tags:
                tags.append(t)
        tags = tags[:MAX_TAGS]
        if tag_err:
            rows.append(bad("invalid_tag", tag_err, "invalid_tag", **tag_params))
            continue

        base = dict(row_index=i, first_name=first, last_name=last, tags=tags, gender=gender, preferences=preferences)
        name = _norm_full(first, last)
        twin = existing_by_name.get(name)
        earlier = seen_rows.get(name)
        if twin is not None:
            diff = [f for f, same in (("gender", twin.gender == gender), ("tags", set(twin.tags or []) == set(tags))) if not same]
            if not diff:
                rows.append(PreviewRow(**base, status="duplicate_exact", status_code="duplicate_exact",
                                       status_message="Same name, gender and tags as a student already in this cohort",
                                       status_params={"of": "existing"}, existing_student_id=twin.id))
            else:
                rows.append(PreviewRow(**base, status="duplicate_similar", status_code="duplicate_similar",
                                       status_message=f"A student with this name is already in the cohort ({', '.join(diff)} differ)",
                                       status_params={"of": "existing", "fields": ",".join(diff)}))
            continue
        if earlier is not None:
            first_index, first_cells = earlier
            diff = [header_of.get(k, k) for k in headers if cells.get(k, "") != first_cells.get(k, "")]
            row_no = str(first_index + 2)  # +1 header, +1 one-based: the line number in the file
            if not diff:
                rows.append(PreviewRow(**base, status="duplicate_exact", status_code="duplicate_exact",
                                       status_message=f"Identical to line {row_no}",
                                       status_params={"of": "row", "line": row_no}))
            else:
                rows.append(PreviewRow(**base, status="duplicate_similar", status_code="duplicate_similar",
                                       status_message=f"Same name as line {row_no} ({', '.join(diff)} differ)",
                                       status_params={"of": "row", "line": row_no, "fields": ",".join(diff)}))
            continue

        seen_rows[name] = (i, cells)
        if gender_err:
            rows.append(PreviewRow(**base, status="invalid_gender", status_code="invalid_gender",
                                   status_message=gender_err, status_params={"value": gender_raw}))
        else:
            rows.append(PreviewRow(**base, status="ok", status_message=None))

    return CsvPreview(rows, column_notes, name_split, delimiter, encoding)
