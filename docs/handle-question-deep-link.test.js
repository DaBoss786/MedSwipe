// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./firebase-config.js', () => ({
  app: {},
  auth: { currentUser: null },
  db: {},
  doc: vi.fn(),
  getDoc: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
  getIdToken: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  functions: {},
  httpsCallable: vi.fn(() => vi.fn()),
  updateDoc: vi.fn(),
  addDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onAuthStateChanged: vi.fn(() => () => {}),
  setDoc: vi.fn()
}));

vi.mock('./analytics.js', () => ({
  logAnalyticsEvent: vi.fn(),
  setAnalyticsUserProperties: vi.fn()
}));

vi.mock('./auth.js', () => ({
  generateGuestUsername: vi.fn(() => 'guest-user')
}));

vi.mock('./user.v2.js', () => ({
  updateUserXP: vi.fn(),
  updateUserMenu: vi.fn(),
  calculateLevelProgress: vi.fn(),
  getLevelInfo: vi.fn(),
  toggleBookmark: vi.fn(),
  saveOnboardingSelections: vi.fn(),
  fetchPersistentAnsweredIds: vi.fn()
}));

vi.mock('./quiz.js', () => ({
  loadQuestions: vi.fn(),
  initializeQuiz: vi.fn(),
  fetchQuestionBank: vi.fn()
}));

vi.mock('./ui.js', () => ({
  showLeaderboard: vi.fn(),
  showAbout: vi.fn(),
  showFAQ: vi.fn(),
  showContactModal: vi.fn()
}));

vi.mock('./utils.js', () => ({
  closeSideMenu: vi.fn(),
  closeUserMenu: vi.fn(),
  shuffleArray: vi.fn((items) => items),
  getCurrentQuestionId: vi.fn()
}));

vi.mock('./stats.js', () => ({
  displayPerformance: vi.fn()
}));

vi.mock('./billing-service.js', () => ({
  initialize: vi.fn(),
  startBoardReviewCheckout: vi.fn(),
  startCmeCheckout: vi.fn(),
  restorePurchases: vi.fn()
}));

vi.mock('./haptics.js', () => ({
  playTap: vi.fn(),
  playLight: vi.fn()
}));

vi.mock('./platform.js', () => ({
  detectNativeApp: vi.fn(() => false)
}));

const setupDom = () => {
  document.body.innerHTML = `
    <div id="mainOptions" style="display:none"></div>
    <div id="welcomeScreen" style="display:none"></div>
    <div id="loginScreen" style="display:none"></div>
    <div id="splashScreen" style="display:none"></div>
    <div id="boardReviewPricingScreen" style="display:none"></div>
    <div id="cmePricingScreen" style="display:none"></div>
  `;
};

const makeSnapshot = (questionData) => ({
  empty: false,
  docs: [{ data: () => questionData }]
});

let handleQuestionDeepLink;
let __setDeepLinkRoutingHandlers;
let __resetDeepLinkRoutingHandlers;
let firebase;
let quiz;

beforeEach(async () => {
  window.alert = vi.fn();
  sessionStorage.clear();
  setupDom();
  globalThis.userHasBoardReviewAccess = vi.fn(() => false);

  firebase = await import('./firebase-config.js');
  quiz = await import('./quiz.js');
  const appModule = await import('./app.js');
  handleQuestionDeepLink = appModule.handleQuestionDeepLink;
  __setDeepLinkRoutingHandlers = appModule.__setDeepLinkRoutingHandlers;
  __resetDeepLinkRoutingHandlers = appModule.__resetDeepLinkRoutingHandlers;
});

afterEach(() => {
  if (typeof __resetDeepLinkRoutingHandlers === 'function') {
    __resetDeepLinkRoutingHandlers();
  }
  vi.clearAllMocks();
  vi.resetModules();
  document.body.innerHTML = '';
  delete window.authState;
  delete window.pendingDeepLinkQuestionId;
  delete window.isDeepLinkQuizActive;
  delete window.coldStartDeepLinkPending;
  delete globalThis.userHasBoardReviewAccess;
});

describe('handleQuestionDeepLink', () => {
  it('returns false for non-matching URLs', async () => {
    const result = await handleQuestionDeepLink('/not-a-question/123');

    expect(result).toBe(false);
    expect(firebase.getDocs).not.toHaveBeenCalled();
    expect(firebase.onAuthStateChanged).not.toHaveBeenCalled();
  });

  it('parses hash-based deep links and initializes the quiz', async () => {
    firebase.auth.currentUser = { uid: 'user-1' };
    const questionData = { Question: 'hash-123', Free: true };
    firebase.getDocs.mockResolvedValue(makeSnapshot(questionData));

    const result = await handleQuestionDeepLink('https://medswipeapp.com/#/question/hash-123');

    expect(result).toBe(true);
    expect(firebase.onAuthStateChanged).not.toHaveBeenCalled();
    expect(window.pendingDeepLinkQuestionId).toBe('hash-123');
    expect(window.isDeepLinkQuizActive).toBe(true);
    expect(quiz.initializeQuiz).toHaveBeenCalledTimes(1);
    expect(quiz.initializeQuiz).toHaveBeenCalledWith([questionData], 'deep_link');
  });

  it('parses path-based deep links and initializes the quiz', async () => {
    firebase.auth.currentUser = { uid: 'user-2' };
    const questionData = { Question: 'path-456', Free: true };
    firebase.getDocs.mockResolvedValue(makeSnapshot(questionData));

    const result = await handleQuestionDeepLink('/question/path-456');

    expect(result).toBe(true);
    expect(window.pendingDeepLinkQuestionId).toBe('path-456');
    expect(quiz.initializeQuiz).toHaveBeenCalledTimes(1);
    expect(quiz.initializeQuiz).toHaveBeenCalledWith([questionData], 'deep_link');
  });

  it('waits for onAuthStateChanged when auth.currentUser is not ready', async () => {
    firebase.auth.currentUser = null;
    const questionData = { Question: 'auth-wait', Free: true };
    firebase.getDocs.mockResolvedValue(makeSnapshot(questionData));

    let authCallback;
    const unsubscribe = vi.fn();
    firebase.onAuthStateChanged.mockImplementation((_auth, callback) => {
      authCallback = callback;
      return unsubscribe;
    });

    const pending = handleQuestionDeepLink('/question/auth-wait');

    expect(firebase.onAuthStateChanged).toHaveBeenCalledTimes(1);
    expect(firebase.getDocs).not.toHaveBeenCalled();

    authCallback({ uid: 'user-3' });
    await pending;

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(firebase.getDocs).toHaveBeenCalledTimes(1);
  });

  it('allows free questions for any user', async () => {
    firebase.auth.currentUser = { uid: 'user-free' };
    window.authState = { isLoading: false, accessTier: 'free_guest' };
    const questionData = { Question: 'free-1', Free: true };
    firebase.getDocs.mockResolvedValue(makeSnapshot(questionData));

    const result = await handleQuestionDeepLink('/question/free-1');

    expect(result).toBe(true);
    expect(window.alert).not.toHaveBeenCalled();
    expect(quiz.initializeQuiz).toHaveBeenCalledWith([questionData], 'deep_link');
  });

  it('blocks board review questions without board access', async () => {
    firebase.auth.currentUser = { uid: 'user-free' };
    window.authState = { isLoading: false, accessTier: 'free_guest' };
    const questionData = { Question: 'br-1', 'Board Review': true };
    firebase.getDocs.mockResolvedValue(makeSnapshot(questionData));

    const result = await handleQuestionDeepLink('/question/br-1');

    expect(result).toBe(true);
    expect(window.alert).toHaveBeenCalledTimes(1);
    expect(window.alert).toHaveBeenCalledWith(
      'This question requires active Board Review access.'
    );
    expect(quiz.initializeQuiz).not.toHaveBeenCalled();
    expect(window.pendingDeepLinkQuestionId).toBeNull();
  });

  it('allows board review questions when board access is active', async () => {
    firebase.auth.currentUser = { uid: 'user-board' };
    window.authState = { isLoading: false, accessTier: 'board_review' };
    globalThis.userHasBoardReviewAccess.mockReturnValue(true);
    const questionData = { Question: 'br-2', 'Board Review': true };
    firebase.getDocs.mockResolvedValue(makeSnapshot(questionData));

    const result = await handleQuestionDeepLink('/question/br-2');

    expect(result).toBe(true);
    expect(window.alert).not.toHaveBeenCalled();
    expect(quiz.initializeQuiz).toHaveBeenCalledWith([questionData], 'deep_link');
  });

  it('blocks premium questions without premium access', async () => {
    firebase.auth.currentUser = { uid: 'user-free' };
    window.authState = { isLoading: false, accessTier: 'free_guest' };
    const questionData = { Question: 'premium-1', Free: false, BoardReview: false };
    firebase.getDocs.mockResolvedValue(makeSnapshot(questionData));

    const result = await handleQuestionDeepLink('/question/premium-1');

    expect(result).toBe(true);
    expect(window.alert).toHaveBeenCalledTimes(1);
    expect(window.alert).toHaveBeenCalledWith(
      'This question requires a premium subscription.'
    );
    expect(quiz.initializeQuiz).not.toHaveBeenCalled();
  });

  it('allows premium questions when premium access is active', async () => {
    firebase.auth.currentUser = { uid: 'user-premium' };
    window.authState = { isLoading: false, accessTier: 'cme_annual' };
    const questionData = { Question: 'premium-2', Free: false };
    firebase.getDocs.mockResolvedValue(makeSnapshot(questionData));

    const result = await handleQuestionDeepLink('/question/premium-2');

    expect(result).toBe(true);
    expect(window.alert).not.toHaveBeenCalled();
    expect(quiz.initializeQuiz).toHaveBeenCalledWith([questionData], 'deep_link');
  });

  it('alerts and clears state when the question cannot be found', async () => {
    firebase.auth.currentUser = { uid: 'user-4' };
    window.authState = { isRegistered: true, accessTier: 'board_review' };

    const handleUserRouting = vi.fn();
    const queueDashboardRefresh = vi.fn();
    __setDeepLinkRoutingHandlers({ handleUserRouting, queueDashboardRefresh });

    if (typeof window.setPendingDeepLink === 'function') {
      window.setPendingDeepLink('stale-question');
    }

    firebase.getDocs.mockResolvedValue({ empty: true, docs: [] });

    const result = await handleQuestionDeepLink('/question/missing-question');

    expect(result).toBe(true);
    expect(window.alert).toHaveBeenCalledTimes(1);
    expect(window.pendingDeepLinkQuestionId).toBeNull();
    expect(window.isDeepLinkQuizActive).toBe(false);
    expect(handleUserRouting).toHaveBeenCalledTimes(1);
    expect(handleUserRouting).toHaveBeenCalledWith(window.authState);
    expect(queueDashboardRefresh).toHaveBeenCalledTimes(1);
    expect(document.getElementById('mainOptions').style.display).toBe('flex');
    expect(quiz.initializeQuiz).not.toHaveBeenCalled();
  });
});
