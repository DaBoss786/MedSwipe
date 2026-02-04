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
  `;
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const waitForColdStartCompletion = async ({ maxTicks = 20 } = {}) => {
  for (let i = 0; i < maxTicks; i += 1) {
    await flushMicrotasks();
    if (!window.coldStartDeepLinkPending) {
      return;
    }
  }
  throw new Error('Timed out waiting for cold-start deep link to finish.');
};

let appUrlOpenHandler;

const setupCapacitor = () => {
  appUrlOpenHandler = undefined;
  window.Capacitor = {
    App: {
      addListener: vi.fn((eventName, handler) => {
        if (eventName === 'appUrlOpen') {
          appUrlOpenHandler = handler;
        }
        return { remove: vi.fn() };
      })
    }
  };
};

beforeEach(async () => {
  setupDom();
  setupCapacitor();
  window.alert = vi.fn();
  await import('./app.js');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  document.body.innerHTML = '';
  delete window.Capacitor;
  delete window.coldStartDeepLinkPending;
  delete window.pendingDeepLinkQuestionId;
  delete window.isDeepLinkQuizActive;
  delete window.alert;
});

describe('cold-start deep links (Capacitor appUrlOpen)', () => {
  it('handles question URLs and clears the pending flag after resolving', async () => {
    const firebase = await import('./firebase-config.js');
    const quiz = await import('./quiz.js');

    firebase.auth.currentUser = { uid: 'user-1' };
    const questionData = { Question: 'hash-123', Free: true };
    firebase.getDocs.mockResolvedValue({
      empty: false,
      docs: [{ data: () => questionData }]
    });

    expect(typeof appUrlOpenHandler).toBe('function');

    appUrlOpenHandler({ url: 'https://medswipeapp.com/#/question/hash-123' });

    expect(window.coldStartDeepLinkPending).toBe(true);

    await waitForColdStartCompletion();

    expect(firebase.getDocs).toHaveBeenCalledTimes(1);
    expect(quiz.initializeQuiz).toHaveBeenCalledTimes(1);
    expect(quiz.initializeQuiz).toHaveBeenCalledWith([questionData], 'deep_link');
    expect(window.pendingDeepLinkQuestionId).toBe('hash-123');
    expect(window.isDeepLinkQuizActive).toBe(true);
    expect(window.coldStartDeepLinkPending).toBe(false);
  });

  it('ignores non-question URLs without toggling pending state', async () => {
    const firebase = await import('./firebase-config.js');
    const quiz = await import('./quiz.js');

    firebase.auth.currentUser = { uid: 'user-2' };

    expect(typeof appUrlOpenHandler).toBe('function');

    appUrlOpenHandler({ url: 'https://medswipeapp.com/#/welcome' });

    await flushMicrotasks();

    expect(firebase.getDocs).not.toHaveBeenCalled();
    expect(quiz.initializeQuiz).not.toHaveBeenCalled();
    expect(window.coldStartDeepLinkPending).toBe(false);
  });
});
