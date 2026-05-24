---
name: medswipe-question-verifier
description: Verify MedSwipe AI_Drafts question rows for factual accuracy, source support, explanation quality, and distractor quality using provided sources plus web/PubMed/society verification. Use when asked to review, verify, audit, score, or quality-check MedSwipe generated board-review questions by row range before human approval.
---

# MedSwipe Question Verifier

Verify existing `AI_Drafts` rows before human approval. This skill never approves, promotes, or overwrites question fields unless the user explicitly asks.

## Workflow

1. Read `references/verification-rubric.md` and `references/sheet-config.md`.
2. Read the requested `AI_Drafts` row range from the configured Google Sheet.
3. Ask for source material only if none was provided and the row's `Source/Guideline` is not enough to identify the source. If source support is not available, mark `Source Verdict = Source Needed`.
4. For recurring Urology AUA/SASP automation rows, check the row range against `build/automation/urology_concept_ledger.json` and `build/automation/urology_saturated_concepts.json`. A repeated clinical trigger, decision point, correct-answer concept, and teaching point is an approval blocker even if factual support is strong.
5. Run `scripts/lint_verification_targets.py` on the row data to catch deterministic issues.
6. Verify content source-first:
   - Use provided source text/files first.
   - Use web/PubMed/society or official guideline sources for confirmation when the source is incomplete, ambiguous, or potentially outdated.
   - Cite every outside source used in `Verified Sources`.
7. Score each row and write only verifier columns back to `AI_Drafts`.
8. Leave `Approve`, question text, answer choices, explanation, and promotion columns unchanged.

## Verdicts

Use only these status values:

- `Pass`: factually accurate, source-supported, senior-resident appropriate, and distractors are strong.
- `Needs Revision`: usable concept with fixable issues.
- `Reject`: inaccurate, unsupported, misleading, duplicate/low-value, or not suitable for MedSwipe.
- `Source Needed`: cannot verify because source material is missing or insufficient.

## Sheet Write Rules

- Read live headers before writing.
- Write only columns listed in `references/sheet-config.md` under `Verifier Headers`.
- Align by header name, not fixed column position.
- Keep findings concise enough to scan in Sheets.
- Put rewritten text suggestions in `Suggested Edits`; do not overwrite original question fields unless explicitly asked.

## Web Verification Rules

- Browse when verifying medical facts that could be wrong, incomplete, or outdated.
- Prefer official society guidelines, PubMed/PMC, FDA/drug labels, major textbooks supplied by the user, or reputable institutional references.
- Do not fabricate PMIDs, guideline recommendations, or citations.
- If sources conflict, mark `Needs Revision` or `Source Needed` and describe the conflict.
