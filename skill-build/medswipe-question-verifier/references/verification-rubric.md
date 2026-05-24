# MedSwipe Verification Rubric

## Purpose

Verify whether an AI-generated MedSwipe question is safe and useful for a senior resident studying for boards or in-service. Be stricter than the generator.

## Accuracy

Check whether:

- The correct answer is factually correct and best among the choices.
- The stem provides enough information to choose the intended answer.
- The explanation's clinical reasoning is accurate.
- The explanation does not overstate evidence, guidelines, trial findings, staging, anatomy, or management recommendations.
- The source actually supports the key teaching point.

Status guidance:

- `Pass`: no substantive factual issues.
- `Needs Revision`: mostly correct but needs wording, nuance, or citation fixes.
- `Reject`: wrong answer, misleading teaching point, unsupported claim, or unsafe recommendation.
- `Source Needed`: cannot verify the key claim from supplied or reachable sources.

## Distractor Quality

Assess whether answer choices are:

- Same clinical domain as the correct answer.
- Plausible to a knowledgeable senior resident.
- Parallel in structure and specificity.
- Clinically real.
- Distinct concepts rather than synonyms.
- Free of obvious giveaways.

Flag options containing avoidable absolutes:

```text
always, only, never, all, none, every, must, cannot, exclusively
```

These terms are not automatically wrong, but they are suspect and need justification.

## Explanation Quality

Check whether the explanation:

- Starts with `Option X is correct.` and matches the `Correct Answer`.
- Explains why the correct answer is correct.
- Explains why each wrong option is wrong.
- Includes enough senior-resident teaching value.
- Ends with a source citation when source citation is expected.
- Avoids generic AI meta-commentary.

## Scoring

Use this 100-point score:

- Accuracy/source support: 40 points
- Distractor quality: 25 points
- Explanation quality: 20 points
- Stem clarity and relevance: 10 points
- Formatting/MedSwipe constraints: 5 points

Suggested status by score:

- `90-100`: `Pass`
- `70-89`: `Needs Revision`
- `1-69`: `Reject` unless the only problem is missing source
- `0` or unverifiable key claim: `Source Needed`

Use judgment; a single serious factual error should prevent `Pass` even if the score would otherwise be high.

## Suggested Edits

When marking `Needs Revision`, provide concise actionable fixes:

- Replace a weak distractor.
- Remove absolute wording.
- Narrow an overbroad explanation claim.
- Add missing source support.
- Rewrite the stem to remove ambiguity.

Do not rewrite the entire row unless the user asks.
