import { describe, it, expect } from 'vitest';
import { applyCategoryAndAnsweredFilters } from './quiz-filtering.js';

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
