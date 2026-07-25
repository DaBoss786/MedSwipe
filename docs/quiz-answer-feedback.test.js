// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./firebase-config.js', () => ({
  auth: { currentUser: { uid: 'quiz-user', isAnonymous: false } },
  db: {},
  doc: vi.fn((...parts) => parts.join('/')),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ stats: { xp: 16, level: 1 } })
  }),
  collection: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn()
}));

vi.mock('./analytics.js', () => ({
  logAnalyticsEvent: vi.fn()
}));

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

import { logAnalyticsEvent } from './analytics.js';
import { getDoc } from './firebase-config.js';
import {
  recordAnswer,
  recordChoiceSelection,
  recordCmeAnswer,
  updateQuestionStats
} from './user.v2.js';
import { playMedium, playTap } from './haptics.js';
import { initializeQuiz } from './quiz.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createQuestion({
  text,
  correct = 'A',
  explanation = `${text} explanation`
}) {
  return {
    Question: text,
    'Correct Answer': correct,
    Explanation: explanation,
    Category: 'Testing',
    'Option A': 'Correct option',
    'Option B': 'Incorrect option',
    'Option C': 'Another option'
  };
}

function installQuizDom() {
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

  window.scrollTo = vi.fn();
  window.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  window.Swiper = class FakeSwiper {
    constructor(selector, options) {
      this.activeIndex = 0;
      this.previousIndex = 0;
      this.allowSlideNext = false;
      this.allowTouchMove = true;
      this.destroy = vi.fn();
      this.handlers = {};
      this.on = vi.fn((event, handler) => {
        this.handlers[event] = handler;
      });
      this.slideTo = vi.fn((index) => {
        this.previousIndex = this.activeIndex;
        this.activeIndex = index;
        this.handlers.slideChangeTransitionEnd?.call(this);
      });
      this.update = vi.fn(() => {
        this.slides = Array.from(document.querySelectorAll('#quizSlides .swiper-slide'));
      });
      this.slides = [];
      options.on.init.call(this);
    }
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('quiz answer feedback', () => {
  beforeEach(() => {
    installQuizDom();
    window.authState = { accessTier: 'free_guest', specialty: 'ENT' };
    recordAnswer.mockResolvedValue();
    recordCmeAnswer.mockResolvedValue();
    updateQuestionStats.mockResolvedValue();
    recordChoiceSelection.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.documentElement.style.overflow = '';
    document.body.innerHTML = '';
    delete window.Swiper;
    delete window.mySwiper;
    delete window.summaryData;
    delete window.onboardingSummaryData;
    delete window.authState;
    delete window.isOnboardingQuiz;
  });

  it('commits correct styling, tap haptic, explanation, and summary before remote work settles', async () => {
    const peer = deferred();
    const answerWrite = deferred();
    const statsWrite = deferred();
    recordChoiceSelection.mockReturnValue(peer.promise);
    recordAnswer.mockReturnValue(answerWrite.promise);
    updateQuestionStats.mockReturnValue(statsWrite.promise);

    await initializeQuiz([createQuestion({ text: 'Immediate correct feedback' })], 'regular', {
      bookmarks: [],
      sessionStartXP: 10
    });

    const selected = document.querySelector('.option-btn[data-option="A"]');
    const neutral = document.querySelector('.option-btn[data-option="B"]');
    selected.click();

    expect(selected.classList.contains('correct')).toBe(true);
    expect(selected.classList.contains('incorrect')).toBe(false);
    expect(Array.from(document.querySelectorAll('.option-btn')).every((option) => option.disabled)).toBe(true);
    expect(document.querySelector('.answer-card .answer').textContent).toContain(
      'Immediate correct feedback explanation'
    );
    expect(document.getElementById('viewSummaryBtn').textContent).toBe('View Quiz Summary');
    expect(window.mySwiper.allowSlideNext).toBe(true);
    expect(playTap).toHaveBeenCalledTimes(1);
    expect(playMedium).not.toHaveBeenCalled();
    expect(recordChoiceSelection).not.toHaveBeenCalled();

    selected.click();
    await flushPromises();
    expect(recordChoiceSelection).toHaveBeenCalledTimes(1);
    expect(recordAnswer).toHaveBeenCalledTimes(1);
    expect(updateQuestionStats).toHaveBeenCalledTimes(1);

    peer.resolve({
      choiceA: 3,
      choiceB: 2,
      choiceC: 0,
      choiceD: 0,
      choiceE: 0,
      totalResponses: 5
    });
    answerWrite.resolve();
    statsWrite.resolve();
    await flushPromises();

    expect(selected.querySelector('.bar-correct').style.width).toBe('60%');
    expect(neutral.querySelector('.bar-neutral').style.width).toBe('40%');
    expect(selected.querySelector('.peer-percentage').textContent).toBe('60%');
    expect(document.querySelectorAll('.peer-stat-bar')).toHaveLength(3);
    expect(playMedium).toHaveBeenCalledTimes(1);
    const asyncEvent = logAnalyticsEvent.mock.calls.find(
      ([name]) => name === 'quiz_answer_async_result'
    );
    expect(asyncEvent[1]).toMatchObject({
      quiz_position: 1,
      is_last_question: true,
      peer_stats_outcome: 'rendered',
      persistence_outcome: 'completed'
    });
    expect(asyncEvent[1]).not.toHaveProperty('question_id');
    expect(asyncEvent[1]).not.toHaveProperty('selected_answer');
  });

  it('shows the selected incorrect choice in red and the correct choice in green without a medium haptic', async () => {
    recordChoiceSelection.mockResolvedValue({
      choiceA: 3,
      choiceB: 2,
      choiceC: 0,
      choiceD: 0,
      choiceE: 0,
      totalResponses: 5
    });
    await initializeQuiz([createQuestion({ text: 'Immediate incorrect feedback' })], 'regular', {
      bookmarks: [],
      sessionStartXP: 0
    });

    const correct = document.querySelector('.option-btn[data-option="A"]');
    const selected = document.querySelector('.option-btn[data-option="B"]');
    selected.click();

    expect(selected.classList.contains('incorrect')).toBe(true);
    expect(correct.classList.contains('correct')).toBe(true);
    expect(playTap).toHaveBeenCalledTimes(1);
    expect(playMedium).not.toHaveBeenCalled();
    expect(document.querySelector('.answer-card .answer').textContent).toContain(
      'Immediate incorrect feedback explanation'
    );
    expect(document.getElementById('viewSummaryBtn').textContent).toBe('View Quiz Summary');
    expect(document.body.textContent).not.toContain('Loading Summary');
    await flushPromises();
    expect(document.querySelectorAll('.peer-stat-bar')).toHaveLength(3);
    expect(playMedium).not.toHaveBeenCalled();
  });

  it('suppresses a late correct haptic after the user leaves the question slide', async () => {
    const peer = deferred();
    recordChoiceSelection.mockReturnValue(peer.promise);

    await initializeQuiz([createQuestion({ text: 'Late peer haptic' })], 'regular', {
      bookmarks: [],
      sessionStartXP: 0
    });

    const questionSlide = document.querySelector('.swiper-slide[data-id="Late peer haptic"]');
    const selected = questionSlide.querySelector('[data-option="A"]');
    selected.click();
    await flushPromises();

    window.mySwiper.slideTo(1);
    peer.resolve({
      choiceA: 1,
      choiceB: 0,
      choiceC: 0,
      choiceD: 0,
      choiceE: 0,
      totalResponses: 1
    });
    await flushPromises();

    expect(selected.querySelector('.peer-percentage').textContent).toBe('100%');
    expect(playMedium).not.toHaveBeenCalled();
  });

  it('keeps question identity stable when peer requests finish in reverse order', async () => {
    const peerByQuestion = new Map([
      ['First question', deferred()],
      ['Second question', deferred()]
    ]);
    recordChoiceSelection.mockImplementation((questionId) => peerByQuestion.get(questionId).promise);

    await initializeQuiz([
      createQuestion({ text: 'First question', explanation: 'First explanation' }),
      createQuestion({ text: 'Second question', explanation: 'Second explanation' })
    ], 'regular', {
      bookmarks: [],
      sessionStartXP: 0
    });

    const questionSlides = Array.from(document.querySelectorAll('.swiper-slide[data-id]'));
    questionSlides[0].querySelector('[data-option="A"]').click();
    questionSlides[1].querySelector('[data-option="B"]').click();
    await flushPromises();

    expect(questionSlides[0].nextElementSibling.textContent).toContain('First explanation');
    expect(questionSlides[1].nextElementSibling.textContent).toContain('Second explanation');
    expect(document.getElementById('questionProgress').textContent).toBe('2 / 2');
    expect(document.getElementById('scoreDisplay').textContent).toBe('Score: 1');

    peerByQuestion.get('Second question').resolve({
      choiceA: 8, choiceB: 2, choiceC: 0, choiceD: 0, choiceE: 0, totalResponses: 10
    });
    await flushPromises();
    peerByQuestion.get('First question').resolve({
      choiceA: 5, choiceB: 5, choiceC: 0, choiceD: 0, choiceE: 0, totalResponses: 10
    });
    await flushPromises();

    expect(questionSlides[0].querySelector('[data-option="A"] .peer-percentage').textContent).toBe('50%');
    expect(questionSlides[1].querySelector('[data-option="B"] .peer-percentage').textContent).toBe('20%');
    const answeredEvents = logAnalyticsEvent.mock.calls.filter(([name]) => name === 'question_answered');
    expect(answeredEvents.map(([, details]) => details.quiz_position)).toEqual([1, 2]);
  });

  it('keeps local feedback usable when peer statistics fail', async () => {
    recordChoiceSelection.mockRejectedValue(new Error('peer stats offline'));
    recordAnswer.mockRejectedValue(new Error('answer write offline'));
    updateQuestionStats.mockRejectedValue(new Error('stats write offline'));
    await initializeQuiz([createQuestion({ text: 'Peer failure question' })], 'regular', {
      bookmarks: [],
      sessionStartXP: 0
    });

    const selected = document.querySelector('.option-btn[data-option="A"]');
    selected.click();
    await flushPromises();

    expect(selected.classList.contains('correct')).toBe(true);
    expect(document.querySelector('.answer-card .answer').textContent).toContain(
      'Peer failure question explanation'
    );
    expect(window.mySwiper.allowSlideNext).toBe(true);
    expect(document.querySelectorAll('.peer-stat-bar')).toHaveLength(0);
    expect(playMedium).not.toHaveBeenCalled();
    expect(document.getElementById('viewSummaryBtn').disabled).toBe(false);
  });

  it('creates the onboarding Continue action immediately', async () => {
    window.isOnboardingQuiz = true;
    await initializeQuiz([createQuestion({ text: 'Onboarding final question' })], 'regular', {
      bookmarks: [],
      sessionStartXP: 0
    });

    document.querySelector('.option-btn[data-option="A"]').click();

    expect(document.getElementById('viewOnboardingSummaryBtn').textContent).toBe('Continue');
    expect(document.body.textContent).not.toContain('Loading Summary');
    expect(window.onboardingSummaryData).toMatchObject({
      accuracy: 100,
      score: 1,
      totalQuestions: 1
    });
  });

  it('keeps the summary usable while persistence is pending and patches XP afterward', async () => {
    const answerWrite = deferred();
    const statsWrite = deferred();
    recordAnswer.mockReturnValue(answerWrite.promise);
    updateQuestionStats.mockReturnValue(statsWrite.promise);
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ stats: { xp: 25, level: 2 } })
    });

    await initializeQuiz([createQuestion({ text: 'Summary refresh question' })], 'regular', {
      bookmarks: [],
      sessionStartXP: 10
    });
    document.querySelector('.option-btn[data-option="A"]').click();
    document.getElementById('viewSummaryBtn').click();

    expect(document.querySelector('.quiz-summary-card .xp-value').textContent).toBe('+3 XP');
    expect(document.querySelector('.quiz-summary-card .xp-total').textContent).toContain('Total: 13 XP');

    answerWrite.resolve();
    statsWrite.resolve();
    await flushPromises();

    expect(document.querySelector('.quiz-summary-card .xp-value').textContent).toBe('+15 XP');
    expect(document.querySelector('.quiz-summary-card .xp-total').textContent).toBe(
      'Total: 25 XP (Level 2)'
    );
  });

  it('ignores peer results from a replaced quiz run', async () => {
    const oldPeer = deferred();
    recordChoiceSelection.mockReturnValueOnce(oldPeer.promise).mockResolvedValue(null);

    await initializeQuiz([createQuestion({ text: 'Old quiz question' })], 'regular', {
      bookmarks: [],
      sessionStartXP: 0
    });
    const oldCard = document.querySelector('.swiper-slide[data-id="Old quiz question"] .card');
    oldCard.querySelector('[data-option="A"]').click();
    await flushPromises();

    await initializeQuiz([createQuestion({ text: 'New quiz question' })], 'regular', {
      bookmarks: [],
      sessionStartXP: 0
    });
    oldPeer.resolve({
      choiceA: 1, choiceB: 0, choiceC: 0, choiceD: 0, choiceE: 0, totalResponses: 1
    });
    await flushPromises();

    expect(oldCard.isConnected).toBe(false);
    expect(oldCard.querySelectorAll('.peer-stat-bar')).toHaveLength(0);
    expect(document.querySelectorAll('.peer-stat-bar')).toHaveLength(0);
  });
});
