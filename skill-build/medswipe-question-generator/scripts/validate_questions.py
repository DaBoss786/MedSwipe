#!/usr/bin/env python3
"""Validate MedSwipe AI_Drafts question batches."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


QUESTION_FIELDS = [
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

REQUIRED_SHEET_FIELDS = [
    "Batch ID",
    "Source/Guideline",
]

OPTION_FIELDS = ["Option A", "Option B", "Option C", "Option D", "Option E"]
LETTERS = ["A", "B", "C", "D", "E"]
CHAR_LIMIT = 625

BANNED_EXPLANATION_PHRASES = [
    "Clinical reasoning should integrate",
    "This is intentionally plausible",
    "While X remains clinically plausible",
    "This reduces anchoring bias",
]

BANNED_OPTION_ABSOLUTES = [
    "always",
    "only",
    "never",
    "all",
    "none",
    "every",
    "must",
    "cannot",
    "exclusively",
]


def load_rows(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".json":
      data = json.loads(path.read_text(encoding="utf-8"))
      if isinstance(data, dict):
          data = data.get("questions") or data.get("rows") or []
      if not isinstance(data, list):
          raise ValueError("JSON input must be a list or an object with questions/rows.")
      return [dict(row) for row in data]

    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def option_char_count(row: dict[str, Any]) -> int:
    return len(text(row.get("Question"))) + sum(len(text(row.get(field))) for field in OPTION_FIELDS)


def has_word(text_value: str, word: str) -> bool:
    return re.search(rf"\b{re.escape(word)}\b", text_value, flags=re.IGNORECASE) is not None


def validate_row(row: dict[str, Any], row_number: int) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    missing = [field for field in QUESTION_FIELDS if not text(row.get(field))]
    if missing:
        errors.append(f"row {row_number}: missing required field(s): {', '.join(missing)}")

    missing_sheet = [field for field in REQUIRED_SHEET_FIELDS if not text(row.get(field))]
    if missing_sheet:
        errors.append(f"row {row_number}: missing required sheet field(s): {', '.join(missing_sheet)}")

    for field in OPTION_FIELDS:
        if not text(row.get(field)):
            errors.append(f"row {row_number}: {field} is empty")

    count = option_char_count(row)
    if count > CHAR_LIMIT:
        errors.append(f"row {row_number}: stem/options character count {count} exceeds {CHAR_LIMIT}")

    answer = text(row.get("Correct Answer")).upper()
    if answer not in LETTERS:
        errors.append(f"row {row_number}: Correct Answer must be one of A-E")

    explanation = text(row.get("Explanation"))
    if answer in LETTERS and not explanation.startswith(f"Option {answer} is correct."):
        errors.append(f"row {row_number}: Explanation must start with 'Option {answer} is correct.'")

    for letter in LETTERS:
        if f"Option {letter}" not in explanation:
            errors.append(f"row {row_number}: Explanation does not address Option {letter}")

    # Explanation bodies should be citation-free; provenance belongs in Source/Guideline.
    if "Source:" in explanation:
        warnings.append(f"row {row_number}: Explanation contains 'Source:'; keep citations in Source/Guideline instead")

    for phrase in BANNED_EXPLANATION_PHRASES:
        if phrase.lower() in explanation.lower():
            errors.append(f"row {row_number}: banned explanation phrase: {phrase}")

    for field in OPTION_FIELDS:
        option = text(row.get(field))
        for word in BANNED_OPTION_ABSOLUTES:
            if has_word(option, word):
                warnings.append(f"row {row_number}: {field} contains absolute term '{word}'")

    for blank_field in ["CME Eligible", "DocID", "Shareable Link"]:
        if text(row.get(blank_field)):
            errors.append(f"row {row_number}: {blank_field} must be blank for AI_Drafts")

    if text(row.get("Procedures")) and not text(row.get("_ProceduresExplicitlyRequested")):
        warnings.append(f"row {row_number}: Procedures is populated; confirm user explicitly requested it")

    if text(row.get("Board Review")) != "Yes":
        errors.append(f"row {row_number}: Board Review must be 'Yes'")

    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate MedSwipe question rows.")
    parser.add_argument("input", type=Path, help="CSV or JSON file containing question rows")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable summary JSON")
    args = parser.parse_args()

    try:
        rows = load_rows(args.input)
    except Exception as exc:
        print(f"ERROR: failed to read input: {exc}", file=sys.stderr)
        return 2

    errors: list[str] = []
    warnings: list[str] = []
    categories: Counter[str] = Counter()
    answers: Counter[str] = Counter()

    for idx, row in enumerate(rows, start=2):
        row_errors, row_warnings = validate_row(row, idx)
        errors.extend(row_errors)
        warnings.extend(row_warnings)
        if text(row.get("Category")):
            categories[text(row.get("Category"))] += 1
        if text(row.get("Correct Answer")).upper() in LETTERS:
            answers[text(row.get("Correct Answer")).upper()] += 1

    if len(rows) >= 5 and len(answers) == 1:
        warnings.append("correct answer distribution uses only one letter across the batch")
    for letter, count in answers.items():
        if len(rows) >= 10 and count > 3:
            warnings.append(f"correct answer distribution has {count} answers of {letter} in a {len(rows)}-question batch")

    summary = {
        "total_questions": len(rows),
        "category_distribution": dict(categories),
        "answer_distribution": {letter: answers.get(letter, 0) for letter in LETTERS},
        "errors": errors,
        "warnings": warnings,
    }

    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        print(f"Total question count: {len(rows)}")
        print("Category distribution:")
        for category, count in categories.most_common():
            print(f"  - {category}: {count}")
        print("Correct answer distribution:")
        for letter in LETTERS:
            print(f"  - {letter}: {answers.get(letter, 0)}")
        if warnings:
            print("Warnings:")
            for warning in warnings:
                print(f"  - {warning}")
        if errors:
            print("Errors:")
            for error in errors:
                print(f"  - {error}")

    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
