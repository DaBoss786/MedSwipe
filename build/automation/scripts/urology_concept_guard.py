#!/usr/bin/env python3
"""Build and enforce a concept-level dedupe ledger for hourly Urology batches.

The guard is intentionally conservative: it compares a proposed concept plan or
generated batch against a live full AI_Drafts export, prior local Urology batch
artifacts, and the explicit blocked-concepts registry. It is not a medical
verifier. It is a pre-write gate that catches recycled clinical
decision/answer/teaching-point families before a polished MCQ reaches AI_Drafts.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


DEFAULT_BATCH_GLOBS = [
    "build/automation/urology_aua_guidelines_batches/*.json",
    "build/automation/urology_sasp_guideline_matched_batches/*.json",
    "build/automation/urology_sasp_10h_batches/*.json",
]

DEFAULT_BLOCKED_PATH = Path("build/automation/urology_saturated_concepts.json")
DEFAULT_LEDGER_PATH = Path("build/automation/urology_concept_ledger.json")
DEFAULT_LIVE_SHEET_EXPORT = Path("build/automation/ai_drafts_full_export.json")

REQUIRED_SHEET_HEADERS = [
    "Batch ID",
    "Source/Guideline",
    "Specialty",
    "Category",
    "Question",
    "Option A",
    "Option B",
    "Option C",
    "Option D",
    "Option E",
    "Correct Answer",
    "Explanation",
]

STOPWORDS = {
    "a",
    "about",
    "after",
    "against",
    "all",
    "alone",
    "also",
    "an",
    "and",
    "any",
    "are",
    "as",
    "at",
    "be",
    "because",
    "before",
    "best",
    "but",
    "by",
    "can",
    "cannot",
    "care",
    "clinician",
    "clinicians",
    "correct",
    "could",
    "does",
    "for",
    "from",
    "guideline",
    "has",
    "have",
    "he",
    "her",
    "his",
    "how",
    "in",
    "incorrect",
    "is",
    "it",
    "man",
    "may",
    "mg",
    "most",
    "next",
    "not",
    "of",
    "option",
    "or",
    "patient",
    "patients",
    "per",
    "should",
    "source",
    "than",
    "that",
    "the",
    "therapy",
    "this",
    "to",
    "under",
    "what",
    "when",
    "which",
    "with",
    "within",
    "woman",
    "year",
    "old",
}

SYNONYMS = {
    "psma": "pet",
    "petct": "pet",
    "pet/ct": "pet",
    "conventional": "imaging",
    "negative": "negative",
    "salvage": "salvage",
    "radiotherapy": "radiation",
    "rt": "radiation",
    "alkalinisation": "alkalinization",
    "alkalinize": "alkalinization",
    "alkalinizes": "alkalinization",
    "citrate": "potassiumcitrate",
    "potassium": "potassiumcitrate",
    "dmannose": "dmannose",
    "d-mannose": "dmannose",
    "uti": "ruti",
    "utis": "ruti",
    "urinary": "urine",
    "urinalysis": "ua",
    "microhematuria": "hematuria",
    "haematuria": "hematuria",
    "24": "24hour",
    "twenty": "24hour",
    "hour": "24hour",
    "hours": "24hour",
}


@dataclass
class Concept:
    concept_id: str
    source: str
    row: int | None
    batch_id: str
    category: str
    source_guideline: str
    question: str
    correct_answer: str
    correct_answer_text: str
    teaching_point: str
    decision_text: str
    normalized: str
    tokens: set[str]

    def as_dict(self) -> dict[str, Any]:
        return {
            "concept_id": self.concept_id,
            "source": self.source,
            "row": self.row,
            "batch_id": self.batch_id,
            "category": self.category,
            "source_guideline": self.source_guideline,
            "question": self.question,
            "correct_answer": self.correct_answer,
            "correct_answer_text": self.correct_answer_text,
            "teaching_point": self.teaching_point,
            "decision_text": self.decision_text,
        }


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def strip_html(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def normalize(value: str) -> str:
    value = strip_html(value).lower()
    value = value.replace("d-mannose", "dmannose")
    value = re.sub(r"[^a-z0-9+/ -]+", " ", value)
    value = re.sub(r"\s+", " ", value)
    words: list[str] = []
    for raw in value.split():
        word = raw.strip("-/ ")
        if not word or word in STOPWORDS:
            continue
        word = SYNONYMS.get(word, word)
        if len(word) <= 2 and not word.isdigit():
            continue
        words.append(word)
    return " ".join(words)


def token_set(value: str) -> set[str]:
    return set(normalize(value).split())


def answer_text(row: dict[str, Any]) -> str:
    answer = text(row.get("Correct Answer")).upper()
    return text(row.get(f"Option {answer}")) if answer in {"A", "B", "C", "D", "E"} else ""


def teaching_point(explanation: str) -> str:
    explanation = strip_html(explanation)
    match = re.search(r"Teaching point:\s*(.*?)(?:\s*Source:|$)", explanation, flags=re.I | re.S)
    if match:
        return match.group(1).strip()
    parts = re.split(r"(?<=\.)\s+", re.sub(r"Source:.*$", "", explanation, flags=re.I | re.S).strip())
    return parts[-1].strip() if parts else ""


def question_from_plan(item: dict[str, Any]) -> str:
    fields = [
        "clinical_trigger",
        "decision_point",
        "correct_answer_concept",
        "teaching_point",
        "source_section",
        "question",
    ]
    return " | ".join(text(item.get(field)) for field in fields if text(item.get(field)))


def concept_from_row(
    row: dict[str, Any],
    *,
    source: str,
    index: int,
    row_number: int | None = None,
    batch_id: str = "",
) -> Concept:
    question = text(row.get("Question")) or question_from_plan(row)
    answer = text(row.get("Correct Answer")).upper()
    correct = text(row.get("correct_answer_concept")) or answer_text(row)
    teach = text(row.get("teaching_point")) or teaching_point(text(row.get("Explanation")))
    decision = text(row.get("decision_point")) or question
    source_guideline = text(row.get("Source/Guideline") or row.get("source_guideline"))
    category = text(row.get("Category") or row.get("category"))
    combined = " | ".join([category, source_guideline, question, decision, correct, teach])
    normalized = normalize(combined)
    concept_id = f"{source}:{row_number or index}:{stable_slug(combined)}"
    return Concept(
        concept_id=concept_id,
        source=source,
        row=row_number,
        batch_id=batch_id or text(row.get("Batch ID") or row.get("batch_id")),
        category=category,
        source_guideline=source_guideline,
        question=question,
        correct_answer=answer,
        correct_answer_text=correct,
        teaching_point=teach,
        decision_text=decision,
        normalized=normalized,
        tokens=set(normalized.split()),
    )


def stable_slug(value: str) -> str:
    words = normalize(value).split()[:10]
    return "-".join(words)[:90] or "blank"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def rows_from_json(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [dict(row) for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        for key in ("questions", "rows", "compact_payload", "concepts"):
            rows = data.get(key)
            if isinstance(rows, list):
                return [dict(row) for row in rows if isinstance(row, dict)]
    return []


def nonempty_generated_row(row: dict[str, Any]) -> bool:
    return any(text(row.get(field)) for field in ("Batch ID", "Specialty", "Category", "Question"))


def specialty_is_urology(row: dict[str, Any]) -> bool:
    specialty = text(row.get("Specialty") or row.get("specialty")).lower()
    if specialty == "urology":
        return True
    # Legacy rows sometimes used Urology-only categories before Specialty was
    # consistently populated. Keep this deliberately narrow to avoid importing
    # ENT/neurosurgery rows into the Urology ledger.
    return specialty == "" and text(row.get("Batch ID")).lower().startswith("urology-")


def rows_from_sheet_export(data: Any) -> tuple[list[dict[str, Any]], list[str]]:
    """Return row dicts from a Google Sheets range export.

    Accepts the connector shape:

    {"range": "AI_Drafts!A1:AI1000", "values": [[headers...], [row...]]}

    Also accepts an already-normalized list of row dictionaries for easier local
    testing. Returned row dicts include `_Sheet Row`.
    """
    errors: list[str] = []
    if isinstance(data, list):
        rows = [dict(row) for row in data if isinstance(row, dict)]
        if not rows:
            errors.append("live sheet export list contains no row dictionaries")
        return rows, errors

    if not isinstance(data, dict):
        return [], ["live sheet export must be a connector JSON object or list of row dictionaries"]

    values = data.get("values")
    if not isinstance(values, list) or not values:
        return [], ["live sheet export has no values array"]
    header_values = values[0]
    if not isinstance(header_values, list):
        return [], ["live sheet export first row is not a header list"]
    headers = [text(value) for value in header_values]
    missing = [header for header in REQUIRED_SHEET_HEADERS if header not in headers]
    if missing:
        errors.append(f"live sheet export missing required header(s): {', '.join(missing)}")

    range_name = text(data.get("range"))
    if range_name and not re.search(r"!A1:", range_name):
        errors.append(f"live sheet export must start at A1; got range {range_name}")

    rows: list[dict[str, Any]] = []
    for offset, raw_row in enumerate(values[1:], start=2):
        if not isinstance(raw_row, list):
            continue
        row = {header: text(raw_row[idx]) if idx < len(raw_row) else "" for idx, header in enumerate(headers)}
        row["_Sheet Row"] = offset
        rows.append(row)
    return rows, errors


def collect_live_sheet_concepts(path: Path, min_urology_rows: int) -> tuple[list[Concept], list[str]]:
    if not path.exists():
        return [], [f"live sheet export not found: {path}"]

    try:
        data = load_json(path)
    except Exception as exc:
        return [], [f"failed to read live sheet export {path}: {exc}"]

    rows, errors = rows_from_sheet_export(data)
    urology_rows = [
        row for row in rows
        if nonempty_generated_row(row) and specialty_is_urology(row)
    ]
    if len(urology_rows) < min_urology_rows:
        errors.append(
            f"live sheet export has only {len(urology_rows)} populated Urology rows; "
            f"require at least {min_urology_rows}"
        )

    concepts: list[Concept] = []
    seen: set[str] = set()
    for idx, row in enumerate(urology_rows, start=1):
        row_number = int(text(row.get("_Sheet Row"))) if text(row.get("_Sheet Row")).isdigit() else None
        concept = concept_from_row(row, source="live_ai_drafts", index=idx, row_number=row_number)
        key = f"{concept.row}:{concept.normalized}"
        if concept.normalized and key not in seen:
            concepts.append(concept)
            seen.add(key)
    return concepts, errors


def collect_prior_concepts(paths: list[Path]) -> list[Concept]:
    concepts: list[Concept] = []
    seen: set[str] = set()
    for path in paths:
        try:
            data = load_json(path)
        except Exception as exc:
            print(f"WARNING: skipped unreadable JSON {path}: {exc}", file=sys.stderr)
            continue
        batch_id = text(data.get("batch_id")) if isinstance(data, dict) else path.stem
        for idx, row in enumerate(rows_from_json(data), start=1):
            if not specialty_is_urology(row):
                continue
            row_number = None
            for key in ("row_number", "_Sheet Row", "row"):
                if text(row.get(key)).isdigit():
                    row_number = int(text(row.get(key)))
                    break
            concept = concept_from_row(row, source=str(path), index=idx, row_number=row_number, batch_id=batch_id)
            key = concept.normalized
            if key and key not in seen:
                concepts.append(concept)
                seen.add(key)
    return concepts


def blocked_concepts(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    data = load_json(path)
    return list(data.get("blocked_concepts", [])) if isinstance(data, dict) else []


def concept_from_blocked(item: dict[str, Any], index: int) -> Concept:
    row = {
        "Question": text(item.get("block_rule")),
        "Category": text(item.get("label")),
        "Correct Answer": "",
        "Explanation": text(item.get("block_rule")),
    }
    rows = item.get("rows")
    row_number = rows[-1] if isinstance(rows, list) and rows and isinstance(rows[-1], int) else None
    return concept_from_row(row, source="blocked_concepts", index=index, row_number=row_number, batch_id="blocked")


def similarity(a: Concept, b: Concept) -> tuple[float, float, float]:
    if not a.normalized or not b.normalized:
        return 0.0, 0.0, 0.0
    intersection = len(a.tokens & b.tokens)
    union = len(a.tokens | b.tokens) or 1
    smaller = min(len(a.tokens), len(b.tokens)) or 1
    jaccard = intersection / union
    containment = intersection / smaller
    seq = SequenceMatcher(None, a.normalized, b.normalized).ratio()
    return jaccard, containment, seq


def same_family(a: Concept, b: Concept, threshold: float) -> tuple[bool, str]:
    jaccard, containment, seq = similarity(a, b)
    answer_overlap = bool(token_set(a.correct_answer_text) & token_set(b.correct_answer_text))
    teaching_overlap = bool(a.teaching_point and b.teaching_point and token_set(a.teaching_point) & token_set(b.teaching_point))
    if "blocked_concepts" in {a.source, b.source} and containment >= 0.55 and seq >= 0.25:
        return True, f"blocked_rule_containment={containment:.2f}, sequence={seq:.2f}"
    if containment >= 0.74 and (answer_overlap or teaching_overlap):
        return True, f"containment={containment:.2f}, answer_or_teaching_overlap"
    if jaccard >= threshold and seq >= 0.58:
        return True, f"jaccard={jaccard:.2f}, sequence={seq:.2f}"
    if seq >= 0.82:
        return True, f"sequence={seq:.2f}"
    return False, f"jaccard={jaccard:.2f}, containment={containment:.2f}, sequence={seq:.2f}"


def default_batch_paths(exclude: Path | None = None) -> list[Path]:
    excluded = exclude.resolve() if exclude else None
    paths: list[Path] = []
    for pattern in DEFAULT_BATCH_GLOBS:
        paths.extend(Path(".").glob(pattern))
    unique = sorted(set(path for path in paths if not excluded or path.resolve() != excluded))
    return unique


def write_ledger(path: Path, concepts: list[Concept], blocked: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "purpose": "Concept-level dedupe ledger for hourly Urology generation. Generated from live AI_Drafts export, prior local artifacts, and saturated concept registry.",
        "total_concepts": len(concepts),
        "total_blocked_rules": len(blocked),
        "concepts": [concept.as_dict() for concept in concepts],
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build/check Urology concept dedupe ledger.")
    parser.add_argument("--candidate", type=Path, help="Candidate concept plan or generated batch JSON to screen before sheet write.")
    parser.add_argument("--ledger-out", type=Path, default=DEFAULT_LEDGER_PATH)
    parser.add_argument("--blocked", type=Path, default=DEFAULT_BLOCKED_PATH)
    parser.add_argument("--live-sheet-export", type=Path, default=DEFAULT_LIVE_SHEET_EXPORT)
    parser.add_argument("--require-live-sheet", action="store_true", help="Fail closed unless a valid full AI_Drafts export is available.")
    parser.add_argument("--min-live-urology-rows", type=int, default=50)
    parser.add_argument("--threshold", type=float, default=0.42)
    parser.add_argument("--min-candidates", type=int, default=10)
    parser.add_argument("--write-ledger", action="store_true", help="Write/update the ledger JSON.")
    args = parser.parse_args()

    live, live_errors = collect_live_sheet_concepts(args.live_sheet_export, args.min_live_urology_rows)
    if args.require_live_sheet and live_errors:
        print(json.dumps({
            "status": "fail",
            "type": "live_sheet_export_invalid",
            "live_sheet_export": str(args.live_sheet_export),
            "errors": live_errors,
        }, indent=2))
        return 2

    prior_paths = default_batch_paths(args.candidate)
    prior = collect_prior_concepts(prior_paths)
    blocked_items = blocked_concepts(args.blocked)
    blocked_as_concepts = [concept_from_blocked(item, idx) for idx, item in enumerate(blocked_items, start=1)]
    ledger = live + prior + blocked_as_concepts

    if args.write_ledger or not args.candidate:
        write_ledger(args.ledger_out, ledger, blocked_items)

    if not args.candidate:
        print(json.dumps({
            "status": "pass" if not live_errors or not args.require_live_sheet else "fail",
            "ledger_out": str(args.ledger_out),
            "ledger_count": len(ledger),
            "live_sheet_concepts": len(live),
            "prior_artifact_files": len(prior_paths),
            "blocked_rules": len(blocked_items),
            "live_sheet_warnings": live_errors,
        }, indent=2))
        return 0

    candidate_data = load_json(args.candidate)
    candidate_rows = rows_from_json(candidate_data)
    candidates = [
        concept_from_row(row, source=str(args.candidate), index=idx)
        for idx, row in enumerate(candidate_rows, start=1)
    ]
    findings: list[dict[str, Any]] = []

    if len(candidates) < args.min_candidates:
        findings.append({
            "type": "too_few_candidates",
            "message": f"candidate file has {len(candidates)} concepts; require at least {args.min_candidates}",
        })

    for i, candidate in enumerate(candidates):
        for other in candidates[i + 1:]:
            hit, reason = same_family(candidate, other, args.threshold)
            if hit:
                findings.append({
                    "type": "intra_batch_duplicate",
                    "candidate": candidate.as_dict(),
                    "matched_candidate": other.as_dict(),
                    "reason": reason,
                })
        for existing in ledger:
            hit, reason = same_family(candidate, existing, args.threshold)
            if hit:
                findings.append({
                    "type": "prior_duplicate_or_saturated",
                    "candidate": candidate.as_dict(),
                    "matched_existing": existing.as_dict(),
                    "reason": reason,
                })
                break

    summary = {
        "candidate": str(args.candidate),
        "candidate_count": len(candidates),
        "ledger_count": len(ledger),
        "live_sheet_concepts": len(live),
        "live_sheet_warnings": live_errors,
        "status": "fail" if findings else "pass",
        "findings": findings,
    }
    print(json.dumps(summary, indent=2))
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
