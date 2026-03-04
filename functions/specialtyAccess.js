const POLICY_COLLECTION = "specialtyAccessPolicies";
const CACHE_TTL_MS = 5 * 60 * 1000;

const BASE_POLICY = Object.freeze({
  enabled: false,
  fullFeaturePilotForFreeGuest: false,
  hideCme: false,
  questionCap: null,
  questionPilotFlagField: null
});

const FALLBACK_POLICY_BY_SPECIALTY = Object.freeze({
  neurosurgery: {
    enabled: true,
    fullFeaturePilotForFreeGuest: true,
    hideCme: true,
    questionCap: 50,
    questionPilotFlagField: "pilotNeurosurgery"
  }
});

const policyCache = new Map();

function sanitizeText(value, fallback = null) {
  if (typeof value !== "string") {
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
    questionCap: sanitizePositiveInteger(raw.questionCap, null),
    questionPilotFlagField: sanitizeText(raw.questionPilotFlagField, null)
  };
}

function mergePolicy(...sources) {
  return sources.reduce((acc, source) => ({ ...acc, ...source }), {});
}

function normalizeSpecialtyKey(specialty) {
  if (typeof specialty !== "string") {
    return "";
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
      questionCap: null,
      questionPilotFlagField: null
    });

  return {
    specialtyKey,
    ...effectivePolicy
  };
}

async function getSpecialtyPolicy(db, specialty, options = {}) {
  const specialtyKey = normalizeSpecialtyKey(specialty);
  if (!specialtyKey) {
    return buildSpecialtyPolicy("", null);
  }

  const forceRefresh = options.forceRefresh === true;
  const now = Date.now();
  const cached = policyCache.get(specialtyKey);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.policy;
  }

  let remotePolicy = null;
  try {
    const policyDoc = await db.collection(POLICY_COLLECTION).doc(specialtyKey).get();
    if (policyDoc.exists) {
      remotePolicy = policyDoc.data() || null;
    }
  } catch (error) {
    // Intentionally silent fallback to keep critical paths resilient.
  }

  const policy = buildSpecialtyPolicy(specialtyKey, remotePolicy);
  policyCache.set(specialtyKey, {
    policy,
    expiresAt: now + CACHE_TTL_MS
  });
  return policy;
}

function hasPilotBoardAccess(userData = {}, policy) {
  const tier = userData.accessTier || "";
  return (
    tier === "free_guest" &&
    policy?.enabled === true &&
    policy?.fullFeaturePilotForFreeGuest === true
  );
}

function computePremiumFlags(userData = {}, policy) {
  const accessTier = userData.accessTier || null;
  const pilotBoard = hasPilotBoardAccess(userData, policy);
  const hasBoard =
    userData.boardReviewActive === true ||
    accessTier === "board_review" ||
    accessTier === "cme_annual" ||
    userData.boardReviewTier === "Granted by CME Annual" ||
    pilotBoard;
  const hasCme =
    userData.cmeSubscriptionActive === true ||
    accessTier === "cme_annual" ||
    (userData.cmeCreditsAvailable || 0) > 0;
  return {
    hasBoard,
    hasCme,
    hasPremium: hasBoard || hasCme,
    isPilotBoardAccess: pilotBoard
  };
}

function shouldLimitQuestionsToFree(userData = {}, policy) {
  const tier = userData.accessTier || "";
  return tier === "free_guest" && !hasPilotBoardAccess(userData, policy);
}

function getPilotQuestionAccessConfig(userData = {}, policy) {
  if (!hasPilotBoardAccess(userData, policy)) {
    return {
      enabled: false,
      questionCap: null,
      questionPilotFlagField: null
    };
  }
  return {
    enabled: true,
    questionCap: policy?.questionCap || null,
    questionPilotFlagField: policy?.questionPilotFlagField || null
  };
}

module.exports = {
  normalizeSpecialtyKey,
  getSpecialtyPolicy,
  computePremiumFlags,
  shouldLimitQuestionsToFree,
  getPilotQuestionAccessConfig
};
