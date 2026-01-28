'use strict';

// Firebase & Google Cloud imports
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');

// Other imports
const axios = require('axios');

// Initialize the Firebase Admin SDK if it hasn't been initialized yet
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

// For v2 functions, use environment variables instead of functions.config()
const WEBHOOK_SIGNATURE_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET || '';
const WEBHOOK_AUTH_HEADER = process.env.REVENUECAT_WEBHOOK_AUTH_HEADER || '';
const REVENUECAT_API_KEY = process.env.REVENUECAT_API_KEY || '';

// -----------------------------------------------------------------------------
// Constants for Event Types and Products
// -----------------------------------------------------------------------------
const PURCHASE_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'NON_RENEWING_PURCHASE',
  'IN_APP_PURCHASE',
  'PURCHASE',
  'PRODUCT_CHANGE',
]);

// Subscription Products Catalog
const PRODUCT_CATALOG = {
  'medswipe.board.review.monthly': {
    tier: 'board_review',
    planName: 'Board Review Monthly',
    trialType: 'board_review',
  },
  'medswipe.board.review.quarterly': {
    tier: 'board_review',
    planName: 'Board Review 3-Month',
    trialType: 'board_review',
  },
  'medswipe.board.review.annual': {
    tier: 'board_review',
    planName: 'Board Review Annual',
    trialType: 'board_review',
  },
  'medswipe.cme.annual': {
    tier: 'cme_annual',
    planName: 'CME Annual Subscription',
    trialType: 'cme_annual',
    grantsBoardReview: true,
  },
};

// One-Time CME Credit Products Catalog
const CREDIT_PRODUCT_CATALOG = {
  'medswipe.cme.credits': {
    creditsPerUnit: 1,
    defaultQuantity: 1,
  },
  // Add more credit product variations here if needed
  // 'medswipe.cme.credits.5pack': { creditsPerUnit: 5, defaultQuantity: 1 },
};

// -----------------------------------------------------------------------------
// Helper: Verify webhook authorization header
// -----------------------------------------------------------------------------
function timingSafeEqual(a, b) {
  try {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));

    if (bufA.length !== bufB.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  } catch (error) {
    logger.warn('timingSafeEqual comparison failed.', { error: error.message });
    return false;
  }
}

function verifyRevenueCatWebhook(req) {
  const rawSignatureSecret = (WEBHOOK_SIGNATURE_SECRET || '').trim();
  const rawAuthSecret = (WEBHOOK_AUTH_HEADER || '').trim();

  const normalizedSignatureSecret = rawSignatureSecret.startsWith('Bearer ')
    ? rawSignatureSecret.slice(7).trim()
    : rawSignatureSecret;

  const normalizedAuthSecret = rawAuthSecret.startsWith('Bearer ')
    ? rawAuthSecret.slice(7).trim()
    : rawAuthSecret;

  const effectiveAuthSecret = normalizedAuthSecret || normalizedSignatureSecret;
  const signatureSecret = normalizedSignatureSecret;

  if (!effectiveAuthSecret && !signatureSecret) {
    logger.error(
      'RevenueCat webhook secrets are not configured. Set REVENUECAT_WEBHOOK_AUTH_HEADER and/or REVENUECAT_WEBHOOK_SECRET.'
    );
    return false;
  }

  const headerSecret = (req.headers.authorization || '').trim();
  const signatureHeader = (req.headers['x-revenuecat-signature'] || '').trim();
  let attemptedVerification = false;

  if (headerSecret && effectiveAuthSecret) {
    attemptedVerification = true;

    const normalizedHeader = headerSecret.startsWith('Bearer ')
      ? headerSecret.slice(7).trim()
      : headerSecret;

    if (timingSafeEqual(normalizedHeader, effectiveAuthSecret)) {
      return true;
    }

    logger.warn('RevenueCat webhook authorization failed.');
  } else if (headerSecret && !effectiveAuthSecret) {
    attemptedVerification = true;
    logger.warn(
      'Authorization header provided on RevenueCat webhook, but no REVENUECAT_WEBHOOK_AUTH_HEADER (or fallback secret) configured.'
    );
  }

  if (signatureHeader && signatureSecret) {
    attemptedVerification = true;

    const rawBody = req.rawBody;

    if (!rawBody || !rawBody.length) {
      logger.warn('Missing rawBody for RevenueCat signature verification.');
      return false;
    }

    try {
      const computedSignature = crypto
        .createHmac('sha256', signatureSecret)
        .update(rawBody)
        .digest('base64');

      if (timingSafeEqual(signatureHeader, computedSignature)) {
        return true;
      }

      logger.warn('RevenueCat webhook signature verification failed.');
    } catch (error) {
      logger.error('RevenueCat webhook signature verification threw an error.', {
        error: error.message,
      });
      return false;
    }
  } else if (signatureHeader && !signatureSecret) {
    attemptedVerification = true;
    logger.warn(
      'RevenueCat webhook included X-RevenueCat-Signature header, but REVENUECAT_WEBHOOK_SECRET is not configured.'
    );
  }

  if (!attemptedVerification) {
    logger.warn(
      'Missing Authorization or X-RevenueCat-Signature header on RevenueCat webhook.'
    );
  }

  return false;
}

// -----------------------------------------------------------------------------
// Helper: Fetch subscriber data from RevenueCat REST API
// -----------------------------------------------------------------------------
async function fetchSubscriberData(appUserId) {
  if (!REVENUECAT_API_KEY) {
    throw new Error('RevenueCat API key is not configured.');
  }

  const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${REVENUECAT_API_KEY}`,
      },
      timeout: 20000,
    });

    return response.data;
  } catch (error) {
    logger.error('Failed to fetch subscriber data from RevenueCat.', {
      appUserId,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });

    throw error;
  }
}

// -----------------------------------------------------------------------------
// Helper: Utility Functions
// -----------------------------------------------------------------------------
function coerceNumber(value) {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getProductIdentifier(event = {}) {
  return (
    event.product_id ||
    event.productIdentifier ||
    event.productId ||
    event?.transaction?.product_id ||
    event?.transaction?.productId ||
    null
  );
}

function extractQuantity(payload = {}, productId, creditsMeta = {}) {
  const event = payload.event || {};

  const candidates = [
    event?.store_transaction?.quantity,
    event?.purchased_product?.store_transaction?.quantity,
    event?.transaction?.quantity,
    payload?.transaction?.quantity,
  ];

  if (productId && payload?.non_subscriptions?.[productId]?.length) {
    candidates.push(
      payload.non_subscriptions[productId][0]?.store_transaction?.quantity
    );
  }

  for (const candidate of candidates) {
    const numeric = coerceNumber(candidate);
    if (numeric && numeric > 0) {
      return numeric;
    }
  }

  const inferred = coerceNumber(creditsMeta.defaultQuantity);
  if (inferred && inferred > 0) return inferred;

  return 1;
}

function extractTimestamp(payload = {}) {
  const event = payload.event || {};

  const candidateMap = [
    ['event.event_timestamp_ms', event?.event_timestamp_ms],
    ['event.eventTimestampMs', event?.eventTimestampMs],
    ['event.purchased_at_ms', event?.purchased_at_ms],
    ['event.purchasedAtMs', event?.purchasedAtMs],
    ['event.transaction.purchase_date_ms', event?.transaction?.purchase_date_ms],
    [
      'event.store_transaction.purchase_date_ms',
      event?.store_transaction?.purchase_date_ms,
    ],
    [
      'event.purchased_product.store_transaction.purchase_date_ms',
      event?.purchased_product?.store_transaction?.purchase_date_ms,
    ],
    ['payload.event_timestamp_ms', payload?.event_timestamp_ms],
    ['payload.purchased_at_ms', payload?.purchased_at_ms],
  ];

  for (const [source, candidate] of candidateMap) {
    const numeric = coerceNumber(candidate);
    if (numeric && numeric > 0) {
      return {
        timestamp: Timestamp.fromMillis(numeric),
        millis: numeric,
        source,
      };
    }
  }

  const fallbackMillis = Date.now();
  return {
    timestamp: Timestamp.fromMillis(fallbackMillis),
    millis: fallbackMillis,
    source: 'fallback_now',
  };
}

function resolveBooleanState(updates = {}, userData = {}, field) {
  if (Object.prototype.hasOwnProperty.call(updates, field)) {
    return !!updates[field];
  }
  if (Object.prototype.hasOwnProperty.call(userData, field)) {
    return !!userData[field];
  }
  return false;
}

function timestampFromMillisOrNull(value) {
  const millis = Number(value);
  if (!Number.isFinite(millis) || millis <= 0) {
    return null;
  }

  try {
    return Timestamp.fromMillis(Math.trunc(millis));
  } catch (error) {
    logger.warn('Failed to convert millis to Firestore Timestamp.', {
      value,
      error: error.message,
    });
    return null;
  }
}

function toMillis(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function extractSubscriberMetadata(webhookPayload) {
  const rootAttributes = webhookPayload?.subscriber_attributes;
  const nestedAttributes = webhookPayload?.subscriber?.subscriber_attributes;
  const attributesSource = rootAttributes ?? nestedAttributes ?? {};
  const provided = rootAttributes != null || nestedAttributes != null;

  const metadata = {};
  for (const [key, attribute] of Object.entries(attributesSource)) {
    if (attribute && typeof attribute === 'object' && 'value' in attribute) {
      metadata[key] = attribute.value;
      if (attribute.updated_at_ms) {
        metadata[`${key}_updated_at`] = attribute.updated_at_ms;
      }
    } else {
      metadata[key] = attribute;
    }
  }

  return { metadata, provided };
}

function parseDateLike(value) {
  const millis = toMillis(value);
  if (millis) {
    return millis;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function getExpirationMillis(subscription = {}) {
  const candidateKeys = [
    'expiration_at_ms',
    'expires_at_ms',
    'expires_date_ms',
    'expiration_date_ms',
    'expires_date',
    'expiration_date',
  ];

  for (const key of candidateKeys) {
    if (key in subscription) {
      const millis = parseDateLike(subscription[key]);
      if (millis) {
        return millis;
      }
    }
  }

  return null;
}

function evaluateSubscription(productIdentifier, subscription) {
  const catalogEntry = PRODUCT_CATALOG[productIdentifier];
  if (!catalogEntry) {
    return null;
  }

  const expirationMs = getExpirationMillis(subscription);
  const startMs =
    toMillis(subscription.purchased_at_ms) ||
    toMillis(subscription.original_purchase_date_ms) ||
    Date.now();
  const trialStartMs = toMillis(subscription.trial_started_at_ms) || toMillis(subscription.trial_start_at_ms);
  const trialEndMs = toMillis(subscription.trial_ends_at_ms) || toMillis(subscription.trial_end_at_ms);
  const cancellationMs =
    toMillis(subscription.unsubscribe_detected_at_ms) || toMillis(subscription.cancellation_at_ms);
  const willRenew = subscription.will_renew;

  const now = Date.now();
  const inTrialPeriod = String(subscription.period_type || '').toLowerCase() === 'trial';
  let isTrialing = false;
  if (inTrialPeriod) {
    if (trialEndMs) {
      isTrialing = trialEndMs > now;
    } else if (expirationMs) {
      isTrialing = expirationMs > now;
    }
  }
  const isActive = !!expirationMs && expirationMs > now;
  const cancelAtPeriodEnd = willRenew === false || (!!cancellationMs && (!expirationMs || expirationMs > now));

  return {
    catalogEntry,
    productIdentifier,
    subscriptionId: subscription.original_transaction_id || subscription.id || productIdentifier,
    isTrialing,
    isActive: isActive || isTrialing,
    cancelAtPeriodEnd,
    expirationMs: expirationMs || null,
    startMs: startMs || null,
    trialStartMs: trialStartMs || null,
    trialEndMs: trialEndMs || null,
    store: subscription.store || null,
    environment: subscription.environment || null,
  };
}

function pickRelevantSubscription(subscriptions) {
  if (!subscriptions.length) {
    return null;
  }

  const activeOrTrialing = subscriptions.filter((item) => item.isActive);
  const pool = activeOrTrialing.length ? activeOrTrialing : subscriptions;

  return pool.reduce((best, current) => {
    if (!best) {
      return current;
    }

    const bestExpiration = best.expirationMs || 0;
    const currentExpiration = current.expirationMs || 0;

    if (currentExpiration !== bestExpiration) {
      return currentExpiration > bestExpiration ? current : best;
    }

    const bestStart = best.startMs || 0;
    const currentStart = current.startMs || 0;
    return currentStart > bestStart ? current : best;
  }, null);
}

function determineAccessTierFromStates(
    boardState,
    cmeState,
    userData = {},
    updates = {},
    creditIncrement = 0
  ) {  const hasActiveCme = resolveBooleanState(updates, userData, 'cmeSubscriptionActive');
  const hasActiveBoard = resolveBooleanState(updates, userData, 'boardReviewActive');
  const credits = coerceNumber(userData?.cmeCreditsAvailable) || 0;
  const incrementalCredits = coerceNumber(creditIncrement) || 0;
  const totalCredits = credits + incrementalCredits;

  if (cmeState && cmeState.isActive) {
    return 'cme_annual';
  }

  if (boardState && boardState.isActive) {
    return 'board_review';
  }

  if (!hasActiveCme && !hasActiveBoard && totalCredits > 0) {
    return 'cme_credits_only';
  }

  return 'free_guest';
}

// -----------------------------------------------------------------------------
// Helper: Convert RevenueCat subscriber data into user document updates
// -----------------------------------------------------------------------------
function transformRevenueCatToUserUpdates(subscriberPayload, webhookPayload, userData = {}) {
  const subscriber = subscriberPayload?.subscriber || {};
  const subscriptions = subscriber.subscriptions || {};
  const { metadata: subscriberMetadata, provided: attributesProvided } = extractSubscriberMetadata(webhookPayload);

  const updates = {};
  const diagnostic = {};

  // ============================================================================
  // PART 1: Handle One-Time CME Credit Purchases
  // ============================================================================
  const event = webhookPayload.event || {};
  const eventType = event?.type || null;
  const productId = getProductIdentifier(event);

  diagnostic.eventType = eventType;
  diagnostic.productId = productId;

  const creditMeta = productId ? CREDIT_PRODUCT_CATALOG[productId] : null;
  const isPurchaseEvent = eventType && PURCHASE_EVENT_TYPES.has(eventType);

  let creditIncrement = 0;

  if (creditMeta && isPurchaseEvent) {
    const quantity = extractQuantity(webhookPayload, productId, creditMeta);
    const creditsPerUnit = coerceNumber(creditMeta.creditsPerUnit) || 1;
    const creditsToGrant = quantity * creditsPerUnit;

    updates.cmeCreditsAvailable = FieldValue.increment(creditsToGrant);
    creditIncrement = creditsToGrant;

    const { timestamp, source: timestampSource, millis } = extractTimestamp(webhookPayload);
    updates.lastCmeCreditPurchaseDate = timestamp;

    const priorCredits = coerceNumber(userData?.cmeCreditsAvailable) || 0;
    const estimatedCreditsAfter = priorCredits + creditsToGrant;

    diagnostic.creditPurchase = {
      detected: true,
      eventType,
      productId,
      quantity,
      creditsPerUnit,
      creditsGranted: creditsToGrant,
      priorCredits,
      estimatedCreditsAfter,
      timestampMillis: millis,
      timestampSource,
    };

    logger.info('Detected RevenueCat credit purchase', diagnostic.creditPurchase);
  } else {
    diagnostic.creditPurchase = {
      detected: false,
      reason: !creditMeta
        ? 'product_not_configured'
        : 'event_type_not_purchase',
      eventType,
      productId,
    };
  }

  // ============================================================================
  // PART 2: Handle Subscriptions (Board Review & CME Annual)
  // ============================================================================
  const boardCandidates = [];
  const cmeCandidates = [];

  for (const [productIdentifier, subscription] of Object.entries(subscriptions)) {
    const evaluated = evaluateSubscription(productIdentifier, subscription);
    if (!evaluated) {
      continue;
    }

    if (evaluated.catalogEntry.tier === 'board_review') {
      boardCandidates.push(evaluated);
    }

    if (evaluated.catalogEntry.tier === 'cme_annual') {
      cmeCandidates.push(evaluated);
    }
  }

  const boardState = pickRelevantSubscription(boardCandidates);
  const cmeState = pickRelevantSubscription(cmeCandidates);

  updates.lastRevenueCatSync = FieldValue.serverTimestamp();

  if (attributesProvided) {
    if (Object.keys(subscriberMetadata).length > 0) {
      updates.revenuecatSubscriberAttributes = subscriberMetadata;
    } else {
      updates.revenuecatSubscriberAttributes = FieldValue.delete();
    }
  }

  if (subscriber.first_seen_ms) {
    const firstSeen = timestampFromMillisOrNull(subscriber.first_seen_ms);
    if (firstSeen) {
      updates.revenuecatFirstSeen = firstSeen;
    }
  }

  let hasActiveTrial = false;
  let trialType = null;

  // Process Board Review Subscription
  if (boardState) {
    const planName = boardState.catalogEntry.planName;
    const startTs = timestampFromMillisOrNull(boardState.startMs);
    const endTs = timestampFromMillisOrNull(boardState.expirationMs);

    updates.boardReviewActive = boardState.isActive;
    updates.boardReviewTier = boardState.isActive ? planName : 'Expired/Canceled';
    updates.boardReviewSubscriptionId = boardState.subscriptionId || FieldValue.delete();
    if (startTs) {
      updates.boardReviewSubscriptionStartDate = startTs;
    } else if (boardState.isActive) {
      updates.boardReviewSubscriptionStartDate = FieldValue.serverTimestamp();
    } else {
      updates.boardReviewSubscriptionStartDate = FieldValue.delete();
    }
    if (endTs) {
      updates.boardReviewSubscriptionEndDate = endTs;
    } else {
      updates.boardReviewSubscriptionEndDate = FieldValue.delete();
    }
    updates.boardReviewWillCancelAtPeriodEnd = !!boardState.cancelAtPeriodEnd;

    if (boardState.isTrialing && boardState.trialEndMs) {
      const trialEnd = timestampFromMillisOrNull(boardState.trialEndMs);
      if (trialEnd) {
        updates.boardReviewTrialEndDate = trialEnd;
        hasActiveTrial = true;
        trialType = boardState.catalogEntry.trialType;
      }
    } else {
      updates.boardReviewTrialEndDate = FieldValue.delete();
    }
  }

  // Process CME Annual Subscription
  if (cmeState) {
    const planName = cmeState.catalogEntry.planName;
    const startTs = timestampFromMillisOrNull(cmeState.startMs);
    const endTs = timestampFromMillisOrNull(cmeState.expirationMs);

    updates.cmeSubscriptionActive = cmeState.isActive;
    updates.cmeSubscriptionPlan = cmeState.isActive ? planName : 'Expired/Canceled';
    updates.cmeSubscriptionId = cmeState.subscriptionId || FieldValue.delete();
    if (startTs) {
      updates.cmeSubscriptionStartDate = startTs;
    } else if (cmeState.isActive) {
      updates.cmeSubscriptionStartDate = FieldValue.serverTimestamp();
    } else {
      updates.cmeSubscriptionStartDate = FieldValue.delete();
    }
    if (endTs) {
      updates.cmeSubscriptionEndDate = endTs;
    } else {
      updates.cmeSubscriptionEndDate = FieldValue.delete();
    }
    updates.cmeSubscriptionWillCancelAtPeriodEnd = !!cmeState.cancelAtPeriodEnd;

    if (cmeState.isTrialing && cmeState.trialEndMs) {
      const trialEnd = timestampFromMillisOrNull(cmeState.trialEndMs);
      if (trialEnd) {
        updates.cmeSubscriptionTrialEndDate = trialEnd;
        hasActiveTrial = true;
        trialType = cmeState.catalogEntry.trialType;
      }
    } else {
      updates.cmeSubscriptionTrialEndDate = FieldValue.delete();
    }

    // CME Annual also grants Board Review access
    if (cmeState.catalogEntry.grantsBoardReview) {
      if (cmeState.isActive) {
        updates.boardReviewActive = true;
        updates.boardReviewTier = 'Granted by CME Annual';
        updates.boardReviewSubscriptionId = cmeState.subscriptionId || FieldValue.delete();
        if (startTs) {
          updates.boardReviewSubscriptionStartDate = startTs;
        } else {
          updates.boardReviewSubscriptionStartDate = FieldValue.serverTimestamp();
        }
        if (endTs) {
          updates.boardReviewSubscriptionEndDate = endTs;
        } else {
          updates.boardReviewSubscriptionEndDate = FieldValue.delete();
        }
        updates.boardReviewWillCancelAtPeriodEnd = !!cmeState.cancelAtPeriodEnd;

        if (cmeState.isTrialing && cmeState.trialEndMs) {
          const trialEnd = timestampFromMillisOrNull(cmeState.trialEndMs);
          if (trialEnd) {
            updates.boardReviewTrialEndDate = trialEnd;
          }
        } else {
          updates.boardReviewTrialEndDate = FieldValue.delete();
        }
      } else if (!boardState || !boardState.isActive) {
        updates.boardReviewActive = false;
        updates.boardReviewTier = 'Expired/Canceled';
        updates.boardReviewSubscriptionId = cmeState.subscriptionId || FieldValue.delete();
        if (startTs) {
          updates.boardReviewSubscriptionStartDate = startTs;
        } else {
          updates.boardReviewSubscriptionStartDate = FieldValue.delete();
        }
        if (endTs) {
          updates.boardReviewSubscriptionEndDate = endTs;
        } else {
          updates.boardReviewSubscriptionEndDate = FieldValue.delete();
        }
        updates.boardReviewWillCancelAtPeriodEnd = false;
        updates.boardReviewTrialEndDate = FieldValue.delete();
      }
    }
  }

  // Set trial flags
  if (hasActiveTrial && trialType) {
    updates.hasActiveTrial = true;
    updates.trialType = trialType;
  } else {
    updates.hasActiveTrial = FieldValue.delete();
    updates.trialType = FieldValue.delete();
  }

  // Determine access tier
  updates.accessTier = determineAccessTierFromStates(
    boardState,
    cmeState,
    userData,
    updates,
    creditIncrement
  );

  // Build diagnostic info
  diagnostic.boardSubscription = boardState
    ? {
        productIdentifier: boardState.productIdentifier,
        subscriptionId: boardState.subscriptionId,
        active: boardState.isActive,
        trialing: boardState.isTrialing,
        expirationMs: boardState.expirationMs || null,
        source: 'direct',
      }
    : cmeState && cmeState.catalogEntry.grantsBoardReview
    ? {
        productIdentifier: cmeState.productIdentifier,
        subscriptionId: cmeState.subscriptionId,
        active: cmeState.isActive,
        trialing: cmeState.isTrialing,
        expirationMs: cmeState.expirationMs || null,
        source: 'cme_grant',
      }
    : null;

  diagnostic.cmeSubscription = cmeState
    ? {
        productIdentifier: cmeState.productIdentifier,
        subscriptionId: cmeState.subscriptionId,
        active: cmeState.isActive,
        trialing: cmeState.isTrialing,
        expirationMs: cmeState.expirationMs || null,
        source: 'direct',
      }
    : null;

  return { updates, diagnostic };
}

// -----------------------------------------------------------------------------
// Helper: Update Firestore with user subscription state
// -----------------------------------------------------------------------------
async function updateFirestoreWithUserSubscription(appUserId, eventId, eventType, updates, diagnostic) {
  if (!appUserId) {
    throw new Error('Missing app_user_id in webhook payload.');
  }

  if (!eventId) {
    throw new Error('Missing event id in webhook payload.');
  }

  const userRef = db.collection('users').doc(appUserId);
  const eventsRef = userRef.collection('revenuecat_events').doc(eventId);

  const existingEvent = await eventsRef.get();
  if (existingEvent.exists) {
    logger.info('Skipping RevenueCat webhook because event was already processed.', { appUserId, eventId });
    return;
  }

  try {
    const userSnapshot = await userRef.get();
    if (!userSnapshot.exists) {
      logger.warn(
        'No existing Firebase user document matched the RevenueCat app_user_id. Ensure the RevenueCat app_user_id is the Firebase Auth UID for this customer.',
        { appUserId, eventId }
      );
    }
  } catch (userReadError) {
    logger.error('Failed to check existing Firebase user document for RevenueCat app_user_id.', {
      appUserId,
      eventId,
      error: userReadError.message,
    });
  }

  const finalUpdates = {
    ...updates,
    lastRevenueCatEventId: eventId,
    lastRevenueCatEventType: eventType,
    lastRevenueCatEventAt: FieldValue.serverTimestamp(),
  };

  await userRef.set(finalUpdates, { merge: true });

  const eventLog = {
    id: eventId,
    eventType,
    processedAt: FieldValue.serverTimestamp(),
  };

  if (diagnostic) {
    eventLog.boardSubscription = diagnostic.boardSubscription || null;
    eventLog.cmeSubscription = diagnostic.cmeSubscription || null;
    eventLog.creditPurchase = diagnostic.creditPurchase || null;
  }

  await eventsRef.set(eventLog, { merge: true });
}

// -----------------------------------------------------------------------------
// Utility: Resolve event id from webhook payload
// -----------------------------------------------------------------------------
function resolveEventId(eventPayload) {
  if (!eventPayload) {
    return null;
  }

  return eventPayload.id || eventPayload.event_id || eventPayload.webhook_id || eventPayload.transaction_id || null;
}

function coerceAppUserId(candidate) {
  if (!candidate) {
    return null;
  }
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      const resolved = coerceAppUserId(item);
      if (resolved) {
        return resolved;
      }
    }
  }
  return null;
}

function resolveAppUserId(body) {
  if (!body) {
    return null;
  }

  const event = body.event || {};
  const subscriber = event.subscriber || body.subscriber || {};
  const purchasedProduct = event.purchased_product || {};
  const transaction = event.transaction || purchasedProduct.transaction || {};
  const storeTransaction =
    event.store_transaction ||
    purchasedProduct.store_transaction ||
    body.store_transaction ||
    {};

  const subscriberAttrs =
    event.subscriber_attributes ||
    body.subscriber_attributes ||
    subscriber.subscriber_attributes ||
    {};

  const candidates = [
    event.app_user_id,
    event.appUserId,
    event.appUserID,
    subscriber.app_user_id,
    subscriber.alias,
    subscriber.aliases,
    body.app_user_id,
    body.appUserId,
    body.appUserID,
    event.alias,
    event.aliases,
    purchasedProduct.app_user_id,
    purchasedProduct.appUserId,
    transaction.app_user_id,
    transaction.appUserId,
    transaction.appUserID,
    storeTransaction.app_user_id,
    storeTransaction.appUserId,
    storeTransaction.appUserID,
    event.original_app_user_id,
    body.original_app_user_id,
    subscriber.original_app_user_id,
    subscriberAttrs.firebase_uid?.value,
    subscriberAttrs.firebaseUid?.value,
    subscriberAttrs.firebase_uid,
    subscriberAttrs.firebaseUid,
  ];

  for (const candidate of candidates) {
    const resolved = coerceAppUserId(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function resolveTransferAppUserIds(body) {
  if (!body) {
    return { from: null, to: null };
  }

  const event = body.event || {};
  const subscriber = event.subscriber || body.subscriber || {};

  const fromCandidates = [
    event.transferred_from,
    event.transferredFrom,
    event.transfer_from,
    event.transferFrom,
    event.original_app_user_id,
    subscriber.original_app_user_id,
    body.original_app_user_id,
  ];

  const toCandidates = [
    event.transferred_to,
    event.transferredTo,
    event.transfer_to,
    event.transferTo,
    event.new_app_user_id,
    event.newAppUserId,
    event.app_user_id,
    subscriber.app_user_id,
    body.app_user_id,
  ];

  const aliases = []
    .concat(Array.isArray(event.aliases) ? event.aliases : [])
    .concat(Array.isArray(subscriber.aliases) ? subscriber.aliases : [])
    .concat(Array.isArray(body.aliases) ? body.aliases : []);

  const from = coerceAppUserId(fromCandidates);
  let to = coerceAppUserId(toCandidates);

  if (!to && aliases.length) {
    const cleanedAliases = aliases
      .map((alias) => (typeof alias === 'string' ? alias.trim() : alias))
      .filter((alias) => typeof alias === 'string' && alias.length > 0);

    if (from) {
      to = cleanedAliases.find((alias) => alias !== from) || null;
    }

    if (!to && cleanedAliases.length) {
      to = cleanedAliases[cleanedAliases.length - 1];
    }
  }

  return { from, to };
}

// -----------------------------------------------------------------------------
// Main webhook handler
// -----------------------------------------------------------------------------
const revenuecatWebhook = onRequest(
    { 
      timeoutSeconds: 60, 
      memory: '256MiB',
      secrets: ['REVENUECAT_WEBHOOK_SECRET', 'REVENUECAT_API_KEY', 'REVENUECAT_WEBHOOK_AUTH_HEADER']
    }, 
    async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    if (!verifyRevenueCatWebhook(req)) {
      res.status(401).send('Unauthorized');
      return;
    }

    const eventPayload = req.body?.event || req.body;
    const eventType = eventPayload?.event_type || eventPayload?.type || 'UNKNOWN';
    const transferIds = eventType === 'TRANSFER' ? resolveTransferAppUserIds(req.body) : null;
    const appUserId = (transferIds && transferIds.to) ? transferIds.to : resolveAppUserId(req.body);
    const eventId = resolveEventId(eventPayload);

    if (!appUserId) {
      const diagnosticPayload = {
        eventType,
        eventId,
        transferIds,
        rootKeys: Object.keys(req.body || {}),
        eventKeys: Object.keys(eventPayload || {}),
        hasSubscriber: !!eventPayload?.subscriber,
        subscriberKeys: Object.keys(eventPayload?.subscriber || {}),
      };

      if (eventType === 'TRANSFER') {
        logger.info('Ignoring RevenueCat TRANSFER webhook without app_user_id.', diagnosticPayload);
        res.status(200).send({ received: true, ignored: 'transfer_without_app_user_id' });
        return;
      }

      logger.warn('RevenueCat webhook missing app_user_id.', diagnosticPayload);
      res.status(200).send({ received: true, error: 'missing_app_user_id' });
      return;
    }

    if (typeof appUserId === 'string' && appUserId.startsWith('$RCAnonymousID:')) {
      logger.warn('Skipping RevenueCat webhook for anonymous app_user_id.', {
        appUserId,
        eventType,
        eventId,
      });
      res.status(200).send({ received: true, ignored: 'anonymous_app_user_id' });
      return;
    }

    if (!eventId) {
      logger.warn('RevenueCat webhook missing event id. Continuing without idempotency protection.', { appUserId });
    }

    logger.info('Processing RevenueCat webhook event.', {
      appUserId,
      eventType,
      eventId,
      transferIds,
      hasSubscriber: !!eventPayload?.subscriber,
      rootKeys: Object.keys(req.body || {}),
      eventKeys: Object.keys(eventPayload || {}),
    });

    // Fetch current user data to pass to transformation function
    let userData = {};
    try {
      const userRef = db.collection('users').doc(appUserId);
      const userSnapshot = await userRef.get();
      if (userSnapshot.exists) {
        userData = userSnapshot.data();
      }
    } catch (userFetchError) {
      logger.warn('Could not fetch existing user data for transformation.', {
        appUserId,
        error: userFetchError.message,
      });
    }

    let subscriberData = null;
    try {
      subscriberData = await fetchSubscriberData(appUserId);
    } catch (apiError) {
      // If fetching subscriber data fails, we still want to acknowledge the webhook
      res.status(200).send({ received: true, error: 'Failed to fetch subscriber data.' });
      return;
    }

    const { updates, diagnostic } = transformRevenueCatToUserUpdates(subscriberData, req.body, userData);

    if (!diagnostic.boardSubscription && !diagnostic.cmeSubscription && !diagnostic.creditPurchase?.detected) {
      logger.info('RevenueCat webhook contained no mapped subscriptions or credits.', { appUserId, eventId });
    }

    try {
      const effectiveEventId = eventId || `${appUserId}-${Date.now()}`;
      await updateFirestoreWithUserSubscription(appUserId, effectiveEventId, eventType, updates, diagnostic);
    } catch (firestoreError) {
      logger.error('Failed to update Firestore with RevenueCat subscription data.', {
        appUserId,
        eventId,
        error: firestoreError.message,
      });
      res.status(200).send({ received: true, error: 'Firestore update failed.' });
      return;
    }

    res.status(200).send({ received: true });
  } catch (error) {
    logger.error('Unhandled RevenueCat webhook error.', { error: error.message, stack: error.stack });
    res.status(200).send({ received: true });
  }
});

module.exports = {
  revenuecatWebhook,
  verifyRevenueCatWebhook,
  fetchSubscriberData,
  transformRevenueCatToUserUpdates,
  updateFirestoreWithUserSubscription,
  resolveEventId,
  resolveAppUserId,
};
