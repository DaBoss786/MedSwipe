# MedSwipe Verifier Sheet Config

## Target Spreadsheet

- Title: `ENT Questions`
- Spreadsheet ID: `1XFYv1gt2_KqIrZBAArQtCHzl81BlX69gQUvGgd1dUEc`
- URL: `https://docs.google.com/spreadsheets/d/1XFYv1gt2_KqIrZBAArQtCHzl81BlX69gQUvGgd1dUEc/edit`
- Draft sheet: `AI_Drafts`
- Draft sheet ID: `2147474388`

## Core AI_Drafts Headers

Read live headers before every verification write. The verifier expects the row to include:

```text
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
Source/Guideline
```

## Verifier Headers

These columns belong after `pilotNeurosurgery`:

```text
Verification Status
Verification Score
Accuracy Verdict
Distractor Verdict
Explanation Verdict
Source Verdict
Verification Findings
Suggested Edits
Verified Sources
Verified At
```

## Write Rules

- Only write verifier columns.
- `Verification Status`: one of `Pass`, `Needs Revision`, `Reject`, `Source Needed`.
- `Verification Score`: integer `0-100`.
- `Accuracy Verdict`: concise factual correctness judgment.
- `Distractor Verdict`: concise answer-choice quality judgment.
- `Explanation Verdict`: concise explanation-quality judgment.
- `Source Verdict`: source support and whether outside verification was needed.
- `Verification Findings`: short issue list or pass rationale.
- `Suggested Edits`: concrete edits if revision is needed; blank if none.
- `Verified Sources`: source names/URLs/PMIDs used.
- `Verified At`: timestamp in local run context or ISO-like text.

Never write `Approve`, `Review Status`, `Promoted At`, or `Promoted Row`.
