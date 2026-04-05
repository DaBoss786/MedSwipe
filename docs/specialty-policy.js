import { db, doc, getDoc } from './firebase-config.js';

const SPECIALTY_POLICY_COLLECTION = 'specialtyAccessPolicies';
const CACHE_TTL_MS = 5 * 60 * 1000;
const CME_MODULE_ENABLED = false;

const BASE_POLICY = Object.freeze({
  enabled: false,
  fullFeaturePilotForFreeGuest: false,
  hideCme: false,
  skipOnboardingQuiz: false,
  skipOnboardingCarousel: false,
  skipPaywall: false,
  casePrepMode: 'default',
  questionCap: null,
  questionPilotFlagField: null
});

const FALLBACK_POLICY_BY_SPECIALTY = Object.freeze({
  neurosurgery: {
    enabled: true,
    fullFeaturePilotForFreeGuest: true,
    hideCme: true,
    skipOnboardingQuiz: true,
    skipOnboardingCarousel: true,
    skipPaywall: true,
    casePrepMode: 'coming_soon',
    questionCap: 50,
    questionPilotFlagField: 'pilotNeurosurgery'
  }
});

const policyCache = new Map();

function sanitizeText(value, fallback = null) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizePositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const floored = Math.floor(parsed);
  return floored > 0 ? floored : fallback;
}

function normalizePolicy(raw = {}) {
  return {
    enabled: raw.enabled === true,
    fullFeaturePilotForFreeGuest: raw.fullFeaturePilotForFreeGuest === true,
    hideCme: raw.hideCme === true,
    skipOnboardingQuiz: raw.skipOnboardingQuiz === true,
    skipOnboardingCarousel: raw.skipOnboardingCarousel === true,
    skipPaywall: raw.skipPaywall === true,
    casePrepMode: sanitizeText(raw.casePrepMode, 'default'),
    questionCap: sanitizePositiveInteger(raw.questionCap, null),
    questionPilotFlagField: sanitizeText(raw.questionPilotFlagField, null)
  };
}

function mergePolicy(...sources) {
  return sources.reduce((acc, source) => ({ ...acc, ...source }), {});
}

export function normalizeSpecialtyKey(specialty) {
  if (typeof specialty !== 'string') {
    return '';
  }
  return specialty.trim().toLowerCase();
}

function buildSpecialtyPolicy(specialty, remotePolicy) {
  const specialtyKey = normalizeSpecialtyKey(specialty);
  const fallbackPolicy =
    FALLBACK_POLICY_BY_SPECIALTY[specialtyKey] || null;
  const normalizedRemote = remotePolicy ? normalizePolicy(remotePolicy) : null;

  const merged = mergePolicy(
    BASE_POLICY,
    fallbackPolicy ? normalizePolicy(fallbackPolicy) : {},
    normalizedRemote || {}
  );
  const effectivePolicy = merged.enabled === true
    ? merged
    : mergePolicy(merged, {
      fullFeaturePilotForFreeGuest: false,
      hideCme: false,
      skipOnboardingQuiz: false,
      skipOnboardingCarousel: false,
      skipPaywall: false,
      casePrepMode: 'default',
      questionCap: null,
      questionPilotFlagField: null
    });

  return {
    specialtyKey,
    ...effectivePolicy
  };
}

export async function getSpecialtyPolicy(specialty, options = {}) {
  const specialtyKey = normalizeSpecialtyKey(specialty);
  const forceRefresh = options.forceRefresh === true;

  if (!specialtyKey) {
    return buildSpecialtyPolicy('', null);
  }

  const now = Date.now();
  const cached = policyCache.get(specialtyKey);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.policy;
  }

  let remotePolicy = null;
  try {
    const policyDocRef = doc(db, SPECIALTY_POLICY_COLLECTION, specialtyKey);
    const policyDoc = await getDoc(policyDocRef);
    if (policyDoc.exists()) {
      remotePolicy = policyDoc.data() || null;
    }
  } catch (error) {
    console.warn(
      `Unable to load specialty policy for "${specialtyKey}". Falling back to defaults.`,
      error
    );
  }

  const policy = buildSpecialtyPolicy(specialtyKey, remotePolicy);
  policyCache.set(specialtyKey, {
    policy,
    expiresAt: now + CACHE_TTL_MS
  });
  return policy;
}

export function resolvePolicyFromAuthState(authState = {}) {
  const specialty = authState?.specialty || authState?.selectedSpecialty || '';
  const specialtyKey = normalizeSpecialtyKey(specialty);

  if (authState?.specialtyPolicy && authState.specialtyPolicy.specialtyKey === specialtyKey) {
    return buildSpecialtyPolicy(specialtyKey, authState.specialtyPolicy);
  }

  return buildSpecialtyPolicy(specialtyKey, null);
}

function hasBaseBoardReviewAccess(authState = {}) {
  const tier = authState?.accessTier || '';
  return (
    authState?.boardReviewActive === true ||
    tier === 'board_review' ||
    tier === 'cme_annual' ||
    authState?.boardReviewTier === 'Granted by CME Annual'
  );
}

function hasBaseCmeAccess(authState = {}) {
  const tier = authState?.accessTier || '';
  return (
    authState?.cmeSubscriptionActive === true ||
    tier === 'cme_annual' ||
    Number(authState?.cmeCreditsAvailable || 0) > 0
  );
}

export function hasPilotBoardAccess(authState = {}, policy = resolvePolicyFromAuthState(authState)) {
  const tier = authState?.accessTier || '';
  return (
    tier === 'free_guest' &&
    policy.enabled === true &&
    policy.fullFeaturePilotForFreeGuest === true
  );
}

export function userHasBoardReviewAccess(authState = {}, policy = resolvePolicyFromAuthState(authState)) {
  return hasBaseBoardReviewAccess(authState) || hasPilotBoardAccess(authState, policy);
}

export function userHasCmeAccess(authState = {}) {
  return hasBaseCmeAccess(authState);
}

export function userHasAnyPremiumAccess(authState = {}, policy = resolvePolicyFromAuthState(authState)) {
  return userHasBoardReviewAccess(authState, policy) || userHasCmeAccess(authState);
}

export function isCmeGloballyEnabled() {
  return CME_MODULE_ENABLED;
}

export function shouldHideCmeUi(authState = {}, policy = resolvePolicyFromAuthState(authState)) {
  return !isCmeGloballyEnabled() || policy.hideCme === true;
}

export function shouldLimitQuestionsToFree(authState = {}, policy = resolvePolicyFromAuthState(authState)) {
  const tier = authState?.accessTier || '';
  return tier === 'free_guest' && !hasPilotBoardAccess(authState, policy);
}

export function getPilotQuestionAccessConfig(authState = {}, policy = resolvePolicyFromAuthState(authState)) {
  if (!hasPilotBoardAccess(authState, policy)) {
    return { enabled: false, questionCap: null, questionPilotFlagField: null };
  }
  return {
    enabled: true,
    questionCap: policy.questionCap,
    questionPilotFlagField: policy.questionPilotFlagField
  };
}

export function specialtyMatchesQuestion(question, specialty) {
  if (!specialty) {
    return true;
  }
  const questionSpecialty = sanitizeText(question?.Specialty, null);
  if (!questionSpecialty) {
    return true;
  }
  return normalizeSpecialtyKey(questionSpecialty) === normalizeSpecialtyKey(specialty);
}

export function applyQuestionAccessPolicy(questions = [], authState = {}, policy = resolvePolicyFromAuthState(authState)) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return [];
  }

  let scoped = [...questions];

  if (shouldLimitQuestionsToFree(authState, policy)) {
    scoped = scoped.filter((q) => q?.Free === true);
    return scoped;
  }

  const pilotConfig = getPilotQuestionAccessConfig(authState, policy);
  if (pilotConfig.enabled) {
    if (pilotConfig.questionPilotFlagField) {
      scoped = scoped.filter((q) => q?.[pilotConfig.questionPilotFlagField] === true);
    }
    if (pilotConfig.questionCap && scoped.length > pilotConfig.questionCap) {
      scoped = scoped.slice(0, pilotConfig.questionCap);
    }
  }

  return scoped;
}

export function shouldSkipOnboardingQuiz(policy) {
  return policy?.skipOnboardingQuiz === true;
}

export function shouldSkipOnboardingCarousel(policy) {
  return policy?.skipOnboardingCarousel === true;
}

export function shouldSkipPaywall(policy) {
  return policy?.skipPaywall === true;
}
