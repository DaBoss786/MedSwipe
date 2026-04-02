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

function normalizeSpecialtyKey(specialty) {
  if (typeof specialty !== 'string') {
    return '';
  }
  return specialty.trim().toLowerCase();
}

function buildSpecialtyPolicy(specialty, remotePolicy) {
  const specialtyKey = normalizeSpecialtyKey(specialty);
  const fallbackPolicy = FALLBACK_POLICY_BY_SPECIALTY[specialtyKey] || null;
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

function resolvePolicyFromAuthState(authState = {}, specialty = null) {
  const resolvedSpecialty = specialty || authState?.specialty || authState?.selectedSpecialty || '';
  const specialtyKey = normalizeSpecialtyKey(resolvedSpecialty);

  if (authState?.specialtyPolicy && authState.specialtyPolicy.specialtyKey === specialtyKey) {
    return buildSpecialtyPolicy(specialtyKey, authState.specialtyPolicy);
  }

  return buildSpecialtyPolicy(specialtyKey, null);
}

function hasPilotBoardAccess(authState = {}, policy = resolvePolicyFromAuthState(authState)) {
  const tier = authState?.accessTier || '';
  return (
    tier === 'free_guest' &&
    policy.enabled === true &&
    policy.fullFeaturePilotForFreeGuest === true
  );
}

function shouldLimitQuestionsToFree(authState = {}, policy = resolvePolicyFromAuthState(authState)) {
  const tier = authState?.accessTier || '';
  return tier === 'free_guest' && !hasPilotBoardAccess(authState, policy);
}

function getPilotQuestionAccessConfig(authState = {}, policy = resolvePolicyFromAuthState(authState)) {
  if (!hasPilotBoardAccess(authState, policy)) {
    return { enabled: false, questionCap: null, questionPilotFlagField: null };
  }
  return {
    enabled: true,
    questionCap: policy.questionCap,
    questionPilotFlagField: policy.questionPilotFlagField
  };
}

function specialtyMatchesQuestion(question, specialty) {
  if (!specialty) {
    return true;
  }
  const questionSpecialty = sanitizeText(question?.Specialty, null);
  if (!questionSpecialty) {
    return true;
  }
  return normalizeSpecialtyKey(questionSpecialty) === normalizeSpecialtyKey(specialty);
}

function applyQuestionAccessPolicy(questions = [], authState = {}, policy = resolvePolicyFromAuthState(authState)) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return [];
  }

  let scoped = [...questions];

  if (shouldLimitQuestionsToFree(authState, policy)) {
    return scoped.filter((q) => q?.Free === true);
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

function isQuestionCmeEligible(question) {
  const flag = question?.['CME Eligible'];
  if (typeof flag === 'boolean') {
    return flag;
  }
  if (typeof flag === 'string') {
    const normalized = flag.trim().toLowerCase();
    return normalized === 'yes' || normalized === 'true';
  }
  return false;
}

export function applyCategoryAndAnsweredFilters({
  questions,
  category,
  bookmarksOnly = false,
  includeAnswered = false,
  answeredIds = []
}) {
  let filtered = questions;

  if (!bookmarksOnly && category && category !== "") {
    filtered = filtered.filter(q => q["Category"] && q["Category"].trim() === category);
  }

  if (!bookmarksOnly && !includeAnswered && answeredIds.length > 0) {
    filtered = filtered.filter(q => !answeredIds.includes(q["Question"]?.trim()));
  }

  return filtered;
}

export function getAvailableCategoriesForUser({
  questions = [],
  authState = {},
  specialty = null,
  cmeOnly = false,
  includeCounts = false,
  answeredQuestionIds = []
} = {}) {
  const effectiveSpecialty = sanitizeText(
    specialty || authState?.specialty || authState?.selectedSpecialty,
    null
  );
  const effectiveAuthState = {
    ...authState,
    specialty: effectiveSpecialty || authState?.specialty || authState?.selectedSpecialty || ''
  };
  const effectivePolicy = resolvePolicyFromAuthState(effectiveAuthState, effectiveSpecialty);

  let scopedQuestions = Array.isArray(questions) ? [...questions] : [];
  scopedQuestions = scopedQuestions.filter((question) =>
    specialtyMatchesQuestion(question, effectiveSpecialty)
  );
  scopedQuestions = applyQuestionAccessPolicy(scopedQuestions, effectiveAuthState, effectivePolicy);

  if (cmeOnly) {
    scopedQuestions = scopedQuestions.filter(isQuestionCmeEligible);
  }

  const answeredSet = new Set(
    (Array.isArray(answeredQuestionIds) ? answeredQuestionIds : [])
      .map((questionId) => sanitizeText(questionId, null))
      .filter(Boolean)
  );
  const categoryMap = new Map();

  scopedQuestions.forEach((question) => {
    const category = sanitizeText(question?.Category, null);
    if (!category) {
      return;
    }

    const existing = categoryMap.get(category) || {
      category,
      totalCount: 0,
      answeredCount: 0
    };

    existing.totalCount += 1;

    if (includeCounts && answeredSet.has(sanitizeText(question?.Question, null))) {
      existing.answeredCount += 1;
    }

    categoryMap.set(category, existing);
  });

  return Array.from(categoryMap.values())
    .sort((a, b) => a.category.localeCompare(b.category))
    .map((entry) => (
      includeCounts
        ? entry
        : {
          category: entry.category,
          totalCount: entry.totalCount,
          answeredCount: 0
        }
    ));
}
