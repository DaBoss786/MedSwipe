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

const waitForCalls = async (spy, count, maxTicks = 30) => {
  for (let i = 0; i < maxTicks; i += 1) {
    await flushMicrotasks();
    if (spy.mock.calls.length >= count) {
      return;
    }
  }
  throw new Error(`Timed out waiting for ${count} calls.`);
};

let notificationClickHandler;
let appModule;

const setupCapacitor = () => {
  window.Capacitor = {
    getPlatform: vi.fn(() => 'ios')
  };
};

const setupOneSignal = () => {
  notificationClickHandler = undefined;
  window.OneSignal = {
    Debug: { setLogLevel: vi.fn() },
    Notifications: {
      addEventListener: vi.fn((eventName, handler) => {
        if (eventName === 'click') {
          notificationClickHandler = handler;
        }
      })
    },
    initialize: vi.fn(() => Promise.resolve())
  };
};

beforeEach(async () => {
  setupDom();
  setupCapacitor();
  setupOneSignal();
  window.alert = vi.fn();
  appModule = await import('./app.js');
  await flushMicrotasks();
});

afterEach(() => {
  if (appModule?.__setPendingOneSignalDeepLinkState) {
    appModule.__setPendingOneSignalDeepLinkState({ pending: [], processing: false });
  }
  vi.clearAllMocks();
  vi.resetModules();
  document.body.innerHTML = '';
  delete window.Capacitor;
  delete window.OneSignal;
  delete window.alert;
  delete window.pendingDeepLinkQuestionId;
  delete window.isDeepLinkQuizActive;
  appModule = null;
});

describe('OneSignal deep link queue', () => {
  it('queues questionId payloads and initializes the deep-link quiz', async () => {
    const firebase = await import('./firebase-config.js');
    const quiz = await import('./quiz.js');

    firebase.auth.currentUser = { uid: 'user-1' };
    firebase.getDocs.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ Question: 'qs-1', Free: true }) }]
    });

    expect(typeof notificationClickHandler).toBe('function');

    const preventDefault = vi.fn();
    notificationClickHandler({
      notification: { additionalData: { questionId: 'qs-1' } },
      preventDefault
    });

    await waitForCalls(quiz.initializeQuiz, 1);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(firebase.getDocs).toHaveBeenCalledTimes(1);
    expect(quiz.initializeQuiz).toHaveBeenCalledWith([{ Question: 'qs-1', Free: true }], 'deep_link');
    expect(window.pendingDeepLinkQuestionId).toBe('qs-1');
    expect(window.isDeepLinkQuizActive).toBe(true);
  });

  it('uses deep_link URLs when no questionId is present', async () => {
    const firebase = await import('./firebase-config.js');
    const quiz = await import('./quiz.js');

    firebase.auth.currentUser = { uid: 'user-2' };
    firebase.getDocs.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ Question: 'qs-2', Free: true }) }]
    });

    expect(typeof notificationClickHandler).toBe('function');

    const preventDefault = vi.fn();
    notificationClickHandler({
      notification: { additionalData: { deep_link: 'https://medswipeapp.com/#/question/qs-2' } },
      preventDefault
    });

    await waitForCalls(quiz.initializeQuiz, 1);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(quiz.initializeQuiz).toHaveBeenCalledWith([{ Question: 'qs-2', Free: true }], 'deep_link');
    expect(window.pendingDeepLinkQuestionId).toBe('qs-2');
  });

  it('ignores clicks with no usable deep link payload', async () => {
    const firebase = await import('./firebase-config.js');
    const quiz = await import('./quiz.js');

    firebase.auth.currentUser = { uid: 'user-3' };

    expect(typeof notificationClickHandler).toBe('function');

    const preventDefault = vi.fn();
    notificationClickHandler({
      notification: { additionalData: { foo: 'bar' } },
      preventDefault
    });

    await flushMicrotasks();

    expect(preventDefault).not.toHaveBeenCalled();
    expect(firebase.getDocs).not.toHaveBeenCalled();
    expect(quiz.initializeQuiz).not.toHaveBeenCalled();
    expect(window.pendingDeepLinkQuestionId).toBeNull();
  });

  it('processes queued deep links sequentially', async () => {
    const firebase = await import('./firebase-config.js');
    const quiz = await import('./quiz.js');

    firebase.auth.currentUser = { uid: 'user-4' };
    firebase.getDocs
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ data: () => ({ Question: 'qs-3', Free: true }) }]
      })
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ data: () => ({ Question: 'qs-4', Free: true }) }]
      });

    expect(typeof notificationClickHandler).toBe('function');

    notificationClickHandler({
      notification: { additionalData: { questionId: 'qs-3' } },
      preventDefault: vi.fn()
    });
    notificationClickHandler({
      notification: { additionalData: { questionId: 'qs-4' } },
      preventDefault: vi.fn()
    });

    await waitForCalls(quiz.initializeQuiz, 2);

    expect(quiz.initializeQuiz).toHaveBeenCalledTimes(2);
    expect(quiz.initializeQuiz.mock.calls[0][0][0].Question).toBe('qs-3');
    expect(quiz.initializeQuiz.mock.calls[1][0][0].Question).toBe('qs-4');
    expect(window.pendingDeepLinkQuestionId).toBe('qs-4');
  });
});
