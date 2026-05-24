# Hourly Urology Concept Guard

This is the pre-write duplicate gate for the hourly Urology AUA/SASP qbank cycle.
It exists because post-write verifier and Claude review were catching recycled
concepts too late.

## Required order for every future hourly run

1. Read the entire live `AI_Drafts` tab, starting at row 1 with headers, through
   the current sheet row limit. Save the raw connector JSON to:

   ```text
   build/automation/ai_drafts_full_export.json
   ```

   Current expected connector read:

   ```text
   spreadsheet_id=1XFYv1gt2_KqIrZBAArQtCHzl81BlX69gQUvGgd1dUEc
   sheet_name=AI_Drafts
   range=1:1000
   value_render_option=FORMATTED_VALUE
   ```

   This full-sheet read is mandatory because local artifacts are not
   authoritative and have already missed duplicates.
2. Read `build/automation/urology_saturated_concepts.json`.
3. Build or refresh the local ledger:

   ```bash
   python3 build/automation/scripts/urology_concept_guard.py \
     --live-sheet-export build/automation/ai_drafts_full_export.json \
     --require-live-sheet \
     --write-ledger
   ```

4. Before drafting full MCQs, create a concept-plan JSON with at least 15-20
   candidate concepts. Each concept should include:

   ```json
   {
     "source_guideline": "Allowed public AUA guideline name",
     "category": "Urology category",
     "clinical_trigger": "specific patient/state",
     "decision_point": "clinical decision being tested",
     "correct_answer_concept": "answer concept, not option letter",
     "teaching_point": "why this is worth testing",
     "source_section": "guideline statement or section used"
   }
   ```

5. Add every direct duplicate or saturation family found by Claude/manual review
   to `build/automation/urology_saturated_concepts.json` before generating.
6. Run the guard before writing rows:

   ```bash
   python3 build/automation/scripts/urology_concept_guard.py \
     --candidate build/automation/<candidate_concept_plan>.json \
     --live-sheet-export build/automation/ai_drafts_full_export.json \
     --require-live-sheet \
     --write-ledger
   ```

7. If the guard returns `status: fail`, reject or replace every flagged concept
   before writing anything to `AI_Drafts`.
8. Only after the concept plan passes should the generator turn the best 10
   concepts into MedSwipe rows.
9. Run the guard again against the final 10-row batch JSON before sheet write:

   ```bash
   python3 build/automation/scripts/urology_concept_guard.py \
     --candidate build/automation/urology_aua_guidelines_batches/<batch_id>.json \
     --live-sheet-export build/automation/ai_drafts_full_export.json \
     --require-live-sheet \
     --write-ledger
   ```

10. If the final batch guard fails, do not write the batch. Regenerate only the
   flagged concepts and rerun the guard.
11. Before verifier columns can be marked `Pass`, explicitly compare each
    candidate row against the live sheet rows read in step 1 by scenario,
    decision point, correct answer, and teaching point. If any match is found,
    the row is `Reject` or `Needs Revision`; it cannot be called a safe
    pre-Claude auto-fix.

## What the guard checks

- All populated live `AI_Drafts` Urology rows, regardless of row number or
  review status.
- Prior local AUA/SASP Urology batch JSON artifacts.
- `build/automation/urology_saturated_concepts.json`.
- Duplicate concepts inside the candidate batch itself.
- Same decision point, same answer concept, and same teaching point even when
  wording, demographics, PSA values, risk tier, or option letters differ.

## Current hard rule

The hourly automation should never rely on Claude as the first duplicate check.
Claude is a final critic only. A duplicate flagged by this guard is a pre-write
blocker.

After the `urology-aua-hourly-2026-05-20-05` failure, the local artifact guard
alone is no longer acceptable. A run that cannot read and save the full live
`AI_Drafts` history must fail closed and preserve `next_mode`; it must not write
a new batch.
