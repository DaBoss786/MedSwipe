---
name: medswipe-question-generator
description: Generate senior-resident board review or in-service medical questions for MedSwipe from user-provided source material, validate MedSwipe question constraints, deduplicate against AI_Drafts, and append validated rows to the ENT Questions Google Sheet AI_Drafts tab. Use when asked to create, draft, validate, or upload MedSwipe question-bank MCQs for any specialty.
---

# MedSwipe Question Generator

Generate MedSwipe-ready senior-resident board/in-service MCQs from user-provided source material and append validated rows to the `AI_Drafts` tab for human review.

## Workflow

1. Confirm source material exists in the request, uploaded files, or user-provided paths. Do not generate from general knowledge alone.
2. Read `references/question-rules.md` and `references/sheet-config.md`.
3. Read live `AI_Drafts` headers from the configured Google Sheet before writing. Also read existing `AI_Drafts` questions for deduplication.
4. For recurring Urology AUA/SASP automation runs, run the full-sheet concept guard before drafting full MCQs:
   - Read the entire `AI_Drafts` tab from the configured Google Sheet (`range=1:1000` or the current full row limit) and save the raw connector JSON to `build/automation/ai_drafts_full_export.json`.
   - If the full-sheet export cannot be read or saved, fail closed: do not generate, do not write rows, and do not flip automation source mode.
   - Refresh the ledger with `python3 build/automation/scripts/urology_concept_guard.py --live-sheet-export build/automation/ai_drafts_full_export.json --require-live-sheet --write-ledger`.
   - Draft at least 15-20 structured candidate concepts first, not full rows. Include `source_guideline`, `category`, `clinical_trigger`, `decision_point`, `correct_answer_concept`, `teaching_point`, and `source_section`.
   - Save the concept plan JSON under `build/automation/` and run `python3 build/automation/scripts/urology_concept_guard.py --candidate <plan.json> --live-sheet-export build/automation/ai_drafts_full_export.json --require-live-sheet --write-ledger`.
   - If the guard returns `status: fail`, replace every flagged concept before generating full rows. Do not write a failed concept to `AI_Drafts`.
   - After generating the final 10-row batch JSON, run the guard again against that batch. A final guard failure is a pre-write blocker.
5. Generate the requested number of questions, defaulting to 10.
6. Build rows in the live `AI_Drafts` header order. Use these defaults:
   - `Approve`: blank
   - `Review Status`: `Draft`
   - `Reviewer Notes`, `Promoted At`, `Promoted Row`: blank
   - `CME Eligible`, `Shareable Link`, `DocID`: blank
   - `Procedures`: blank unless the user explicitly provides a procedure value
   - `Board Review`: `Yes`
   - `Free`: blank unless the user explicitly asks
7. Save the generated rows as CSV or JSON in a temp/workspace file and run `scripts/validate_questions.py`.
8. Fix every validation error and rerun the validator until it passes.
9. Write validated rows to `AI_Drafts` using the Google Drive/Sheets connector. Never write directly to `ENT_Quiz_Facts` or Firestore.

## Generation Rules

- Target senior residents studying for boards or in-service exams.
- Prefer clinically relevant vignettes over direct recall unless anatomy, physiology, pharmacology, or operative facts are best tested directly.
- Use five plausible, parallel options (`Option A` through `Option E`) from the same clinical domain.
- Keep `Question + Option A + Option B + Option C + Option D + Option E <= 625` characters.
- Start each explanation with `Option X is correct.` where `X` matches `Correct Answer`.
- Explain why each wrong answer is wrong.
- Include a concise teaching point when it adds senior-resident value.
- End every explanation with `Source: ...`.
- Never fabricate citations, PMIDs, guideline statements, or source-derived facts.

## Urology Automation Deduplication

- Treat `build/automation/hourly_urology_concept_guard.md` as the operational handoff for recurring Urology batches.
- The guard is required because duplicate detection must happen before sheet write, not only during verifier or Claude review.
- The guard must use the entire live `AI_Drafts` tab, not only recent rows or local artifacts.
- A Urology concept is blocked when it repeats the same clinical trigger, decision point, correct-answer concept, and teaching point, even if the stem uses different demographics, PSA values, imaging labels, risk tiers, option letters, or wording.
- When the guard flags a concept, regenerate a materially different decision layer from the source. Do not cosmetically rewrite the same concept.

## Sheet Write Rules

- Use the configured spreadsheet in `references/sheet-config.md`.
- Always read live headers immediately before appending.
- Align values by header name, not fixed column position.
- Find the first content-empty row by checking generated-content fields such as `Batch ID`, `Specialty`, `Category`, and `Question`; ignore `FALSE` checkbox values in `Approve`.
- Prefer targeted `updateCells` writes into the first content-empty row. Do not use `appendCells` on this sheet because preformatted checkbox rows can push new content far below the review area.
- Preserve blank fields exactly where required by the sheet config.
- Before writing, summarize question count, categories, answer distribution, and any warnings from validation.
- If the Google Drive/Sheets connector is unavailable, return a validated CSV instead of trying another live-write path.
