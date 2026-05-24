# MedSwipe AI Draft Approval Workflow

This workflow keeps the existing `ENT_Quiz_Facts` to Firestore sync as the only Firestore publishing path. AI-generated questions are reviewed in a staging sheet, then promoted into `ENT_Quiz_Facts` by checking one approval box.

## Install

1. Open the bound Apps Script project for the master MedSwipe questions Google Sheet.
2. Add a new script file named `ai-draft-approval.gs`.
3. Paste the contents of `scripts/google-apps-script/ai-draft-approval.gs` into that file.
4. If the project already has an `onEdit(e)` function, do not keep two `onEdit` functions. Add this line inside the existing `onEdit(e)` instead:

```javascript
handleAiDraftApprovalEdit(e);
```

5. Run `setupAiDraftReviewSheet()` once from Apps Script to create or repair the `AI_Drafts` tab.
6. Authorize the script when Google prompts for permissions.

## Review Flow

1. Add generated questions into `AI_Drafts`.
2. Fill the required fields:
   - `Question`
   - `Option A`
   - `Option B`
   - `Correct Answer`
   - `Explanation`
   - `Category`
   - `Specialty`
3. Check the `Approve` checkbox for a row.
4. The script appends matching question columns to the bottom of `ENT_Quiz_Facts`.
5. The draft row is stamped with `Review Status`, `Promoted At`, and `Promoted Row`.
6. Run `syncQuestions_WithDelete_And_Procedures()` manually when ready to publish approved master-sheet rows into Firestore.

## Guardrails

- Approval does not call `syncQuestions_WithDelete_And_Procedures()`.
- `DocID` is left blank on the appended master row so the existing sync can create or match the Firestore document.
- Draft-only metadata columns are not copied into the master sheet.
- A promoted draft cannot be promoted again because `Promoted At` blocks duplicate appends.
- `LockService` prevents double appends from rapid checkbox edits.

## Quick Test

1. Run `setupAiDraftReviewSheet()`.
2. Add one complete draft row in `AI_Drafts`.
3. Check `Approve`.
4. Confirm one row appears at the bottom of `ENT_Quiz_Facts`.
5. Uncheck and recheck `Approve`; confirm no duplicate row is appended.
6. Add a row missing `Correct Answer`, check `Approve`, and confirm the row is marked `Needs Revision`.
