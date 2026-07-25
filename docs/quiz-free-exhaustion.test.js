// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./firebase-config.js', () => ({
  auth: { currentUser: null },
  db: {},
  doc: vi.fn(),
  getDoc: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn()
}));

vi.mock('./analytics.js', () => ({
  logAnalyticsEvent: vi.fn()
}));

vi.mock('./user.v2.js', () => ({
  fetchPersistentAnsweredIds: vi.fn(),
  recordAnswer: vi.fn(),
  recordCmeAnswer: vi.fn(),
  updateQuestionStats: vi.fn(),
  getBookmarks: vi.fn(),
  updateSpacedRepetitionData: vi.fn(),
  recordChoiceSelection: vi.fn()
}));

vi.mock('./ui.js', () => ({
  showLeaderboard: vi.fn()
}));

vi.mock('./utils.js', () => ({
  shuffleArray: vi.fn((items) => items),
  getCurrentQuestionId: vi.fn()
}));

vi.mock('./haptics.js', () => ({
  playMedium: vi.fn(),
  playLight: vi.fn(),
  playTap: vi.fn()
}));

import { auth, getDoc, getDocs } from './firebase-config.js';
import { FREE_QUESTIONS_EXHAUSTED_MESSAGE } from './quiz-filtering.js';
import { loadQuestions } from './quiz.js';

describe('loadQuestions free-tier exhaustion', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="mainOptions" style="display:none"></div>';
    window.alert = vi.fn();
    auth.currentUser = { uid: 'free-user', isAnonymous: false };
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    delete window.authState;
    delete window.isOnboardingQuiz;
    delete window.alert;
    auth.currentUser = null;
  });

  it.each([
    { specialty: 'ENT', isAnonymous: false },
    { specialty: 'Neurosurgery', isAnonymous: false },
    { specialty: 'Urology', isAnonymous: true },
    { specialty: 'Anesthesiology', isAnonymous: false }
  ])(
    'shows the clear message for an exhausted $specialty free-tier prefiltered quiz',
    async ({ specialty, isAnonymous }) => {
      const specialtyKey = specialty.toLowerCase();
      const questions = [
        { Question: `${specialty} Q1`, Specialty: specialty, Free: true },
        { Question: `${specialty} Q2`, Specialty: specialty, Free: true }
      ];
      auth.currentUser = { uid: 'free-user', isAnonymous };
      window.authState = {
        accessTier: 'free_guest',
        specialty,
        specialtyPolicy: {
          specialtyKey,
          enabled: false
        }
      };
      getDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({
          answeredQuestions: Object.fromEntries(
            questions.map((question) => [question.Question, {}])
          ),
          bookmarks: [],
          stats: { xp: 0 }
        })
      });

      await loadQuestions({
        includeAnswered: false,
        prefilteredQuestions: questions,
        emptyStateContext: 'all_questions'
      });

      expect(getDoc).toHaveBeenCalledTimes(1);
      expect(window.alert).toHaveBeenCalledTimes(1);
      expect(window.alert).toHaveBeenCalledWith(FREE_QUESTIONS_EXHAUSTED_MESSAGE);
      expect(document.getElementById('mainOptions').style.display).toBe('flex');
    }
  );

  it('keeps the generic message when only a filtered result set is exhausted', async () => {
    const questions = [
      { Question: 'ENT filtered Q1', Specialty: 'ENT', Free: true }
    ];
    window.authState = {
      accessTier: 'free_guest',
      specialty: 'ENT',
      specialtyPolicy: {
        specialtyKey: 'ent',
        enabled: false
      }
    };
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        answeredQuestions: { 'ENT filtered Q1': {} },
        bookmarks: [],
        stats: { xp: 0 }
      })
    });

    await loadQuestions({
      includeAnswered: false,
      prefilteredQuestions: questions,
      emptyStateContext: 'filtered'
    });

    expect(window.alert).toHaveBeenCalledWith(
      'No questions found matching your criteria.'
    );
  });

  it('shows the clear message when a freshly fetched free bank is exhausted', async () => {
    const questions = [
      { Question: 'ENT fetched Q1', Specialty: 'ENT', Free: true },
      { Question: 'ENT fetched Q2', Specialty: 'ENT', Free: true }
    ];
    window.authState = {
      accessTier: 'free_guest',
      specialty: 'ENT',
      specialtyPolicy: {
        specialtyKey: 'ent',
        enabled: false
      }
    };
    getDocs.mockResolvedValue({
      docs: questions.map((question) => ({
        data: () => question
      }))
    });
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        answeredQuestions: Object.fromEntries(
          questions.map((question) => [question.Question, {}])
        ),
        bookmarks: [],
        stats: { xp: 0 }
      })
    });

    await loadQuestions({
      includeAnswered: false
    });

    expect(getDocs).toHaveBeenCalledTimes(1);
    expect(window.alert).toHaveBeenCalledWith(FREE_QUESTIONS_EXHAUSTED_MESSAGE);
  });
});
