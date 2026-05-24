#!/usr/bin/env python3
"""Deterministic lint checks for MedSwipe verifier target rows."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any


OPTION_FIELDS = ["Option A", "Option B", "Option C", "Option D", "Option E"]
REQUIRED_FIELDS = [
    "Specialty",
    "Category",
    "Question",
    *OPTION_FIELDS,
    "Correct Answer",
    "Explanation",
]
LETTERS = ["A", "B", "C", "D", "E"]
CHAR_LIMIT = 625
BANNED_ABSOLUTES = ["always", "only", "never", "all", "none", "every", "must", "cannot", "exclusively"]
BANNED_EXPLANATION_PHRASES = [
    "Clinical reasoning should integrate",
    "This is intentionally plausible",
    "While X remains clinically plausible",
    "This reduces anchoring bias",
]


def load_rows(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data = data.get("rows") or data.get("questions") or []
        if not isinstance(data, list):
            raise ValueError("JSON input must be a list or object with rows/questions.")
        return [dict(row) for row in data]
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def has_word(value: str, word: str) -> bool:
    return re.search(rf"\b{re.escape(word)}\b", value, flags=re.IGNORECASE) is not None


def lint_row(row: dict[str, Any], display_row: str) -> list[str]:
    flags: list[str] = []
    missing = [field for field in REQUIRED_FIELDS if not text(row.get(field))]
    if missing:
        flags.append(f"missing required fields: {', '.join(missing)}")

    char_count = len(text(row.get("Question"))) + sum(len(text(row.get(field))) for field in OPTION_FIELDS)
    if char_count > CHAR_LIMIT:
        flags.append(f"stem/options character count {char_count} exceeds {CHAR_LIMIT}")

    answer = text(row.get("Correct Answer")).upper()
    if answer not in LETTERS:
        flags.append("Correct Answer is not A-E")

    explanation = text(row.get("Explanation"))
    if answer in LETTERS and not explanation.startswith(f"Option {answer} is correct."):
        flags.append(f"explanation does not start with 'Option {answer} is correct.'")

    for letter in LETTERS:
        if f"Option {letter}" not in explanation:
            flags.append(f"explanation does not address Option {letter}")

    if "Source:" not in explanation and not text(row.get("Source/Guideline")):
        flags.append("no source citation in Explanation or Source/Guideline")

    for field in OPTION_FIELDS:
        option = text(row.get(field))
        for word in BANNED_ABSOLUTES:
            if has_word(option, word):
                flags.append(f"{field} contains possible giveaway absolute '{word}'")

    for phrase in BANNED_EXPLANATION_PHRASES:
        if phrase.lower() in explanation.lower():
            flags.append(f"banned explanation phrase: {phrase}")

    duplicate_options = [
        option for option in set(text(row.get(field)).lower() for field in OPTION_FIELDS)
        if option and sum(text(row.get(field)).lower() == option for field in OPTION_FIELDS) > 1
    ]
    if duplicate_options:
        flags.append("duplicate or identical answer choices detected")

    return [f"row {display_row}: {flag}" for flag in flags]


def main() -> int:
    parser = argparse.ArgumentParser(description="Lint MedSwipe verifier target rows.")
    parser.add_argument("input", type=Path, help="CSV or JSON rows to lint")
    parser.add_argument("--json", action="store_true", help="Emit JSON")
    args = parser.parse_args()

    try:
        rows = load_rows(args.input)
    except Exception as exc:
        print(f"ERROR: failed to load rows: {exc}", file=sys.stderr)
        return 2

    all_flags: list[str] = []
    for idx, row in enumerate(rows, start=2):
        display_row = text(row.get("_Sheet Row")) or str(idx)
        all_flags.extend(lint_row(row, display_row))

    summary = {"total_rows": len(rows), "flags": all_flags}
    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        print(f"Total rows checked: {len(rows)}")
        if all_flags:
            print("Flags:")
            for flag in all_flags:
                print(f"  - {flag}")
        else:
            print("No deterministic lint flags.")

    return 1 if all_flags else 0


if __name__ == "__main__":
    raise SystemExit(main())
