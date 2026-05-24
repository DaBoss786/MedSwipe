# Manual Claude Follow-Up: urology-aua-hourly-2026-05-20-05

Run time: 2026-05-20 22:05 PDT

## Outcome

Claude manual review found the batch-level dedupe pass failed. The sheet had been incorrectly marked `Pass: 10` before manual handoff. I corrected verifier columns in `AI_Drafts!361:370` to reflect the manual review.

## Corrected verifier state

- Row 361: `Reject` - direct duplicate of row 322, high-risk biochemical recurrence after prostatectomy -> add ADT to salvage prostate-bed RT.
- Row 362: `Needs Revision` - saturation risk in risk-stratified BCG maintenance duration family; curator should decide whether to retain the high-risk inverse.
- Row 363: `Pass` - unfavorable intermediate-risk prostate radiation plus short-course ADT; distinct concept.
- Row 364: `Reject` - direct duplicate of row 324, residual/recurrent struvite stones after exhausted surgery -> acetohydroxamic acid.
- Row 365: `Reject` - direct duplicate of row 335, chlorthalidone/thiazide stone-prevention safety monitoring -> periodic blood testing.
- Row 366: `Reject` - direct duplicate of row 316, severe OAB failed therapies requesting chronic catheter drainage -> SDM with harm counseling.
- Row 367: `Pass` - beta-3 agonist blood-pressure monitoring; distinct enough from prescribing avoidance row 336, but distractors are weak.
- Row 368: `Reject` - third duplicate of rows 278 and 328, microhematuria with medical renal disease -> nephrology plus risk-based urologic evaluation.
- Row 369: `Pass` - epididymectomy for epididymal-localized post-vasectomy pain; distinct from cord-block denervation row 349.
- Row 370: `Reject` - direct duplicate of row 330, persistent cystitis symptoms after antimicrobial treatment -> repeat urine culture.

Final corrected counts: `Pass: 3`, `Needs Revision: 1`, `Reject: 6`, `Source Needed: 0`.

## Root cause

The generation/verification sequence relied on local artifacts and the existing saturation registry rather than a mandatory live-sheet cross-batch dedupe read over prior `AI_Drafts` Urology rows. The local guard existed but was not run as a hard pre-write blocker, and it was not using the authoritative live sheet rows. That allowed repeated concepts from rows 278, 316, 322, 324, 328, 330, and 335 to be rewritten and incorrectly marked as passing.

## Mitigation applied

- Corrected live verifier statuses for `AI_Drafts!361:370`.
- Added the duplicate families surfaced by Claude to `build/automation/urology_saturated_concepts.json`.
- Re-ran the local concept guard against the batch; it fails at least row 362 and row 368 from local artifacts alone, confirming this should have blocked writeback.

## Required next automation behavior

Before any future Urology batch writeback, run a hard cross-batch dedupe step against live `AI_Drafts` rows from at least row 261 onward, plus `build/automation/urology_saturated_concepts.json`. A candidate batch should not be written if any row matches the same scenario, decision point, correct answer, and teaching point as a prior row.
