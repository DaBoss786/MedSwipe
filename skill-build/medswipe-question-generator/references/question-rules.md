# MedSwipe Question Rules

## Source Policy

- Use only source material supplied by the user in the request, uploaded files, or explicit local paths.
- Do not fill factual gaps from memory.
- Do not fabricate PMIDs or guideline citations.
- If a source citation is unclear, cite the provided source text or file name rather than inventing a formal citation.

## Output Fields

Generate MedSwipe question fields, then map them into `AI_Drafts` using `sheet-config.md`.

Core question fields:

```text
Specialty, Category, Question, Option A, Option B, Option C, Option D, Option E,
Correct Answer, Explanation, CME Eligible, Image URL, DocID, Board Review, Free,
Procedures, Shareable Link, pilotNeurosurgery
```

## Character Limit

The combined character count of:

```text
Question + Option A + Option B + Option C + Option D + Option E
```

must be 625 characters or fewer. Shorten stems and options until every row passes.

## Question Quality

- Default to mostly clinical vignettes.
- Target senior resident difficulty: high-yield, clinically relevant, and testable.
- Favor diagnosis, management, complications, operative anatomy, imaging interpretation, guidelines, staging, and clinically important pathophysiology.
- Avoid vague prompts such as `Which of the following is TRUE?`.
- Avoid trivia that would not change clinical reasoning or board performance.

## Distractors

All distractors must be:

- Clinically real.
- From the same clinical domain as the correct answer.
- Plausible to a knowledgeable senior resident.
- Parallel in grammar, length, and specificity.
- Distinct concepts, not repeated rewordings.

Avoid absolute terms in answer choices unless the source and clinical concept truly require them:

```text
always, only, never, all, none, every, must, cannot, exclusively
```

## Correct Answers

- Use a single letter: `A`, `B`, `C`, `D`, or `E`.
- Distribute correct answers across a batch. For a 10-question batch, avoid having more than 3 of the same correct letter unless the user gave fixed option order.
- Do not force `E`; place the correct option where it reads naturally.

## Explanation Format

Every explanation must:

1. Start with `Option X is correct.` where `X` matches `Correct Answer`.
2. Explain why the correct option is correct using clinical reasoning.
3. Explain why each wrong option is wrong with a specific reason.
4. Include a concise teaching point when it adds senior-resident learning value.
5. End with a blank line followed by `Source: ...`.

Do not use meta-commentary or boilerplate such as:

```text
Clinical reasoning should integrate
This is intentionally plausible
While X remains clinically plausible
This reduces anchoring bias
```

## Deduplication

Before appending, compare generated `Question` text and core teaching points against existing rows in `AI_Drafts`. Do not append clear duplicates. Topic overlap is acceptable only when the new question tests a distinct concept or angle.
