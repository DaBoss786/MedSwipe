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
  fetchQuizUserContext,
  initializeQuiz
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
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    delete window.authState;
    delete window.Swiper;
    delete window.mySwiper;
    delete window.requestAnimationFrame;
    document.body.innerHTML = '';
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

  it('reveals the quiz before Swiper measures it and confirms slides after layout updates', async () => {
    vi.useFakeTimers();
    window.scrollTo = vi.fn();
    window.requestAnimationFrame = (callback) => {
      callback();
      return 1;
    };
    document.body.innerHTML = `
      <div class="swiper" style="display: none"><div id="quizSlides"></div></div>
      <div id="progressBar"></div>
      <div id="questionProgress"></div>
      <div id="scoreDisplay"></div>
      <div id="bottomToolbar"></div>
      <div id="mainOptions"></div>
      <div id="performanceView"></div>
      <div id="iconBar"></div>
      <div id="aboutView"></div>
      <div id="faqView"></div>
      <button id="favoriteButton"></button>
      <div id="questionImageModal"></div>
      <img id="modalImage" />
      <button id="closeImageModal"></button>
    `;

    const constructorDisplays = [];
    const update = vi.fn(function updateSlides() {
      this.slides = Array.from(document.querySelectorAll('#quizSlides .swiper-slide'));
    });
    window.Swiper = class FakeSwiper {
      constructor(selector, options) {
        constructorDisplays.push(document.querySelector(selector).style.display);
        this.activeIndex = 0;
        this.previousIndex = 0;
        this.on = vi.fn();
        this.destroy = vi.fn();
        this.update = update;
        this.slides = [];
        options.on.init.call(this);
      }
    };

    const result = await initializeQuiz([{
      Question: 'Which monitor responds first?',
      'Correct Answer': 'A',
      Explanation: 'Capnography responds breath by breath.',
      Category: 'Monitoring',
      'Option A': 'Capnography',
      'Option B': 'Pulse oximetry'
    }], 'regular', {
      bookmarks: [],
      sessionStartXP: 0
    });

    expect(constructorDisplays).toEqual(['block']);
    expect(update).toHaveBeenCalledTimes(2);
    expect(window.mySwiper.slides).toHaveLength(2);
    expect(result).toMatchObject({
      status: 'ready',
      firstCardVisible: true,
      swiperReady: true
    });
  });

  it('keeps the async and persistence contracts explicit in source', () => {
    expect(quizSource).toMatch(/return await initializeQuiz\(/);
    expect(quizSource).toContain('SWIPER_UNAVAILABLE');
    expect(quizSource).toMatch(/where\('Free', '==', true\)/);

    const initializeFunction = quizSource.slice(
      quizSource.indexOf('async function initializeQuiz'),
      quizSource.indexOf('// Function to lock/unlock swiping')
    );
    expect(initializeFunction.indexOf('quizContainer.style.display = "block"')).toBeLessThan(
      initializeFunction.indexOf("new SwiperConstructor('.swiper'")
    );
    expect(initializeFunction).toContain('await waitForNextQuizPaint()');
    expect(initializeFunction.indexOf('await waitForNextQuizPaint()')).toBeLessThan(
      initializeFunction.indexOf('window.mySwiper.slides.length === 0')
    );
    expect(initializeFunction.match(/window\.mySwiper\.update\(\)/g)).toHaveLength(2);

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
