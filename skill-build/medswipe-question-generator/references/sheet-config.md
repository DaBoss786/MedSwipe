# MedSwipe Sheet Config

## Target Spreadsheet

- Title: `ENT Questions`
- Spreadsheet ID: `1XFYv1gt2_KqIrZBAArQtCHzl81BlX69gQUvGgd1dUEc`
- URL: `https://docs.google.com/spreadsheets/d/1XFYv1gt2_KqIrZBAArQtCHzl81BlX69gQUvGgd1dUEc/edit`
- Draft sheet: `AI_Drafts`
- Draft sheet ID: `2147474388`
- Master sheet: `ENT_Quiz_Facts`

## AI_Drafts Headers

Read live headers before each write. As of setup, expected headers are:

```text
Approve
Review Status
Reviewer Notes
Promoted At
Promoted Row
Batch ID
Source/Guideline
Specialty
Category
Question
Option A
Option B
Option C
Option D
Option E
Correct Answer
Explanation
CME Eligible
Image URL
DocID
Board Review
Free
Procedures
Shareable Link
pilotNeurosurgery
```

## Required Generated Fields

Every generated question row must provide:

- `Specialty`
- `Category`
- `Question`
- `Option A`
- `Option B`
- `Option C`
- `Option D`
- `Option E`
- `Correct Answer`
- `Explanation`
- `Board Review`
- `Source/Guideline`
- `Batch ID`

## Fixed Defaults

- `Approve`: blank
- `Review Status`: `Draft`
- `Reviewer Notes`: blank
- `Promoted At`: blank
- `Promoted Row`: blank
- `CME Eligible`: blank every time
- `DocID`: blank every time
- `Shareable Link`: blank every time
- `Procedures`: blank unless the user explicitly provides a procedure value
- `Board Review`: `Yes`
- `Free`: blank unless the user explicitly asks to mark the batch free
- `pilotNeurosurgery`: blank unless the user explicitly asks for neurosurgery pilot availability

## Write Shape

Use targeted Sheets `updateCells` requests against `AI_Drafts` after validation. Build each row in live header order. Use string values for text fields and blank cells for required blanks.

Do not use `appendCells` on `AI_Drafts`. The sheet may contain preformatted checkbox rows where `Approve` renders as `FALSE`; `appendCells` can treat those rows as occupied and place new questions far below the visible review area.

To choose the write range:

1. Read live headers.
2. Read a bounded row range from `AI_Drafts`.
3. Find the first row after row 1 where generated-content fields are blank, especially `Batch ID`, `Specialty`, `Category`, and `Question`.
4. Write the batch starting at that row with `updateCells`.
5. If no content-empty row exists in the checked range, insert/add rows first, then write with `updateCells`.

Do not append to `ENT_Quiz_Facts`; approval from `AI_Drafts` handles promotion.
