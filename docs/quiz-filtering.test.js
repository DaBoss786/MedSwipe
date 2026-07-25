import { describe, it, expect } from 'vitest';
import {
  applyCategoryAndAnsweredFilters,
  FREE_QUESTIONS_EXHAUSTED_MESSAGE,
  getEmptyQuestionMessage,
  getAvailableCategoriesForUser,
  getAvailableCasePrepProcedures
} from './quiz-filtering.js';

describe('applyCategoryAndAnsweredFilters', () => {
  it('filters by category and excludes answered IDs', () => {
    const questions = [
      { Question: ' Q1 ', Category: 'Cardiology ' },
      { Question: 'Q2', Category: 'Cardiology' },
      { Question: 'Q3', Category: 'Neurology' },
      { Question: 'Q4', Category: '' }
    ];

    const result = applyCategoryAndAnsweredFilters({
      questions,
      category: 'Cardiology',
      bookmarksOnly: false,
      includeAnswered: false,
      answeredIds: ['Q1']
    });

    expect(result).toEqual([questions[1]]);
  });

  it('keeps answered questions when repeats are enabled', () => {
    const questions = [
      { Question: 'Q1', Category: 'Otology' },
      { Question: 'Q2', Category: 'Otology' }
    ];

    const result = applyCategoryAndAnsweredFilters({
      questions,
      includeAnswered: true,
      answeredIds: ['Q1', 'Q2']
    });

    expect(result).toEqual(questions);
  });
});

describe('getEmptyQuestionMessage', () => {
  it.each(['ENT', 'Neurosurgery', 'Urology', 'Anesthesiology'])(
    'returns the clear exhaustion message for an unfiltered %s free-tier quiz',
    () => {
      expect(getEmptyQuestionMessage({
        isFreeTierLimited: true,
        includeAnswered: false,
        emptyStateContext: 'all_questions',
        answeredFilterApplied: true,
        accessibleQuestionCountBeforeAnsweredFilter: 12
      })).toBe(FREE_QUESTIONS_EXHAUSTED_MESSAGE);
    }
  );

  it('does not report exhaustion when the accessible free bank was already empty', () => {
    expect(getEmptyQuestionMessage({
      isFreeTierLimited: true,
      emptyStateContext: 'all_questions',
      answeredFilterApplied: true,
      accessibleQuestionCountBeforeAnsweredFilter: 0
    })).toBe('No questions found matching your criteria.');
  });

  it('does not report exhaustion for a filtered quiz', () => {
    expect(getEmptyQuestionMessage({
      isFreeTierLimited: true,
      emptyStateContext: 'filtered',
      answeredFilterApplied: true,
      accessibleQuestionCountBeforeAnsweredFilter: 4
    })).toBe('No questions found matching your criteria.');
  });

  it('does not report exhaustion when answered questions are included', () => {
    expect(getEmptyQuestionMessage({
      isFreeTierLimited: true,
      includeAnswered: true,
      emptyStateContext: 'all_questions',
      answeredFilterApplied: true,
      accessibleQuestionCountBeforeAnsweredFilter: 4
    })).toBe('No questions found matching your criteria.');
  });

  it('does not report free-tier exhaustion for premium users', () => {
    expect(getEmptyQuestionMessage({
      isFreeTierLimited: false,
      emptyStateContext: 'all_questions',
      answeredFilterApplied: true,
      accessibleQuestionCountBeforeAnsweredFilter: 4
    })).toBe('No questions found matching your criteria.');
  });

  it('preserves the CME-specific empty message', () => {
    expect(getEmptyQuestionMessage({
      quizType: 'cme',
      isFreeTierLimited: true,
      emptyStateContext: 'all_questions',
      answeredFilterApplied: true,
      accessibleQuestionCountBeforeAnsweredFilter: 4
    })).toBe('No CME-eligible questions found for your selection. Please adjust your filters.');
  });
});

describe('getAvailableCategoriesForUser', () => {
  it('returns only ENT and shared categories for an ENT user', () => {
    const questions = [
      { Question: 'Q1', Category: 'Otology', Specialty: 'ENT' },
      { Question: 'Q2', Category: 'Rhinology', Specialty: 'ENT' },
      { Question: 'Q3', Category: 'Skull Base', Specialty: 'Neurosurgery' },
      { Question: 'Q4', Category: 'Core Concepts' }
    ];

    const result = getAvailableCategoriesForUser({
      questions,
      authState: { specialty: 'ENT', accessTier: 'board_review' }
    });

    expect(result.map((entry) => entry.category)).toEqual([
      'Core Concepts',
      'Otology',
      'Rhinology'
    ]);
  });

  it('returns only neurosurgery and shared categories for a neurosurgery user', () => {
    const questions = [
      { Question: 'Q1', Category: 'Otology', Specialty: 'ENT', pilotNeurosurgery: true },
      { Question: 'Q2', Category: 'Tumor', Specialty: 'Neurosurgery', pilotNeurosurgery: true },
      { Question: 'Q3', Category: 'Vascular', Specialty: 'Neurosurgery', pilotNeurosurgery: true },
      { Question: 'Q4', Category: 'Core Concepts', pilotNeurosurgery: true }
    ];

    const result = getAvailableCategoriesForUser({
      questions,
      authState: { specialty: 'Neurosurgery', accessTier: 'board_review' }
    });

    expect(result.map((entry) => entry.category)).toEqual([
      'Core Concepts',
      'Tumor',
      'Vascular'
    ]);
  });

  it('returns all specialty-scoped Urology categories for paid users', () => {
    const questions = [
      { Question: 'Q1', Category: 'Stones', Specialty: 'Urology', Free: true },
      { Question: 'Q2', Category: 'Oncology', Specialty: 'Urology', Free: false },
      { Question: 'Q3', Category: 'Skull Base', Specialty: 'Neurosurgery', Free: false },
      { Question: 'Q4', Category: 'Core Concepts', Free: false }
    ];

    const result = getAvailableCategoriesForUser({
      questions,
      authState: { specialty: 'Urology', accessTier: 'board_review' }
    });

    expect(result.map((entry) => entry.category)).toEqual([
      'Core Concepts',
      'Oncology',
      'Stones'
    ]);
  });

  it('treats free Urology users like the default paid-product path, not the neurosurgery pilot', () => {
    const questions = [
      { Question: 'Q1', Category: 'Free Urology', Specialty: 'Urology', Free: true },
      { Question: 'Q2', Category: 'Premium Urology', Specialty: 'Urology', Free: false, pilotUrology: true },
      { Question: 'Q3', Category: 'Shared Premium', Free: false, pilotUrology: true },
      { Question: 'Q4', Category: 'ENT Free', Specialty: 'ENT', Free: true }
    ];

    const result = getAvailableCategoriesForUser({
      questions,
      authState: { specialty: 'Urology', accessTier: 'free_guest' }
    });

    expect(result.map((entry) => entry.category)).toEqual(['Free Urology']);
  });

  it('returns all specialty-scoped Anesthesiology categories for paid users', () => {
    const questions = [
      { Question: 'Q1', Category: 'Pharmacology', Specialty: 'Anesthesiology', Free: true },
      { Question: 'Q2', Category: 'Airway', Specialty: 'Anesthesiology', Free: false },
      { Question: 'Q3', Category: 'Stones', Specialty: 'Urology', Free: false },
      { Question: 'Q4', Category: 'Core Concepts', Free: false }
    ];

    const result = getAvailableCategoriesForUser({
      questions,
      authState: { specialty: 'Anesthesiology', accessTier: 'board_review' }
    });

    expect(result.map((entry) => entry.category)).toEqual([
      'Airway',
      'Core Concepts',
      'Pharmacology'
    ]);
  });

  it('treats free Anesthesiology users like the default paid-product path, not a pilot', () => {
    const questions = [
      { Question: 'Q1', Category: 'Free Anesthesia', Specialty: 'Anesthesiology', Free: true },
      { Question: 'Q2', Category: 'Premium Anesthesia', Specialty: 'Anesthesiology', Free: false, pilotNeurosurgery: true },
      { Question: 'Q3', Category: 'Shared Premium', Free: false, pilotNeurosurgery: true },
      { Question: 'Q4', Category: 'ENT Free', Specialty: 'ENT', Free: true }
    ];

    const result = getAvailableCategoriesForUser({
      questions,
      authState: { specialty: 'Anesthesiology', accessTier: 'free_guest' }
    });

    expect(result.map((entry) => entry.category)).toEqual(['Free Anesthesia']);
  });

  it('excludes categories that only have inaccessible questions', () => {
    const questions = [
      { Question: 'Q1', Category: 'Free ENT', Specialty: 'ENT', Free: true },
      { Question: 'Q2', Category: 'Premium ENT', Specialty: 'ENT', Free: false },
      { Question: 'Q3', Category: 'Shared Premium', Free: false }
    ];

    const result = getAvailableCategoriesForUser({
      questions,
      authState: { specialty: 'ENT', accessTier: 'free_guest' }
    });

    expect(result.map((entry) => entry.category)).toEqual(['Free ENT']);
  });

  it('limits CME categories to specialty-accessible CME questions', () => {
    const questions = [
      { Question: 'Q1', Category: 'Otology', Specialty: 'ENT', 'CME Eligible': 'yes' },
      { Question: 'Q2', Category: 'Trauma', Specialty: 'ENT', 'CME Eligible': false },
      { Question: 'Q3', Category: 'Tumor', Specialty: 'Neurosurgery', 'CME Eligible': true },
      { Question: 'Q4', Category: 'Shared CME', 'CME Eligible': true }
    ];

    const result = getAvailableCategoriesForUser({
      questions,
      authState: { specialty: 'ENT', accessTier: 'board_review' },
      cmeOnly: true
    });

    expect(result.map((entry) => entry.category)).toEqual([
      'Otology',
      'Shared CME'
    ]);
  });

  it('omits blank categories and computes counts from the scoped question set', () => {
    const questions = [
      { Question: 'Q1', Category: 'Otology', Specialty: 'ENT' },
      { Question: 'Q2', Category: 'Otology', Specialty: 'ENT' },
      { Question: 'Q3', Category: 'Otology', Specialty: 'Neurosurgery' },
      { Question: 'Q4', Category: ' ', Specialty: 'ENT' },
      { Question: 'Q5', Specialty: 'ENT' }
    ];

    const result = getAvailableCategoriesForUser({
      questions,
      authState: { specialty: 'ENT', accessTier: 'board_review' },
      includeCounts: true,
      answeredQuestionIds: ['Q1', 'Q3']
    });

    expect(result).toEqual([
      {
        category: 'Otology',
        totalCount: 2,
        answeredCount: 1
      }
    ]);
  });
});

describe('getAvailableCasePrepProcedures', () => {
  it('returns specialty-scoped and shared procedures for ENT users', () => {
    const questions = [
      { Question: 'Q1', Procedures: 'Thyroidectomy', Specialty: 'ENT' },
      { Question: 'Q2', Procedures: 'Parotidectomy', Specialty: 'ENT' },
      { Question: 'Q3', Procedures: 'Craniotomy', Specialty: 'Neurosurgery' },
      { Question: 'Q4', Procedures: 'Core Skills' }
    ];

    const result = getAvailableCasePrepProcedures({
      questions,
      authState: { specialty: 'ENT', accessTier: 'board_review' }
    });

    expect(result).toEqual([
      { name: 'Core Skills', enabled: true, lockedReason: null },
      { name: 'Parotidectomy', enabled: true, lockedReason: null },
      { name: 'Thyroidectomy', enabled: true, lockedReason: null }
    ]);
  });

  it('returns specialty-scoped and shared procedures for neurosurgery users', () => {
    const questions = [
      { Question: 'Q1', Procedures: 'Thyroidectomy', Specialty: 'ENT', pilotNeurosurgery: true },
      { Question: 'Q2', Procedures: 'Craniotomy', Specialty: 'Neurosurgery', pilotNeurosurgery: true },
      { Question: 'Q3', Procedures: 'Aneurysm Clipping', Specialty: 'Neurosurgery', pilotNeurosurgery: true },
      { Question: 'Q4', Procedures: 'Core Skills', pilotNeurosurgery: true }
    ];

    const result = getAvailableCasePrepProcedures({
      questions,
      authState: { specialty: 'Neurosurgery', accessTier: 'board_review' }
    });

    expect(result).toEqual([
      { name: 'Aneurysm Clipping', enabled: true, lockedReason: null },
      { name: 'Core Skills', enabled: true, lockedReason: null },
      { name: 'Craniotomy', enabled: true, lockedReason: null }
    ]);
  });

  it('returns specialty-scoped and shared procedures for paid Urology users', () => {
    const questions = [
      { Question: 'Q1', Procedures: 'Ureteroscopy', Specialty: 'Urology', Free: false },
      { Question: 'Q2', Procedures: 'Robotic Prostatectomy', Specialty: 'Urology', Free: false },
      { Question: 'Q3', Procedures: 'Craniotomy', Specialty: 'Neurosurgery', Free: false },
      { Question: 'Q4', Procedures: 'Core Skills', Free: false }
    ];

    const result = getAvailableCasePrepProcedures({
      questions,
      authState: { specialty: 'Urology', accessTier: 'board_review' }
    });

    expect(result).toEqual([
      { name: 'Core Skills', enabled: true, lockedReason: null },
      { name: 'Robotic Prostatectomy', enabled: true, lockedReason: null },
      { name: 'Ureteroscopy', enabled: true, lockedReason: null }
    ]);
  });

  it('shows premium-only procedures as disabled for free users', () => {
    const questions = [
      { Question: 'Q1', Procedures: 'Thyroidectomy', Specialty: 'ENT', Free: true },
      { Question: 'Q2', Procedures: 'Parotidectomy', Specialty: 'ENT', Free: false },
      { Question: 'Q3', Procedures: 'Shared Premium', Free: false }
    ];

    const result = getAvailableCasePrepProcedures({
      questions,
      authState: { specialty: 'ENT', accessTier: 'free_guest' }
    });

    expect(result).toEqual([
      { name: 'Thyroidectomy', enabled: true, lockedReason: null },
      { name: 'Parotidectomy', enabled: false, lockedReason: 'Subscription Required' },
      { name: 'Shared Premium', enabled: false, lockedReason: 'Subscription Required' }
    ]);
  });

  it('enables a mixed-access procedure if at least one question is accessible', () => {
    const questions = [
      { Question: 'Q1', Procedures: 'Thyroidectomy', Specialty: 'ENT', Free: false },
      { Question: 'Q2', Procedures: 'Thyroidectomy', Specialty: 'ENT', Free: true },
      { Question: 'Q3', Procedures: 'Parotidectomy', Specialty: 'ENT', Free: false }
    ];

    const result = getAvailableCasePrepProcedures({
      questions,
      authState: { specialty: 'ENT', accessTier: 'free_guest' }
    });

    expect(result).toEqual([
      { name: 'Thyroidectomy', enabled: true, lockedReason: null },
      { name: 'Parotidectomy', enabled: false, lockedReason: 'Subscription Required' }
    ]);
  });

  it('sorts enabled procedures ahead of locked ones', () => {
    const questions = [
      { Question: 'Q1', Procedures: 'Zeta Procedure', Specialty: 'ENT', Free: false },
      { Question: 'Q2', Procedures: 'Alpha Procedure', Specialty: 'ENT', Free: true },
      { Question: 'Q3', Procedures: 'Beta Procedure', Specialty: 'ENT', Free: false }
    ];

    const result = getAvailableCasePrepProcedures({
      questions,
      authState: { specialty: 'ENT', accessTier: 'free_guest' }
    });

    expect(result).toEqual([
      { name: 'Alpha Procedure', enabled: true, lockedReason: null },
      { name: 'Beta Procedure', enabled: false, lockedReason: 'Subscription Required' },
      { name: 'Zeta Procedure', enabled: false, lockedReason: 'Subscription Required' }
    ]);
  });

  it('omits blank procedures and dedupes repeated labels', () => {
    const questions = [
      { Question: 'Q1', Procedures: 'Thyroidectomy', Specialty: 'ENT' },
      { Question: 'Q2', Procedures: 'Thyroidectomy ', Specialty: 'ENT' },
      { Question: 'Q3', Procedures: ' ', Specialty: 'ENT' },
      { Question: 'Q4', Specialty: 'ENT' }
    ];

    const result = getAvailableCasePrepProcedures({
      questions,
      authState: { specialty: 'ENT', accessTier: 'board_review' }
    });

    expect(result).toEqual([
      { name: 'Thyroidectomy', enabled: true, lockedReason: null }
    ]);
  });
});
