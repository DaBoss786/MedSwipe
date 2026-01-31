import { describe, it, expect } from 'vitest';
import { getAnsweredQuestionIds, recordAnsweredQuestion } from './answered-questions.js';

describe('recordAnsweredQuestion', () => {
  it('records answered questions, ignores duplicates, and keeps ids stable', () => {
    const entryA = {
      isCorrect: true,
      category: 'Cardiology',
      timestamp: 1700000000000,
      timestampFormatted: '2023-11-14 00:00:00',
      timeSpent: 12
    };
    const entryB = {
      isCorrect: false,
      category: 'Neurology',
      timestamp: 1700000005000,
      timestampFormatted: '2023-11-14 00:00:05',
      timeSpent: 8
    };
    const entryDuplicate = {
      isCorrect: false,
      category: 'Cardiology',
      timestamp: 1700000010000,
      timestampFormatted: '2023-11-14 00:00:10',
      timeSpent: 99
    };

    const first = recordAnsweredQuestion({}, 'Q1', entryA);
    expect(first.added).toBe(true);
    expect(first.answeredQuestions).toEqual({ Q1: entryA });
    expect(getAnsweredQuestionIds(first.answeredQuestions)).toEqual(['Q1']);

    const duplicate = recordAnsweredQuestion(first.answeredQuestions, 'Q1', entryDuplicate);
    expect(duplicate.added).toBe(false);
    expect(duplicate.answeredQuestions).toEqual({ Q1: entryA });
    expect(getAnsweredQuestionIds(duplicate.answeredQuestions)).toEqual(['Q1']);

    const second = recordAnsweredQuestion(duplicate.answeredQuestions, 'Q2', entryB);
    expect(second.added).toBe(true);
    expect(second.answeredQuestions).toEqual({ Q1: entryA, Q2: entryB });
    expect(getAnsweredQuestionIds(second.answeredQuestions)).toEqual(['Q1', 'Q2']);

    const duplicateAgain = recordAnsweredQuestion(second.answeredQuestions, 'Q1', entryDuplicate);
    expect(duplicateAgain.added).toBe(false);
    expect(getAnsweredQuestionIds(duplicateAgain.answeredQuestions)).toEqual(['Q1', 'Q2']);
  });
});
