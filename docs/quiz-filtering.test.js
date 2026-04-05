import { describe, it, expect } from 'vitest';
import {
  applyCategoryAndAnsweredFilters,
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
