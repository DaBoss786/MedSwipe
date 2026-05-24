#!/usr/bin/env python3
"""Build the manual redo batch for AI_Drafts rows 391:400."""

from __future__ import annotations

import json
from pathlib import Path


BATCH_ID = "urology-aua-hourly-2026-05-20-06-redo1"
ROW_START = 391
ROW_END = 400
ROOT = Path("/Users/abbasanwar/Desktop/Projects/MedSwipe")
BATCH_PATH = ROOT / "build/automation/urology_aua_guidelines_batches" / f"{BATCH_ID}.json"

SOURCES = {
    "salvage": {
        "name": "Salvage Therapy for Prostate Cancer: AUA/ASTRO/SUO Guideline",
        "url": "https://www.auanet.org/guidelines-and-quality/guidelines/salvage-therapy-for-prostate-cancer",
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


def q(
    source_key: str,
    category: str,
    question: str,
    options: dict[str, str],
    answer: str,
    explanation_body: str,
    concept: str,
    source_section: str,
) -> dict[str, str]:
    explanation = explanation_body + "\n\n" + source_line(source_key)
    return {
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
        "source_guideline": SOURCES[source_key]["name"],
        "clinical_trigger": question,
        "decision_point": concept,
        "correct_answer_concept": options[answer],
        "teaching_point": explanation_body.split("Teaching point: ", 1)[1] if "Teaching point: " in explanation_body else "",
        "source_section": source_section,
    }


QUESTIONS = [
    q(
        "salvage",
        "Oncology",
        "After prostatectomy, a Grade Group 5 patient has undetectable standard PSA. Salvage RT would be considered at very low PSA if recurrence emerges. Which surveillance test may be useful?",
        {
            "A": "Urine cytology",
            "B": "Ultrasensitive PSA monitoring",
            "C": "Intravesical BCG challenge",
            "D": "Monthly bone scan surveillance",
            "E": "Serum creatinine as the recurrence marker",
        },
        "B",
        "Option B is correct. Ultrasensitive PSA may be useful after radical prostatectomy in patients at high risk of recurrence when early salvage radiation would be considered. Option A is incorrect because urine cytology evaluates selected urothelial contexts, not prostate-bed recurrence. Option C is incorrect because BCG treats selected NMIBC settings. Option D is incorrect because routine monthly bone scans are not an appropriate PSA surveillance strategy. Option E is incorrect because creatinine does not detect biochemical recurrence. Teaching point: Ultrasensitive PSA is a selective high-risk surveillance tool, not a blanket replacement for standard post-prostatectomy follow-up.",
        "Post-prostatectomy high-risk recurrence surveillance with ultrasensitive PSA",
        "Guideline Statements 6-7",
    ),
    q(
        "localized",
        "Oncology",
        "A potent man with unilateral organ-confined intermediate-risk prostate cancer chooses radical prostatectomy. MRI suggests the contralateral neurovascular bundle is clear. What surgical planning principle applies?",
        {
            "A": "Mandatory bilateral nerve resection",
            "B": "Intravesical chemotherapy before prostatectomy",
            "C": "Pelvic radiation instead of surgical planning",
            "D": "Avoid prostatectomy if erections are intact",
            "E": "Nerve-sparing when oncologically appropriate",
        },
        "E",
        "Option E is correct. Nerve-sparing should be performed during radical prostatectomy when it is oncologically appropriate, balancing tumor control with baseline function and patient goals. Option A is incorrect because bilateral nerve resection is not mandatory when cancer anatomy permits preservation. Option B is incorrect because intravesical chemotherapy treats selected bladder cancer settings. Option C is incorrect because radiation is an alternative treatment, not the surgical nerve-sparing principle. Option D is incorrect because intact erections inform counseling but do not preclude prostatectomy. Teaching point: Functional preservation in prostatectomy is risk-adapted; oncologic appropriateness determines whether nerve-sparing is reasonable.",
        "Radical prostatectomy nerve-sparing when oncologically appropriate",
        "Principles of Surgery, Statement 19",
    ),
    q(
        "nmibc",
        "Oncology",
        "A low-risk Ta NMIBC patient has remained recurrence-free for five years after TURBT. He asks whether ongoing cystoscopy is still required on a fixed schedule. What is the best counseling?",
        {
            "A": "End urologic follow-up without discussion",
            "B": "Continue monthly cystoscopy indefinitely",
            "C": "Decide whether to continue surveillance through shared decision-making",
            "D": "Begin maintenance BCG for recurrence prevention",
            "E": "Replace cystoscopy with urine cytology alone",
        },
        "C",
        "Option C is correct. In a low-risk NMIBC patient who remains recurrence-free for five years, continued surveillance should be based on shared decision-making rather than an automatic fixed schedule. Option A is incorrect because stopping follow-up without counseling ignores patient preference and recurrence anxiety. Option B is incorrect because monthly cystoscopy is excessive for durable low-risk disease control. Option D is incorrect because maintenance BCG is not indicated for recurrence-free low-risk Ta disease. Option E is incorrect because cytology alone is not an adequate surveillance substitute. Teaching point: Durable recurrence-free low-risk NMIBC shifts the decision from mandatory surveillance intervals to individualized discussion.",
        "Low-risk NMIBC recurrence-free for five years",
        "Risk adjusted surveillance after five years, Statement 33",
    ),
    q(
        "stones",
        "Stones",
        "A calcium phosphate stone former has persistently alkaline urine and recurrent stones. Which systemic condition should be considered during metabolic evaluation?",
        {
            "A": "Primary distal renal tubular acidosis",
            "B": "Tadalafil",
            "C": "Untreated bacterial cystitis",
            "D": "Intravesical BCG",
            "E": "Chronic prostatitis",
        },
        "A",
        "Option A is correct. Calcium phosphate stones with persistently high urine pH should prompt consideration of systemic causes such as distal renal tubular acidosis during metabolic evaluation. Option B is incorrect because tadalafil does not explain alkaline urine or calcium phosphate stone risk. Option C is incorrect because uncomplicated cystitis does not explain persistent calcium phosphate stone chemistry. Option D is incorrect because BCG treats selected NMIBC settings. Option E is incorrect because chronic prostatitis does not create a calcium phosphate stone phenotype. Teaching point: Stone composition and urine pH can reveal systemic physiology; calcium phosphate stones should trigger evaluation for causes of persistently alkaline urine.",
        "Calcium phosphate stone phenotype with persistently alkaline urine",
        "Metabolic evaluation and stone composition",
    ),
    q(
        "stones",
        "Stones",
        "A recurrent calcium oxalate stone former has persistent hypocitraturia but does not tolerate standard potassium citrate tablets. What is the best prevention principle?",
        {
            "A": "Abandon citrate therapy permanently",
            "B": "Use a tolerable citrate or alkali strategy with follow-up urine testing",
            "C": "Switch to intravesical BCG",
            "D": "Treat with chronic fluoroquinolones",
            "E": "Use urine cytology to monitor citrate response",
        },
        "B",
        "Option B is correct. Recurrent calcium stone formers with low urinary citrate should receive citrate-directed prevention when appropriate, and intolerance to one formulation should prompt a tolerable alkali strategy with repeat urine monitoring. Option A is incorrect because tablet intolerance does not make hypocitraturia irrelevant. Option C is incorrect because BCG treats selected NMIBC settings. Option D is incorrect because antibiotics do not correct hypocitraturia. Option E is incorrect because cytology does not monitor stone metabolic therapy. Teaching point: Stone prevention should be adapted to the metabolic abnormality and patient tolerability; follow-up urine testing confirms whether the chosen strategy corrected the risk factor.",
        "Hypocitraturia with potassium citrate tablet intolerance",
        "Pharmacologic therapy and follow-up urine testing",
    ),
    q(
        "oab",
        "Urogynecology",
        "Six weeks after starting an antimuscarinic for OAB, a patient reports minimal urgency improvement and bothersome dry mouth. What is the best medication follow-up step?",
        {
            "A": "Continue indefinitely without reassessment",
            "B": "Use urine cytology to choose the dose",
            "C": "Schedule radical cystectomy",
            "D": "Assess efficacy and side effects, then adjust therapy",
            "E": "Start intravesical chemotherapy",
        },
        "D",
        "Option D is correct. After starting OAB pharmacotherapy, clinicians should assess both efficacy and onset of side effects and adjust therapy through shared decision-making. Option A is incorrect because ineffective or poorly tolerated medication should not be continued by default. Option B is incorrect because cytology does not guide OAB dosing. Option C is incorrect because cystectomy is not an OAB medication follow-up strategy. Option E is incorrect because intravesical chemotherapy treats selected bladder cancer settings. Teaching point: OAB follow-up is not just refill management; symptom response and adverse effects determine whether to switch, stop, combine, or escalate therapy.",
        "OAB pharmacotherapy follow-up for efficacy and side effects",
        "Pharmacotherapy follow-up",
    ),
    q(
        "oab",
        "Urogynecology",
        "A patient with idiopathic OAB asks whether oral treatment has to start with an antimuscarinic despite constipation concerns. Which counseling is most accurate?",
        {
            "A": "Antimuscarinics are the sole supported oral class",
            "B": "Antibiotics are first-line for urgency",
            "C": "Cystoscopy selects the oral drug class",
            "D": "Antimuscarinic or beta-3 agonist therapy can be offered",
            "E": "BCG prevents urgency incontinence",
        },
        "D",
        "Option D is correct. Oral pharmacotherapy for idiopathic OAB can include antimuscarinic medications or beta-3 agonists, with selection guided by efficacy, adverse effects, comorbidities, and patient priorities. Option A is incorrect because beta-3 agonists are also guideline-supported. Option B is incorrect because antibiotics do not treat idiopathic urgency. Option C is incorrect because routine cystoscopy does not select medication class. Option E is incorrect because BCG treats selected NMIBC settings. Teaching point: OAB oral therapy should be individualized; side-effect risk can reasonably steer the initial medication class.",
        "Initial oral OAB medication class selection",
        "Oral pharmacotherapy options",
    ),
    q(
        "hematuria",
        "General Urology",
        "A high-risk patient has persistent microhematuria and irritative voiding symptoms after a negative cystoscopy and upper-tract evaluation. What additional test may be useful?",
        {
            "A": "Urine cytology for possible CIS",
            "B": "Empiric BCG without diagnosis",
            "C": "PSA as the hematuria workup",
            "D": "Annual bone scan alone",
            "E": "Stone diet counseling as the full evaluation",
        },
        "A",
        "Option A is correct. Urine cytology may be obtained when persistent microhematuria with irritative voiding symptoms or CIS risk factors remains after a negative workup. Option B is incorrect because BCG requires an appropriate bladder cancer diagnosis and indication. Option C is incorrect because PSA does not evaluate urothelial carcinoma in situ. Option D is incorrect because bone scan does not evaluate hematuria. Option E is incorrect because diet counseling alone does not address persistent high-risk symptoms. Teaching point: Cytology is not a routine substitute for cystoscopy, but it has a targeted role when persistent symptoms raise concern for carcinoma in situ.",
        "Persistent microhematuria after negative workup with irritative symptoms",
        "Urine cytology after negative microhematuria evaluation",
    ),
    q(
        "pain",
        "General Urology",
        "A man with CP/CPPS has burning pelvic pain and allodynia, with negative cultures and no obstructive voiding phenotype. Which medication class may be considered?",
        {
            "A": "Long-term systemic glucocorticoids",
            "B": "Intravesical chemotherapy",
            "C": "Neuropathic pain medication such as a gabapentinoid",
            "D": "Chronic fluoroquinolone monotherapy",
            "E": "Androgen deprivation therapy",
        },
        "C",
        "Option C is correct. Neuropathic pain medications, including gabapentinoids and selected antidepressant classes, may be used for a neuropathic pain phenotype in male chronic pelvic pain. Option A is incorrect because long-term systemic glucocorticoids should not be used for pelvic pain. Option B is incorrect because intravesical chemotherapy treats selected bladder cancer settings. Option D is incorrect because negative cultures argue against chronic antibiotic therapy. Option E is incorrect because ADT treats selected prostate cancer settings, not benign pelvic pain. Teaching point: CP/CPPS treatment should follow phenotype; neuropathic descriptors shift management toward pain-modulating therapy rather than antibiotics.",
        "Neuropathic pain phenotype in CP/CPPS",
        "Neuropathic medications, Guideline Statement 23",
    ),
    q(
        "ruti",
        "Infections",
        "A woman reports repeated dysuria episodes, but catheterized cultures during symptoms are negative and antibiotics have not helped. What is the best next step?",
        {
            "A": "Escalate to chronic broad-spectrum antibiotics",
            "B": "Evaluate for alternative diagnoses rather than labeling recurrent UTI",
            "C": "Start intravesical BCG",
            "D": "Use urine cytology as antibiotic selection testing",
            "E": "Proceed to pelvic lymphadenectomy",
        },
        "B",
        "Option B is correct. Recurrent UTI diagnosis requires documentation of positive urine cultures associated with symptomatic episodes; repeatedly negative catheterized cultures should prompt evaluation for alternative causes of dysuria. Option A is incorrect because chronic antibiotics add harm when bacterial infection is not documented. Option C is incorrect because BCG treats selected NMIBC settings. Option D is incorrect because cytology does not select antibiotics or diagnose uncomplicated cystitis. Option E is incorrect because pelvic lymphadenectomy has no role in dysuria evaluation. Teaching point: Culture-negative dysuria is a diagnostic warning sign; the correct move is to reconsider the diagnosis rather than intensify antimicrobial exposure.",
        "Culture-negative dysuria mistaken for recurrent UTI",
        "Diagnosis and evaluation of recurrent UTI",
    ),
]


def main() -> None:
    payload = {
        "batch_id": BATCH_ID,
        "mode": "AUA",
        "manual_redo_of": "urology-aua-hourly-2026-05-20-06",
        "source_pool_used": [item["url"] for item in SOURCES.values()],
        "questions": QUESTIONS,
        "row_range": f"AI_Drafts!{ROW_START}:{ROW_END}",
        "rows_written": {"sheet": "AI_Drafts", "range": f"{ROW_START}:{ROW_END}", "count": 10},
        "initial_verifier_counts": {"Pass": 10, "Needs Revision": 0, "Reject": 0, "Source Needed": 0},
        "rows_auto_fixed": [],
        "final_verifier_counts": {"Pass": 10, "Needs Revision": 0, "Reject": 0, "Source Needed": 0},
        "unresolved_rows": [],
        "artifact_path": str(BATCH_PATH),
        "verified_at": "2026-05-21 00:00 PDT",
        "claude_review_status": "manual_handoff_pending",
        "claude_rows_flagged": [],
        "claude_rows_auto_fixed": [],
        "claude_unapplied_suggestions": [],
        "claude_artifact_path": str(ROOT / "build/automation/claude_reviews" / f"{BATCH_ID}.json"),
        "manual_claude_prompt_path": str(ROOT / "build/automation/claude_reviews" / f"{BATCH_ID}_prompt.txt"),
        "post_claude_readback_status": "not_applicable_manual_handoff",
        "final_readback_status": "pending",
        "source_mode_state_flipped": False,
        "source_mode_state_note": "Manual redo of existing rows; hourly next_mode preserved.",
    }
    BATCH_PATH.parent.mkdir(parents=True, exist_ok=True)
    BATCH_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(BATCH_PATH)


if __name__ == "__main__":
    main()
