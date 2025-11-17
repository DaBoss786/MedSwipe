const { logger } = require("firebase-functions/v2");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const fetch = global.fetch || require("node-fetch");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const oneSignalAppIdSecret = defineSecret("ONESIGNAL_APP_ID");
const oneSignalApiKeySecret = defineSecret("ONESIGNAL_API_KEY");

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const { FieldValue } = admin.firestore;

const USERS_COLLECTION = "users";
const QUESTIONS_COLLECTION = "questions";
const QUESTION_QUERY_LIMIT = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getDateFromField(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isUserDueForPush(userData = {}, nowDate = new Date()) {
  if (!userData.notificationOptIn) {
    return { due: false, reason: "opted_out" };
  }

  if (!userData.oneSignalId) {
    return { due: false, reason: "missing_oneSignalId" };
  }

  const frequency = Number.parseInt(userData.notificationFrequencyDays, 10);
  if (!Number.isInteger(frequency) || frequency <= 0) {
    return { due: false, reason: "invalid_notification_frequency" };
  }

  const lastPushDate = getDateFromField(userData.lastPushSentAt);
  if (!lastPushDate) {
    return { due: true, reason: "never_sent" };
  }

  const elapsedMs = nowDate.getTime() - lastPushDate.getTime();
  const elapsedDays = Math.floor(elapsedMs / MS_PER_DAY);

  if (elapsedDays >= frequency) {
    return { due: true, reason: `elapsed_${elapsedDays}_days` };
  }

  return {
    due: false,
    reason: `waiting_${frequency - elapsedDays}_days`,
  };
}

async function pickQuestionForUser(userData = {}) {
  const specialty = (userData.specialty || "").trim();
  if (!specialty) {
    return null;
  }

  let questionQuery = db
    .collection(QUESTIONS_COLLECTION)
    .where("specialty", "==", specialty);

  if (userData.accessTier === "free_guest") {
    questionQuery = questionQuery.where("Free", "==", true);
  }

  const snapshot = await questionQuery.limit(QUESTION_QUERY_LIMIT).get();

  if (snapshot.empty) {
    return null;
  }

  const docs = snapshot.docs;
  const randomIndex = Math.floor(Math.random() * docs.length);
  const chosenDoc = docs[randomIndex];

  return {
    id: chosenDoc.id,
    data: chosenDoc.data(),
  };
}

function loadOneSignalCredentials() {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;
  return { appId, apiKey };
}

async function sendOneSignalNotification(playerId, questionId, specialty) {
  const { appId, apiKey } = loadOneSignalCredentials();
  if (!appId || !apiKey) {
    throw new Error("OneSignal credentials are not configured.");
  }

  if (!playerId || !questionId) {
    throw new Error("Missing playerId or questionId for OneSignal message.");
  }

  const trimmedSpecialty = (specialty || "").trim();
  const heading = trimmedSpecialty
    ? `Daily ${trimmedSpecialty} Question`
    : "Daily Question";

  const deepLink = `https://medswipeapp.com/question/${encodeURIComponent(questionId)}`;

  const payload = {
    app_id: appId,
    include_player_ids: [playerId],
    headings: { en: heading },
    contents: { en: "Quick high-yield question for you." },
    // Use additional data instead of url
    data: {
      questionId: questionId,
      deep_link: deepLink
    },
    // Remove url field or ensure fallback only
    // url: deepLink,  <-- REMOVE or comment out for iOS deep-link suppression
    delayed_option: "timezone",
    delivery_time_of_day: "21:00"
  };

  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `OneSignal API error (${response.status}): ${responseText || "Unknown error"}`
    );
  }

  let responseBody = null;
  if (responseText) {
    try {
      responseBody = JSON.parse(responseText);
    } catch (parseError) {
      logger.warn("Failed to parse OneSignal response JSON.", {
        error: parseError.message,
      });
    }
  }

  logger.info("OneSignal notification queued.", {
    playerId,
    questionId,
  });

  return responseBody;
}


async function processUserDocument(userDoc, nowDate) {
  const userData = userDoc.data() || {};
  const userId = userDoc.id;
  const dueCheck = isUserDueForPush(userData, nowDate);

  if (!dueCheck.due) {
    logger.info("Skipping user for daily push.", {
      userId,
      reason: dueCheck.reason,
    });
    return { userId, status: "skipped", reason: dueCheck.reason };
  }

  const specialty = (userData.specialty || "").trim();
  if (!specialty) {
    logger.warn("User missing specialty; skipping push.", {
      userId,
    });
    return { userId, status: "skipped", reason: "missing_specialty" };
  }

  try {
    const question = await pickQuestionForUser(userData);

    if (!question) {
      logger.warn("No matching question for user.", { userId });
      return { userId, status: "skipped", reason: "no_question" };
    }

    await sendOneSignalNotification(
      userData.oneSignalId,
      question.id,
      userData.specialty
    );

    await userDoc.ref.update({
      lastPushSentAt: FieldValue.serverTimestamp(),
      lastQuestionId: question.id,
    });

    logger.info("Scheduled daily question push.", {
      userId,
      questionId: question.id,
    });

    return { userId, status: "sent", questionId: question.id };
  } catch (error) {
    logger.error("Failed to send push notification.", {
      userId,
      error: error.message,
    });

    return { userId, status: "error", error: error.message };
  }
}

exports.sendDailyQuestionPushes = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/Los_Angeles",
    secrets: [oneSignalAppIdSecret, oneSignalApiKeySecret],
  },
  async () => {
    const { appId, apiKey } = loadOneSignalCredentials();
    if (!appId || !apiKey) {
      logger.error(
        "ONESIGNAL_APP_ID or ONESIGNAL_API_KEY is not configured."
      );
      return null;
    }

    const nowDate = new Date();
    const usersSnapshot = await db
      .collection(USERS_COLLECTION)
      .where("notificationOptIn", "==", true)
      .get();

    if (usersSnapshot.empty) {
      logger.info("No users with notification opt-in found.");
      return null;
    }

    const results = await Promise.all(
      usersSnapshot.docs.map((doc) => processUserDocument(doc, nowDate))
    );

    const summary = results.reduce(
      (acc, result) => {
        acc[result.status] = (acc[result.status] || 0) + 1;
        return acc;
      },
      { sent: 0, skipped: 0, error: 0 }
    );

    logger.info("Finished sendDailyQuestionPushes run.", summary);
    return null;
  }
);

// ───────────────────────────────
// Temporary HTTP endpoint for testing
// ───────────────────────────────
exports.testSendPush = onRequest({ secrets: [oneSignalAppIdSecret, oneSignalApiKeySecret] }, async (req, res) => {
  try {
    const testPlayerId   = "27ad9523-ae06-4d0e-b9f7-8ff1334b81e5"; // your provided ID
    const testQuestionId = "Which condition is characterized by recurrent facial nerve palsies, facial edema, and a fissured tongue?";
    const testSpecialty  = "ENT";

    const result = await sendOneSignalNotification(
      testPlayerId,
      testQuestionId,
      testSpecialty
    );
    res.status(200).send({ success: true, result });
  } catch (error) {
    logger.error("Error sending test push:", { error: error.message });
    res.status(500).send({ success: false, error: error.message });
  }
});
