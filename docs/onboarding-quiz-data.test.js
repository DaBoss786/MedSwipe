// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('./firebase-config.js', () => ({
  auth: { currentUser: { uid: 'onboarding-user', isAnonymous: true } },
  db: {},
  doc: vi.fn((...parts) => parts.join('/')),
  getDoc: vi.fn(),
  collection: vi.fn((...parts) => parts.join('/')),
  getDocs: vi.fn(),
  query: vi.fn((collectionRef, clause) => ({ collectionRef, clause })),
  where: vi.fn((field, operator, value) => ({ field, operator, value }))
}));

vi.mock('./analytics.js', () => ({ logAnalyticsEvent: vi.fn() }));
vi.mock('./user.v2.js', () => ({
  recordAnswer: vi.fn(),
  recordCmeAnswer: vi.fn(),
  updateQuestionStats: vi.fn(),
  updateSpacedRepetitionData: vi.fn(),
  recordChoiceSelection: vi.fn()
}));
vi.mock('./ui.js', () => ({ showLeaderboard: vi.fn() }));
vi.mock('./utils.js', () => ({
  shuffleArray: vi.fn((items) => items),
  getCurrentQuestionId: vi.fn()
}));
vi.mock('./haptics.js', () => ({
  playMedium: vi.fn(),
  playLight: vi.fn(),
  playTap: vi.fn()
}));

import { auth, getDoc, getDocs, where } from './firebase-config.js';
import {
  fetchOnboardingQuestionPool,
  fetchQuizUserContext
} from './quiz.js';

const docsDir = dirname(fileURLToPath(import.meta.url));
const quizSource = readFileSync(resolve(docsDir, 'quiz.js'), 'utf8');
const userSource = readFileSync(resolve(docsDir, 'user.v2.js'), 'utf8');
const authSource = readFileSync(resolve(docsDir, 'auth.js'), 'utf8');

const snapshot = (questions) => ({
  docs: questions.map((question) => ({ data: () => question }))
});

const question = (name, specialty, free = true) => ({
  Question: name,
  Specialty: specialty,
  Free: free
});

describe('onboarding quiz data path', () => {
  beforeEach(() => {
    window.authState = {
      accessTier: 'free_guest',
      specialty: 'ENT',
      specialtyPolicy: { specialtyKey: 'ent', enabled: false }
    };
    auth.currentUser = { uid: 'onboarding-user', isAnonymous: true };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete window.authState;
  });

  it('queries boolean Free questions and scopes shared questions for each supported specialty', async () => {
    const bank = [
      question('Shared 1', null),
      question('Shared 2', null),
      question('ENT 1', 'ENT'),
      question('Urology 1', 'Urology'),
      question('Anesthesiology 1', 'Anesthesiology')
    ];
    getDocs.mockResolvedValue(snapshot(bank));

    for (const specialty of ['ENT', 'Urology', 'Anesthesiology']) {
      const result = await fetchOnboardingQuestionPool(specialty, {
        forceRefresh: true
      });
      expect(result.questions).toHaveLength(3);
      expect(result.questions.every((item) =>
        !item.Specialty || item.Specialty === specialty
      )).toBe(true);
    }

    expect(where).toHaveBeenCalledWith('Free', '==', true);
  });

  it('reuses a five-minute specialty cache and resets a rejected entry', async () => {
    const bank = snapshot([
      question('Shared 1', null),
      question('Shared 2', null),
      question('Shared 3', null),
      question('ENT 1', 'ENT')
    ]);
    getDocs.mockResolvedValue(bank);

    await fetchOnboardingQuestionPool('ENT-cache-test', { forceRefresh: true });
    await fetchOnboardingQuestionPool('ENT-cache-test');
    expect(getDocs).toHaveBeenCalledTimes(1);

    getDocs.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(bank);
    await expect(
      fetchOnboardingQuestionPool('retry-cache-test', { forceRefresh: true })
    ).rejects.toMatchObject({ code: 'QUESTION_FETCH_FAILED' });
    await expect(fetchOnboardingQuestionPool('retry-cache-test')).resolves.toMatchObject({
      questions: expect.any(Array)
    });
  });

  it('falls back once to the full bank when fewer than three free questions are available', async () => {
    getDocs
      .mockResolvedValueOnce(snapshot([
        question('Shared 1', null),
        question('Urology 1', 'Urology')
      ]))
      .mockResolvedValueOnce(snapshot([
        question('Shared 1', null),
        question('Urology 1', 'Urology'),
        question('Urology premium 2', 'Urology', false)
      ]));

    window.authState.accessTier = 'board_review';
    const result = await fetchOnboardingQuestionPool('Urology', {
      forceRefresh: true
    });

    expect(result.source).toBe('network_full_fallback');
    expect(result.questions).toHaveLength(3);
    expect(getDocs).toHaveBeenCalledTimes(2);
  });

  it('returns answered IDs, bookmarks, and starting XP from one user read', async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        answeredQuestions: { 'Question A': {}, 'Question B': {} },
        bookmarks: ['Question B'],
        stats: { xp: 325 }
      })
    });

    await expect(fetchQuizUserContext()).resolves.toEqual({
      answeredIds: ['Question A', 'Question B'],
      bookmarks: ['Question B'],
      sessionStartXP: 325
    });
    expect(getDoc).toHaveBeenCalledTimes(1);
  });

  it('keeps the async and persistence contracts explicit in source', () => {
    expect(quizSource).toMatch(/return await initializeQuiz\(/);
    expect(quizSource).toContain('SWIPER_UNAVAILABLE');
    expect(quizSource).toMatch(/where\('Free', '==', true\)/);

    const saveFunction = userSource.slice(
      userSource.indexOf('async function saveOnboardingSelections'),
      userSource.indexOf('// Function to record which choice was selected')
    );
    expect(saveFunction).toContain('await setDoc(userDocRef, dataToSave, { merge: true })');
    expect(saveFunction).not.toContain('await getDoc(');
    expect(saveFunction.indexOf('await setDoc(')).toBeLessThan(
      saveFunction.indexOf('void (async () =>')
    );

    expect(authSource).toContain(
      'onboardingSelectionsComplete = Boolean(existingData.onboardingCompletedAt)'
    );
  });
});
