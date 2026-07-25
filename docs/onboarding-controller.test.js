import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOnboardingController,
  ONBOARDING_ERROR_CODES,
  OnboardingFlowError
} from './onboarding-controller.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

function makeController(overrides = {}) {
  const states = [];
  const deps = {
    saveProfile: vi.fn().mockResolvedValue({ saved: true }),
    resolvePolicy: vi.fn().mockResolvedValue({ skipOnboardingQuiz: false }),
    prepareQuestions: vi.fn().mockResolvedValue({
      questions: [{}, {}, {}],
      source: 'network'
    }),
    loadUserContext: vi.fn().mockResolvedValue({
      answeredIds: [],
      bookmarks: [],
      sessionStartXP: 0
    }),
    initializeQuiz: vi.fn().mockResolvedValue({ firstCardVisible: true }),
    shouldSkipQuiz: (policy) => policy.skipOnboardingQuiz === true,
    routeSkippedOnboarding: vi.fn().mockResolvedValue(undefined),
    renderState: vi.fn((state) => states.push(state)),
    logEvent: vi.fn(),
    ...overrides
  };
  return {
    controller: createOnboardingController(deps, {
      minimumLoaderMs: 600,
      slowStateMs: 8000,
      profileTimeoutMs: 12000,
      recoveryStateMs: 20000
    }),
    deps,
    states
  };
}

describe('onboarding controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('shows feedback immediately, starts independent work, and blocks duplicate stale completion', async () => {
    const save = deferred();
    const questions = deferred();
    const first = makeController({
      saveProfile: vi.fn(() => save.promise),
      prepareQuestions: vi.fn(() => questions.promise)
    });

    const run = first.controller.start({
      specialty: 'ENT',
      experienceLevel: 'PGY 1-2',
      username: 'SwiftDoctor1234'
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(first.states[0]).toMatchObject({
      phase: 'saving',
      spinnerVisible: true
    });
    expect(first.deps.saveProfile).toHaveBeenCalledTimes(1);
    expect(first.deps.prepareQuestions).toHaveBeenCalledTimes(1);
    expect(first.deps.loadUserContext).toHaveBeenCalledTimes(1);

    const retry = first.controller.retry();
    await vi.advanceTimersByTimeAsync(0);
    save.resolve({ saved: true });
    questions.resolve({ questions: [{}, {}, {}] });
    await vi.advanceTimersByTimeAsync(600);
    await Promise.all([run, retry]);

    expect(first.states.at(-1).phase).toBe('ready');
    expect(first.states.at(-1).attemptId).toBe(2);
  });

  it('keeps the loader visible until quiz initialization and the minimum duration complete', async () => {
    const initialization = deferred();
    const test = makeController({
      initializeQuiz: vi.fn(() => initialization.promise)
    });
    const run = test.controller.start({ specialty: 'ENT' });
    await vi.advanceTimersByTimeAsync(700);

    expect(test.states.at(-1).phase).toBe('curating');
    initialization.resolve({ firstCardVisible: true });
    await vi.advanceTimersByTimeAsync(600);
    await run;

    expect(test.states.at(-1).phase).toBe('ready');
  });

  it('shows the slow and recovery states at 8 and 20 seconds', async () => {
    const save = deferred();
    const test = makeController({ saveProfile: vi.fn(() => save.promise) });
    const run = test.controller.start({ specialty: 'Urology' });

    await vi.advanceTimersByTimeAsync(8000);
    expect(test.states.at(-1).phase).toBe('slow');

    await vi.advanceTimersByTimeAsync(4000);
    expect(test.states.at(-1)).toMatchObject({
      phase: 'error',
      errorCode: ONBOARDING_ERROR_CODES.PROFILE_SAVE_TIMEOUT,
      actions: ['retry', 'back']
    });
    await run;
  });

  it('offers dashboard recovery only after a successful selection save', async () => {
    const initialization = deferred();
    const test = makeController({
      initializeQuiz: vi.fn(() => initialization.promise)
    });
    void test.controller.start({ specialty: 'Anesthesiology' });
    await vi.advanceTimersByTimeAsync(20000);

    expect(test.states.at(-1)).toMatchObject({
      phase: 'error',
      errorCode: ONBOARDING_ERROR_CODES.ONBOARDING_LOAD_TIMEOUT,
      selectionsSaved: true,
      actions: ['retry', 'dashboard']
    });
  });

  it('preserves specialty policy skip routing', async () => {
    const test = makeController({
      resolvePolicy: vi.fn().mockResolvedValue({ skipOnboardingQuiz: true })
    });
    const run = test.controller.start({ specialty: 'Neurosurgery' });
    await vi.advanceTimersByTimeAsync(600);
    await run;

    expect(test.deps.routeSkippedOnboarding).toHaveBeenCalledTimes(1);
    expect(test.deps.initializeQuiz).not.toHaveBeenCalled();
  });

  it('surfaces typed quiz failures after save', async () => {
    const test = makeController({
      initializeQuiz: vi.fn().mockRejectedValue(
        new OnboardingFlowError(
          ONBOARDING_ERROR_CODES.SWIPER_UNAVAILABLE,
          'Swiper is missing'
        )
      )
    });
    const run = test.controller.start({ specialty: 'ENT' });
    await vi.advanceTimersByTimeAsync(0);
    await run;

    expect(test.states.at(-1)).toMatchObject({
      phase: 'error',
      errorCode: ONBOARDING_ERROR_CODES.SWIPER_UNAVAILABLE,
      actions: ['retry', 'dashboard']
    });
  });
});
