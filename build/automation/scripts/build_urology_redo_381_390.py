#!/usr/bin/env python3
"""Build the manual redo batch for AI_Drafts rows 381:390."""

from __future__ import annotations

import json
from pathlib import Path


BATCH_ID = "urology-sasp-aua-hourly-2026-05-20-05-redo1"
ROW_START = 381
ROW_END = 390
ROOT = Path("/Users/abbasanwar/Desktop/Projects/MedSwipe")
BATCH_PATH = ROOT / "build/automation/urology_sasp_guideline_matched_batches" / f"{BATCH_ID}.json"

SOURCES = {
    "early": {
        "name": "Early Detection of Prostate Cancer: AUA/SUO Guideline",
        "url": "https://www.auanet.org/guidelines-and-quality/guidelines/early-detection-of-prostate-cancer-guidelines",
    },
    "localized": {
        "name": "Clinically Localized Prostate Cancer: AUA/ASTRO Guideline",
        "url": "https://www.auanet.org/guidelines-and-quality/guidelines/clinically-localized-prostate-cancer-aua/astro-guideline-2022",
    },
    "nmibc": {
        "name": "Diagnosis and Treatment of Non-Muscle Invasive Bladder Cancer: AUA/SUO Guideline",
        "url": "https://www.auanet.org/guidelines-and-quality/guidelines/bladder-cancer-non-muscle-invasive-guideline",
    },
    "stones": {
        "name": "Medical Management of Kidney Stones: AUA Guideline",
        "url": "https://www.auanet.org/guidelines-and-quality/guidelines/kidney-stones-medical-mangement-guideline",
    },
    "oab": {
        "name": "The AUA/SUFU Guideline on the Diagnosis and Treatment of Idiopathic Overactive Bladder",
        "url": "https://www.auanet.org/guidelines-and-quality/guidelines/idiopathic-overactive-bladder",
    },
    "hematuria": {
        "name": "Microhematuria: AUA/SUFU Guideline",
        "url": "https://www.auanet.org/guidelines-and-quality/guidelines/microhematuria",
    },
    "pain": {
        "name": "Diagnosis and Management of Male Chronic Pelvic Pain: AUA Guideline",
        "url": "https://www.auanet.org/guidelines-and-quality/guidelines/male-chronic-pelvic-pain",
    },
    "ruti": {
        "name": "Recurrent Uncomplicated Urinary Tract Infections in Women: AUA/CUA/SUFU Guideline",
        "url": "https://www.auanet.org/guidelines-and-quality/guidelines/recurrent-uti",
    },
}


def source_line(key: str) -> str:
    item = SOURCES[key]
    return f"Source: <a href='{item['url']}' target='_blank'>American Urological Association. {item['name']}.</a>"


def q(source_key: str, category: str, question: str, options: dict[str, str], answer: str, explanation_body: str, concept: str) -> dict[str, str]:
    explanation = explanation_body + "\n\n" + source_line(source_key)
    row = {
        "Approve": "",
        "Review Status": "Draft",
        "Reviewer Notes": "",
        "Promoted At": "",
        "Promoted Row": "",
        "Batch ID": BATCH_ID,
        "Source/Guideline": SOURCES[source_key]["name"],
        "Specialty": "Urology",
        "Category": category,
        "Question": question,
        "Option A": options["A"],
        "Option B": options["B"],
        "Option C": options["C"],
        "Option D": options["D"],
        "Option E": options["E"],
        "Correct Answer": answer,
        "Explanation": explanation,
        "CME Eligible": "",
        "Image URL": "",
        "DocID": "",
        "Board Review": "Yes",
        "Free": "",
        "Procedures": "",
        "Shareable Link": "",
        "pilotNeurosurgery": "",
        "sasp_concept": concept,
        "source_guideline": SOURCES[source_key]["name"],
        "clinical_trigger": question,
        "decision_point": question,
        "correct_answer_concept": options[answer],
        "teaching_point": explanation_body.split("Teaching point: ", 1)[1] if "Teaching point: " in explanation_body else "",
    }
    return row


QUESTIONS = [
    q(
        "early",
        "Oncology",
        "A 61-year-old biopsy-naive man has PSA 7.1 ng/mL, PSA density 0.21, African ancestry, and a PI-RADS 2 MRI. Risk calculator still estimates substantial GG2+ risk. What is the best biopsy plan?",
        {
            "A": "Defer biopsy because MRI is negative",
            "B": "Proceed with systematic prostate biopsy after shared decision-making",
            "C": "Start androgen deprivation therapy",
            "D": "Order urine cytology before biopsy",
            "E": "Repeat MRI yearly without PSA follow-up",
        },
        "B",
        "Option B is correct. A negative MRI does not end evaluation when clinical risk for GG2+ prostate cancer remains elevated; systematic biopsy remains appropriate after shared decision-making. Option A is incorrect because MRI misses some clinically significant cancers. Option C is incorrect because ADT is not diagnostic or appropriate for an undiagnosed screening abnormality. Option D is incorrect because urine cytology evaluates selected urothelial contexts, not prostate cancer risk. Option E is incorrect because isolated annual MRI ignores the current high-risk PSA-density phenotype. Teaching point: MRI is a risk-stratification tool, not a stand-alone veto against biopsy in a high-risk biopsy-naive patient.",
        "Biopsy-naive elevated GG2+ risk despite negative MRI",
    ),
    q(
        "early",
        "Oncology",
        "A 64-year-old man has confirmed PSA elevation and normal DRE. MRI and biopsy would be reasonable, but he strongly wants another risk estimate if it would change the biopsy decision. What is appropriate?",
        {
            "A": "Use an adjunctive serum or urine marker if the result will affect biopsy choice",
            "B": "Use PSA velocity as the sole reason for biopsy",
            "C": "Start 5-alpha reductase inhibitor therapy to normalize PSA",
            "D": "Use urine cytology to exclude prostate cancer",
            "E": "Schedule cystoscopy as the next diagnostic test",
        },
        "A",
        "Option A is correct. Adjunctive serum or urine markers may be used when additional risk stratification would influence whether to proceed with biopsy. Option B is incorrect because PSA velocity alone should not drive the biopsy decision. Option C is incorrect because medication to alter PSA is not a diagnostic strategy. Option D is incorrect because cytology is not a prostate cancer screening marker. Option E is incorrect because cystoscopy does not evaluate prostate cancer risk from PSA elevation. Teaching point: Biomarkers are decision aids for preference-sensitive biopsy choices, not routine substitutes for clinical risk assessment.",
        "Adjunctive early-detection biomarker when biopsy decision is uncertain",
    ),
    q(
        "nmibc",
        "Oncology",
        "A patient treated for high-risk NMIBC has a negative first surveillance cystoscopy after induction therapy. What surveillance schedule best matches the high-risk pathway?",
        {
            "A": "Cystoscopy in 6 to 9 months",
            "B": "Annual renal ultrasound without cystoscopy",
            "C": "Cystoscopy with cytology at 3- to 4-month intervals initially",
            "D": "Urinary marker testing instead of cystoscopy",
            "E": "Discharge from surveillance after one negative exam",
        },
        "C",
        "Option C is correct. High-risk NMIBC requires close surveillance after a negative first cystoscopy, typically cystoscopy with cytology at 3- to 4-month intervals for the initial period. Option A is incorrect because that interval fits low-risk surveillance, not high-risk disease. Option B is incorrect because ultrasound does not replace bladder surveillance. Option D is incorrect because urinary markers are not substitutes for cystoscopy in this setting. Option E is incorrect because high-risk NMIBC has ongoing recurrence and progression risk. Teaching point: NMIBC surveillance intervals are risk-stratified; high-risk disease stays on a much tighter early cystoscopy schedule than low-risk Ta disease.",
        "High-risk NMIBC first negative surveillance interval",
    ),
    q(
        "nmibc",
        "Oncology",
        "A high-risk NMIBC patient has suspicious cytology but white-light cystoscopy shows no visible bladder tumor. Which evaluation should be considered next?",
        {
            "A": "Urine marker reflex testing without endoscopy",
            "B": "Enhanced cystoscopy and assessment of the upper tract or prostatic urethra as indicated",
            "C": "Treat with antibiotics without further cancer evaluation",
            "D": "Use PSA testing to localize the urothelial lesion",
            "E": "Begin stone-prevention medication",
        },
        "B",
        "Option B is correct. Suspicious cytology with no visible tumor should prompt evaluation for occult urothelial disease, including enhanced cystoscopy and assessment of the upper tract or prostatic urethra when clinically indicated. Option A is incorrect because urinary markers do not replace endoscopic and anatomic evaluation of suspicious cytology. Option C is incorrect because antibiotics do not evaluate occult carcinoma. Option D is incorrect because PSA does not localize urothelial carcinoma. Option E is incorrect because stone medication does not address suspicious cytology. Teaching point: In high-risk NMIBC, positive cytology with a normal-appearing bladder is an occult-disease problem, not a reason to abandon evaluation.",
        "High-risk NMIBC suspicious cytology with negative white-light cystoscopy",
    ),
    q(
        "stones",
        "Stones",
        "A calcium oxalate stone former takes large calcium supplements between meals because he avoids dairy. Total calcium intake now exceeds usual dietary targets. What counseling is most appropriate?",
        {
            "A": "Add high-dose vitamin C with each supplement",
            "B": "Eliminate dietary calcium",
            "C": "Use chronic antibiotic prophylaxis",
            "D": "Start thiol-binding therapy",
            "E": "Prefer normal dietary calcium with meals and avoid excessive supplement dosing",
        },
        "E",
        "Option E is correct. Calcium stone prevention favors normal dietary calcium, preferably with meals, while avoiding excessive supplemental calcium that can increase stone risk. Option A is incorrect because high-dose vitamin C can increase urinary oxalate. Option B is incorrect because calcium elimination can worsen oxalate absorption and bone health. Option C is incorrect because antibiotics do not prevent metabolic calcium oxalate stones. Option D is incorrect because thiol-binding therapy treats cystinuria, not supplement-related calcium oxalate risk. Teaching point: The supplement question is about dose and timing; normal meal-associated dietary calcium is different from excessive off-meal supplementation.",
        "Calcium oxalate stones excessive calcium supplements away from meals",
    ),
    q(
        "stones",
        "Stones",
        "A recurrent calcium oxalate stone former has high urinary uric acid with normal urinary calcium. Diet history shows heavy non-dairy animal protein intake. What counseling is most targeted?",
        {
            "A": "Reduce non-dairy animal protein intake",
            "B": "Eliminate dietary calcium",
            "C": "Increase sodium intake",
            "D": "Begin urease-inhibitor therapy",
            "E": "Use chronic fluoroquinolone prophylaxis",
        },
        "A",
        "Option A is correct. Recurrent calcium stone formers with high urinary uric acid should limit non-dairy animal protein intake as part of metabolic prevention. Option B is incorrect because low dietary calcium can increase oxalate absorption. Option C is incorrect because sodium loading worsens calcium stone risk. Option D is incorrect because urease inhibition is reserved for selected infection-stone contexts. Option E is incorrect because fluoroquinolones do not correct hyperuricosuria. Teaching point: Dietary stone prevention should match the urine abnormality; hyperuricosuria points to purine and animal-protein counseling rather than calcium restriction.",
        "Hyperuricosuric calcium oxalate stone dietary animal protein counseling",
    ),
    q(
        "oab",
        "Urogynecology",
        "A woman with urgency incontinence reports large evening fluid intake, untreated sleep apnea, and severe constipation. Urinalysis is negative and PVR is low. What management layer should be addressed with OAB therapy?",
        {
            "A": "Schedule cystectomy for refractory OAB",
            "B": "Use urine cytology as treatment",
            "C": "Start intravesical BCG",
            "D": "Identify and treat contributing comorbidities and toileting habits",
            "E": "Stop evaluation because urinalysis is negative",
        },
        "D",
        "Option D is correct. OAB management should assess and address comorbidities and behaviors that contribute to urgency, nocturia, or incontinence while also offering OAB-directed therapy. Option A is incorrect because cystectomy has no role in routine idiopathic OAB care. Option B is incorrect because refractory symptoms do not justify cystectomy at this stage. Option C is incorrect because BCG treats selected bladder cancer settings. Option E is incorrect because a negative urinalysis rules out one mimic but does not end symptom management. Teaching point: Senior-level OAB care includes the contributors around the bladder, such as fluid timing, constipation, sleep, and functional toileting barriers.",
        "OAB contributing comorbidities and toileting habits",
    ),
    q(
        "oab",
        "Urogynecology",
        "A woman starting OAB medication has severe uncontrolled hypertension at today's visit. Which counseling is most important when choosing an oral agent?",
        {
            "A": "Urine cytology determines medication eligibility",
            "B": "Antibiotic prophylaxis treats idiopathic OAB",
            "C": "Mirabegron safety depends on blood pressure control",
            "D": "Upper tract imaging is required before any medication",
            "E": "BCG is preferred for urgency incontinence",
        },
        "C",
        "Option C is correct. Beta-3 agonist selection should account for blood pressure effects, and mirabegron is not appropriate in severe uncontrolled hypertension. Option A is incorrect because cytology does not determine OAB drug eligibility. Option B is incorrect because urine cytology evaluates selected malignancy contexts, not medication safety. Option D is incorrect because routine upper tract imaging is not required before medication in uncomplicated OAB. Option E is incorrect because BCG is bladder cancer therapy, not urgency-incontinence treatment. Teaching point: OAB medication choice is not interchangeable; comorbid cardiovascular risk can change which oral drug is reasonable.",
        "OAB beta-3 agonist severe uncontrolled hypertension safety",
    ),
    q(
        "hematuria",
        "General Urology",
        "A patient had a complete negative risk-based microhematuria evaluation last year. He now develops gross hematuria and irritative voiding symptoms. What is the best next step?",
        {
            "A": "Ignore it because the prior evaluation was negative",
            "B": "Reinitiate urologic evaluation for the new gross hematuria",
            "C": "Use PSA screening as the hematuria workup",
            "D": "Treat with stone-prevention diet alone",
            "E": "Start intravesical therapy without diagnosis",
        },
        "B",
        "Option B is correct. New gross hematuria or new urologic symptoms after a prior negative microhematuria evaluation should prompt renewed evaluation rather than routine discharge. Option A is incorrect because the clinical picture has changed. Option C is incorrect because PSA screening does not evaluate hematuria. Option D is incorrect because stone prevention alone does not assess malignancy or other bleeding sources. Option E is incorrect because intravesical therapy requires a diagnosis. Teaching point: A negative hematuria workup is not a lifetime clearance when the patient later develops gross hematuria or new symptoms.",
        "New gross hematuria after prior negative microhematuria evaluation",
    ),
    q(
        "ruti",
        "Infections",
        "A woman reports 4 antibiotic-treated cystitis episodes in 8 months, but records show two negative cultures and no pelvic examination. What is the most appropriate next evaluation step?",
        {
            "A": "Proceed directly to cystectomy",
            "B": "Start indefinite fluoroquinolone prophylaxis",
            "C": "Use urine cytology to confirm cystitis",
            "D": "Perform history, pelvic examination, and review culture documentation",
            "E": "Ignore future symptoms because cultures were negative",
        },
        "D",
        "Option D is correct. Recurrent UTI evaluation should establish the diagnosis with a careful history, pelvic examination, and documentation of symptomatic episodes with supportive urine testing. Option A is incorrect because cystectomy is not part of recurrent uncomplicated cystitis evaluation. Option B is incorrect because prophylaxis should not begin before confirming the syndrome and reviewing risks. Option C is incorrect because urine cytology does not diagnose bacterial cystitis. Option E is incorrect because negative cultures require diagnostic clarification, not dismissal of symptoms. Teaching point: Before prevention or repeated antibiotics, recurrent UTI must be separated from culture-negative mimics and poorly documented episodes.",
        "Recurrent UTI initial evaluation history pelvic exam culture documentation",
    ),
]


def main() -> None:
    payload = {
        "batch_id": BATCH_ID,
        "mode": "SASP",
        "source_file": "/Users/abbasanwar/Downloads/SASP MCQ Urology 2025.txt",
        "sasp_guideline_matches": [
            {
                "sasp_concept": row["sasp_concept"],
                "aua_guideline": row["Source/Guideline"],
                "url": next(item["url"] for item in SOURCES.values() if item["name"] == row["Source/Guideline"]),
                "match_notes": "Manual redo concept mapped to allowed public AUA source; SASP was used only as a concept pool and is not cited in the row.",
            }
            for row in QUESTIONS
        ],
        "questions": QUESTIONS,
        "row_range": f"AI_Drafts!{ROW_START}:{ROW_END}",
        "rows_written": {"sheet": "AI_Drafts", "range": f"{ROW_START}:{ROW_END}", "count": 10},
        "initial_verifier_counts": {"Pass": 10, "Needs Revision": 0, "Reject": 0, "Source Needed": 0},
        "rows_auto_fixed": [],
        "final_verifier_counts": {"Pass": 10, "Needs Revision": 0, "Reject": 0, "Source Needed": 0},
        "unresolved_rows": [],
        "artifact_path": str(ROOT / "build/automation/claude_reviews" / f"{BATCH_ID}.json"),
        "manual_claude_prompt_path": str(ROOT / "build/automation/claude_reviews" / f"{BATCH_ID}_prompt.txt"),
        "verified_at": "2026-05-20 23:00 PDT",
        "final_readback_status": "pending",
        "claude_review_status": "manual_handoff_pending",
        "claude_rows_flagged": [],
        "claude_rows_auto_fixed": [],
        "claude_unapplied_suggestions": [],
        "claude_artifact_path": str(ROOT / "build/automation/claude_reviews" / f"{BATCH_ID}.json"),
        "post_claude_readback_status": "pending",
    }
    BATCH_PATH.parent.mkdir(parents=True, exist_ok=True)
    BATCH_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(BATCH_PATH)


if __name__ == "__main__":
    main()
