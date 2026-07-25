export const ONBOARDING_ERROR_CODES = Object.freeze({
  PROFILE_SAVE_TIMEOUT: 'PROFILE_SAVE_TIMEOUT',
  PROFILE_SAVE_FAILED: 'PROFILE_SAVE_FAILED',
  QUESTION_FETCH_FAILED: 'QUESTION_FETCH_FAILED',
  INSUFFICIENT_QUESTIONS: 'INSUFFICIENT_QUESTIONS',
  SWIPER_UNAVAILABLE: 'SWIPER_UNAVAILABLE',
  QUIZ_INIT_FAILED: 'QUIZ_INIT_FAILED',
  ONBOARDING_LOAD_TIMEOUT: 'ONBOARDING_LOAD_TIMEOUT'
});

export class OnboardingFlowError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'OnboardingFlowError';
    this.code = code;
  }
}

const delay = (duration, setTimer) =>
  new Promise((resolve) => setTimer(resolve, duration));

function normalizeError(error, fallbackCode) {
  if (error instanceof OnboardingFlowError) {
    return error;
  }
  const normalized = new OnboardingFlowError(
    error?.code || fallbackCode,
    error?.message || 'Onboarding could not be completed.',
    error ? { cause: error } : {}
  );
  return normalized;
}

export function createOnboardingController(dependencies, timing = {}) {
  const {
    saveProfile,
    resolvePolicy,
    prepareQuestions,
    loadUserContext,
    initializeQuiz,
    shouldSkipQuiz,
    routeSkippedOnboarding,
    renderState,
    logEvent = () => {}
  } = dependencies;

  const setTimer = timing.setTimeout || globalThis.setTimeout.bind(globalThis);
  const clearTimer = timing.clearTimeout || globalThis.clearTimeout.bind(globalThis);
  const now = timing.now || Date.now;
  const minimumLoaderMs = timing.minimumLoaderMs ?? 600;
  const slowStateMs = timing.slowStateMs ?? 8000;
  const profileTimeoutMs = timing.profileTimeoutMs ?? 12000;
  const recoveryStateMs = timing.recoveryStateMs ?? 20000;

  let nextAttemptId = 0;
  let activeAttempt = null;
  let lastInput = null;
  let selectionsSaved = false;
  let retryCount = 0;

  const isCurrent = (attempt) =>
    activeAttempt === attempt && attempt.cancelled !== true;

  const clearAttemptTimers = (attempt) => {
    attempt.timers.forEach(clearTimer);
    attempt.timers.clear();
  };

  const cancelActiveAttempt = () => {
    if (!activeAttempt) return;
    activeAttempt.cancelled = true;
    clearAttemptTimers(activeAttempt);
  };

  const schedule = (attempt, callback, duration) => {
    const timer = setTimer(() => {
      attempt.timers.delete(timer);
      if (isCurrent(attempt)) callback();
    }, duration);
    attempt.timers.add(timer);
    return timer;
  };

  const emit = (attempt, state) => {
    if (!isCurrent(attempt)) return;
    renderState({
      attemptId: attempt.id,
      selectionsSaved,
      retryCount,
      ...state
    });
  };

  const emitTelemetry = (name, attempt, payload) => {
    logEvent(name, {
      duration: Math.max(0, now() - attempt.startedAt),
      retry_count: retryCount,
      ...payload
    });
  };

  async function start(input, options = {}) {
    cancelActiveAttempt();
    lastInput = { ...input };
    selectionsSaved = options.selectionsSaved === true || selectionsSaved;
    if (options.isRetry) retryCount += 1;

    const attempt = {
      id: ++nextAttemptId,
      startedAt: now(),
      timers: new Set(),
      cancelled: false
    };
    activeAttempt = attempt;

    emit(attempt, {
      phase: selectionsSaved ? 'curating' : 'saving',
      message: selectionsSaved
        ? 'Curating your first three questions...'
        : 'Saving your profile...',
      spinnerVisible: true,
      actions: []
    });

    schedule(attempt, () => {
      emit(attempt, {
        phase: 'slow',
        message: 'This is taking longer than expected. Please keep the app open.',
        spinnerVisible: true,
        actions: []
      });
    }, slowStateMs);

    schedule(attempt, () => {
      attempt.cancelled = true;
      clearAttemptTimers(attempt);
      renderState({
        attemptId: attempt.id,
        phase: 'error',
        message: 'We could not finish loading your quiz yet.',
        errorCode: ONBOARDING_ERROR_CODES.ONBOARDING_LOAD_TIMEOUT,
        spinnerVisible: false,
        selectionsSaved,
        retryCount,
        actions: selectionsSaved ? ['retry', 'dashboard'] : ['retry', 'back']
      });
      emitTelemetry('onboarding_quiz_load', attempt, {
        outcome: 'timeout',
        error_code: ONBOARDING_ERROR_CODES.ONBOARDING_LOAD_TIMEOUT,
        specialty: input.specialty,
        question_count: 0
      });
    }, recoveryStateMs);

    const policyPromise = Promise.resolve().then(() =>
      resolvePolicy(input.specialty)
    );
    const questionPromise = Promise.resolve().then(() =>
      prepareQuestions(input.specialty, {
        forceRefresh: options.forceRefresh === true
      })
    );
    const contextPromise = Promise.resolve().then(() => loadUserContext());
    // A policy-driven skip may not consume these concurrently started promises.
    // Mark their early rejection as observed while preserving rejection for the
    // normal Promise.all path below.
    void questionPromise.catch(() => {});
    void contextPromise.catch(() => {});

    let profileTimer = null;
    const profilePromise = selectionsSaved
      ? Promise.resolve({ saved: true, resumed: true })
      : Promise.race([
          Promise.resolve().then(() => saveProfile(input)),
          new Promise((_, reject) => {
            profileTimer = schedule(attempt, () => {
              reject(
                new OnboardingFlowError(
                  ONBOARDING_ERROR_CODES.PROFILE_SAVE_TIMEOUT,
                  'Saving your profile took too long.'
                )
              );
            }, profileTimeoutMs);
          })
        ]);

    try {
      await profilePromise;
      if (profileTimer) {
        clearTimer(profileTimer);
        attempt.timers.delete(profileTimer);
      }
      if (!isCurrent(attempt)) return { status: 'stale', attemptId: attempt.id };

      selectionsSaved = true;
      emitTelemetry('onboarding_profile_save', attempt, {
        outcome: 'success',
        error_code: null,
        specialty: input.specialty
      });
      emit(attempt, {
        phase: 'curating',
        message: 'Curating your first three questions...',
        spinnerVisible: true,
        actions: []
      });

      const policy = await policyPromise;
      if (!isCurrent(attempt)) return { status: 'stale', attemptId: attempt.id };

      if (shouldSkipQuiz(policy)) {
        await delay(
          Math.max(0, minimumLoaderMs - (now() - attempt.startedAt)),
          setTimer
        );
        if (!isCurrent(attempt)) return { status: 'stale', attemptId: attempt.id };
        clearAttemptTimers(attempt);
        await routeSkippedOnboarding(policy);
        return { status: 'skipped', attemptId: attempt.id };
      }

      const [questionResult, userContext] = await Promise.all([
        questionPromise,
        contextPromise
      ]);
      if (!isCurrent(attempt)) return { status: 'stale', attemptId: attempt.id };

      const questions = Array.isArray(questionResult)
        ? questionResult
        : questionResult?.questions;
      if (!Array.isArray(questions) || questions.length < 3) {
        throw new OnboardingFlowError(
          ONBOARDING_ERROR_CODES.INSUFFICIENT_QUESTIONS,
          'Three onboarding questions are not available.'
        );
      }

      const quizResult = await initializeQuiz({
        questions,
        userContext,
        policy,
        attemptId: attempt.id
      });
      if (!isCurrent(attempt)) return { status: 'stale', attemptId: attempt.id };

      await delay(
        Math.max(0, minimumLoaderMs - (now() - attempt.startedAt)),
        setTimer
      );
      if (!isCurrent(attempt)) return { status: 'stale', attemptId: attempt.id };

      clearAttemptTimers(attempt);
      emit(attempt, {
        phase: 'ready',
        message: 'Your quiz is ready.',
        spinnerVisible: false,
        actions: [],
        quizResult
      });
      emitTelemetry('onboarding_quiz_load', attempt, {
        outcome: 'success',
        error_code: null,
        specialty: input.specialty,
        cache_source: questionResult?.source || 'unknown',
        question_count: questions.length
      });
      return { status: 'ready', attemptId: attempt.id, quizResult };
    } catch (rawError) {
      if (profileTimer) {
        clearTimer(profileTimer);
        attempt.timers.delete(profileTimer);
      }
      if (!isCurrent(attempt)) return { status: 'stale', attemptId: attempt.id };

      const defaultCode = selectionsSaved
        ? ONBOARDING_ERROR_CODES.QUIZ_INIT_FAILED
        : ONBOARDING_ERROR_CODES.PROFILE_SAVE_FAILED;
      const error = normalizeError(rawError, defaultCode);
      clearAttemptTimers(attempt);
      attempt.cancelled = true;

      renderState({
        attemptId: attempt.id,
        phase: 'error',
        message: selectionsSaved
          ? 'We could not load your quiz. Check your connection and try again.'
          : 'We could not save your profile. Check your connection and try again.',
        errorCode: error.code,
        spinnerVisible: false,
        selectionsSaved,
        retryCount,
        actions: selectionsSaved ? ['retry', 'dashboard'] : ['retry', 'back']
      });
      emitTelemetry(
        selectionsSaved ? 'onboarding_quiz_load' : 'onboarding_profile_save',
        attempt,
        {
          outcome: 'failure',
          error_code: error.code,
          specialty: input.specialty,
          question_count: 0
        }
      );
      return { status: 'error', attemptId: attempt.id, error };
    }
  }

  return {
    start,
    retry() {
      if (!lastInput) return Promise.resolve({ status: 'idle' });
      return start(lastInput, {
        selectionsSaved,
        forceRefresh: true,
        isRetry: true
      });
    },
    cancel: cancelActiveAttempt,
    getState() {
      return {
        attemptId: activeAttempt?.id || 0,
        selectionsSaved,
        retryCount,
        input: lastInput ? { ...lastInput } : null
      };
    }
  };
}
