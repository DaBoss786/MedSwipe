import { describe, it, expect } from 'vitest';
import {
  applyCategoryAndAnsweredFilters,
  getAvailableCategoriesForUser
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
