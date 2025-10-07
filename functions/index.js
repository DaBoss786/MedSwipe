// functions/index.js
// --- v2 Imports ---
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https"); // For webhook
const { logger } = require("firebase-functions/v2"); // <<<< KEEP THIS ONE (or one like it)
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore"); 

// --- Other Imports ---
const admin = require("firebase-admin");
const stripe = require("stripe"); // Assuming you still use stripe
const { defineString } = require("firebase-functions/params");
const { PDFDocument, StandardFonts, rgb, degrees } = require("pdf-lib");
const crypto = require("crypto");
const axios = require("axios"); // For MailerLite
const { revenuecatWebhook } = require("./revenuecatWebhook");

exports.revenuecatWebhook = revenuecatWebhook;


// Initialize Firebase Admin SDK only once
if (admin.apps.length === 0) {
  admin.initializeApp();
  logger.info("Firebase Admin SDK initialized.");
} else {
  logger.info("Firebase Admin SDK already initialized.");
}

// Initialize Firestore DB INSTANCE - THIS IS CRITICAL
const db = admin.firestore(); // Use the initialized db instance from your global scope
logger.info("Firestore db object initialized in module scope. typeof db:", typeof db, "Is db truthy?", !!db);
if (!db || typeof db.collection !== 'function') {
    logger.error("CRITICAL FAILURE: admin.firestore() did not return a valid db instance at module scope! Re-initializing...");
    db = admin.firestore(); // Try re-initializing immediately
    logger.info("Attempted re-initialization. typeof db:", typeof db, "Is db truthy now?", !!db);
}

// --- Define Configuration Parameters (Keep as is) ---
// These define the secrets your functions need access to
//const stripeSecretKeyParam = defineString("STRIPE_SECRET_KEY"); // Simpler definition is fine
//const stripeWebhookSecretParam = defineString("STRIPE_WEBHOOK_SECRET");
// --- End Configuration Parameters ---


// --- Configuration for PDF Generation (Keep as is) ---
const BUCKET_NAME = "medswipe-648ee.firebasestorage.app";
const LOGO1_FILENAME_IN_BUCKET = "MedSwipe Logo gradient.png";
const LOGO2_FILENAME_IN_BUCKET = "CME consultants.jpg";
const storage = admin.storage();
const bucket = storage.bucket(BUCKET_NAME);
// --- End PDF Configuration ---

// --- Shared Subscription Helpers -------------------------------------------------
const timestampToMillis = (value) => {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }

  return 0;
};

const SUBSCRIPTION_CONFIG = {
  cme: {
    activeField: "cmeSubscriptionActive",
    endField: "cmeSubscriptionEndDate",
    trialField: "cmeSubscriptionTrialEndDate",
    altTrialField: "boardReviewTrialEndDate",
    trialTypeValue: "cme_annual",
  },
  boardReview: {
    activeField: "boardReviewActive",
    endField: "boardReviewSubscriptionEndDate",
    trialField: "boardReviewTrialEndDate",
    altTrialField: "cmeSubscriptionTrialEndDate",
    trialTypeValue: "board_review",
  },
};

const resolveEffectiveEnd = (userData = {}, config) => {
  const subscriptionEndMs = timestampToMillis(userData[config.endField]);
  if (subscriptionEndMs > 0) {
    return { millis: subscriptionEndMs, source: "subscription" };
  }

  const trialEndMs = timestampToMillis(userData[config.trialField]);
  if (trialEndMs > 0) {
    return { millis: trialEndMs, source: "trial" };
  }

  const hasMatchingTrial =
    !!userData.hasActiveTrial &&
    (!config.trialTypeValue || userData.trialType === config.trialTypeValue);

  if (hasMatchingTrial && config.altTrialField) {
    const altTrialEndMs = timestampToMillis(userData[config.altTrialField]);
    if (altTrialEndMs > 0) {
      return { millis: altTrialEndMs, source: "alternateTrial" };
    }
  }

  return { millis: 0, source: "none" };
};

const computeSubscriptionWindow = (userData = {}, config, nowMs = Date.now()) => {
  const { millis, source } = resolveEffectiveEnd(userData, config);
  const isActiveFlag = !!userData[config.activeField];
  const hasEndDate = millis > 0;
  const endInFuture = hasEndDate && millis > nowMs;

  return {
    activeFlag: isActiveFlag,
    stillActive: isActiveFlag,
    fallbackActive: !isActiveFlag && endInFuture,
    effectiveEndMs: millis,
    endSource: source,
    usedTrialFallback: source === "trial" || source === "alternateTrial",
  };
};

const determineAccessTier = (userData = {}) => {
  const credits = Number(userData.cmeCreditsAvailable || 0);

  if (userData.cmeSubscriptionActive) return "cme_annual";
  if (userData.boardReviewActive) return "board_review";
  if (credits > 0) return "cme_credits_only";
  return "free_guest";
};

const formatWindowForResponse = (window) => ({
  activeFlag: window.activeFlag,
  stillActive: window.stillActive,
  fallbackActive: window.fallbackActive,
  effectiveEndMillis: window.effectiveEndMs > 0 ? window.effectiveEndMs : null,
  effectiveEndIso:
    window.effectiveEndMs > 0 ? new Date(window.effectiveEndMs).toISOString() : null,
  endSource: window.endSource,
  usedTrialFallback: window.usedTrialFallback,
});

const recomputeAccessTierFromData = (userData = {}, nowMs = Date.now()) => {
  const originalCmeWindow = computeSubscriptionWindow(userData, SUBSCRIPTION_CONFIG.cme, nowMs);
  const originalBoardWindow = computeSubscriptionWindow(userData, SUBSCRIPTION_CONFIG.boardReview, nowMs);

  const updates = {};

  const updatedUserData = { ...userData };
  const updatedCmeWindow = originalCmeWindow;
  const updatedBoardWindow = originalBoardWindow;

  const newAccessTier = determineAccessTier(updatedUserData);

  if (userData.accessTier !== newAccessTier) {
    updates.accessTier = newAccessTier;
  }

  return {
    updates,
    newAccessTier,
    originalCmeWindow,
    updatedCmeWindow,
    originalBoardWindow,
    updatedBoardWindow,
    updatedUserData,
  };
};

exports.__TESTING__ = {
  determineAccessTier,
  recomputeAccessTierFromData,
  computeSubscriptionWindow,
  resolveEffectiveEnd,
  timestampToMillis,
};
// --- End Shared Subscription Helpers --------------------------------------------

// --- Helper Function to Get Active CME Year ID ---
/**
 * Fetches all CME windows and determines which one is currently active.
 * @returns {Promise<string|null>} The document ID of the active CME window (e.g., "2025-2026"), or null if none is active.
 */
async function getActiveYearId() {
  // Ensure db is accessible here too
  if (!db) {
    logger.error("getActiveYearId: db is not defined!");
    throw new HttpsError("internal", "Database service unavailable in getActiveYearId.");
  }

  const now = admin.firestore.Timestamp.now();
  const cmeWindowsRef = admin.firestore().collection("cmeWindows");

  try {
    const snapshot = await cmeWindowsRef.get();
    if (snapshot.empty) {
      logger.warn("No CME windows defined in 'cmeWindows' collection.");
      return null;
    }

    for (const doc of snapshot.docs) {
      const windowData = doc.data();
      if (windowData.startDate && windowData.endDate) {
        // Ensure startDate and endDate are Firestore Timestamps
        const startDate = windowData.startDate instanceof admin.firestore.Timestamp
          ? windowData.startDate
          : admin.firestore.Timestamp.fromDate(new Date(windowData.startDate)); // Fallback if not already a Timestamp
        const endDate = windowData.endDate instanceof admin.firestore.Timestamp
          ? windowData.endDate
          : admin.firestore.Timestamp.fromDate(new Date(windowData.endDate)); // Fallback

        if (now.seconds >= startDate.seconds && now.seconds <= endDate.seconds) {
          logger.info(`Active CME window found: ${doc.id}`);
          return doc.id; // This is the yearId (e.g., "2025-2026")
        }
      } else {
        logger.warn(`CME window ${doc.id} is missing startDate or endDate.`);
      }
    }

    logger.info("No currently active CME window found for today's date.");
    return null;
  } catch (error) {
    logger.error("Error fetching active CME year ID:", error);
    throw new HttpsError("internal", "Could not determine active CME year."); // Or return null and handle in calling function
  }
}
// --- End Helper Function ---


// --------------------------------------------------------------------------
//  generateCmeCertificate  – MODIFIED TO HANDLE CLAIM LOGIC
// ---------------------------------------------------------------------------

exports.generateCmeCertificate = onCall(
  {
    secrets: [], 
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    /* ───────── 1. Auth & Input Validation ───────── */
    if (!request.auth) {
      logger.error("generateCmeCertificate: Unauthenticated access attempt.");
      throw new HttpsError("unauthenticated", "Please log in.");
    }
    const uid = request.auth.uid;
    const { certificateFullName, creditsToClaim, certificateDegree, evaluationData } = request.data;

    if (!certificateFullName || typeof certificateFullName !== 'string' || certificateFullName.trim() === "") {
      throw new HttpsError("invalid-argument", "Please provide a valid full name.");
    }
    if (typeof creditsToClaim !== "number" || creditsToClaim <= 0 || creditsToClaim % 0.25 !== 0) {
      throw new HttpsError("invalid-argument", "Invalid credits amount.");
    }
    if (!certificateDegree || typeof certificateDegree !== 'string' || certificateDegree.trim() === "") {
      throw new HttpsError("invalid-argument", "Please provide a valid degree.");
    }
    if (!evaluationData || typeof evaluationData !== 'object') {
        throw new HttpsError("invalid-argument", "Evaluation data is missing or invalid.");
    }
    logger.info(`generateCmeCertificate called by UID: ${uid} for ${creditsToClaim} credits.`);

    const claimTimestamp = admin.firestore.Timestamp.now();

    /* ───────── 2. Firestore Transaction (Claim Logic) ───────── */
    const userRef = db.collection("users").doc(uid);
    try {
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) { // <<< FIX #1
                throw new HttpsError("not-found", "User data not found. Cannot process claim.");
            }

            const data = userDoc.data();
            const hasActiveAnnualSub = data.cmeSubscriptionActive === true;
            const cmeStats = data.cmeStats || { creditsEarned: 0, creditsClaimed: 0 };
            const availableOneTimeCredits = data.cmeCreditsAvailable || 0;

            if (!hasActiveAnnualSub && availableOneTimeCredits < creditsToClaim) {
                throw new HttpsError("failed-precondition", `Insufficient credits. Available: ${availableOneTimeCredits.toFixed(2)}, Trying to claim: ${creditsToClaim}`);
            }

            const newCreditsClaimed = (parseFloat(cmeStats.creditsClaimed) || 0) + creditsToClaim;
            const updatedCmeStats = { ...cmeStats, creditsClaimed: parseFloat(newCreditsClaimed.toFixed(2)) };

            const newHistoryEntry = {
                timestamp: claimTimestamp,
                creditsClaimed: creditsToClaim,
                evaluationData: evaluationData,
            };
            const updatedHistory = [...(data.cmeClaimHistory || []), newHistoryEntry];

            let updates = {
                cmeStats: updatedCmeStats,
                cmeClaimHistory: updatedHistory,
            };

            if (!hasActiveAnnualSub) {
                updates.cmeCreditsAvailable = admin.firestore.FieldValue.increment(-creditsToClaim);
            }

            transaction.set(userRef, updates, { merge: true });
            logger.info(`Successfully processed claim transaction for user ${uid}.`);
        });
    } catch (error) {
        logger.error(`Error in CME claim transaction for user ${uid}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Failed to update your credit balance. Please try again.");
    }

    /* ───────── 3. PDF Generation (No changes to this part) ───────── */
    const rounded = Math.round(creditsToClaim * 4) / 4;
    let formattedCredits = rounded.toFixed(2);
    if (formattedCredits.endsWith("00") || formattedCredits.endsWith("50"))
      formattedCredits = rounded.toFixed(1);

    const claimDateStr = claimTimestamp.toDate().toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([792, 612]);
    const { width, height } = page.getSize();
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    
    const CENTER_LOGO_FILENAME = "MedSwipe Logo gradient.png";
    let centerLogoImg  = null;
    let centerLogoDims = { width: 0, height: 0 };
    try {
      const [bytes] = await bucket.file(CENTER_LOGO_FILENAME).download();
      centerLogoImg = CENTER_LOGO_FILENAME.toLowerCase().endsWith(".png")
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);
      centerLogoDims = centerLogoImg.scale(45 / centerLogoImg.height);
    } catch {
      logger.warn(`Logo ${CENTER_LOGO_FILENAME} not found – falling back to text.`);
    }
    const gray = rgb(0.15, 0.15, 0.15);
    const center = (txt, font, size, y, col = gray) => {
      const w = font.widthOfTextAtSize(txt, size);
      page.drawText(txt, { x: (width - w) / 2, y, size, font, color: col });
      return y - size - 6;
    };
    const centerMixed = (leftTxt, leftFont, rightTxt, rightFont, size, y) => {
      const leftW  = leftFont .widthOfTextAtSize(leftTxt , size);
      const rightW = rightFont.widthOfTextAtSize(rightTxt, size);
      const xStart = (width - (leftW + rightW)) / 2;
      page.drawText(leftTxt , { x: xStart       , y, size, font: leftFont , color: gray });
      page.drawText(rightTxt, { x: xStart+leftW , y, size, font: rightFont, color: gray });
      return y - size - 6;
    };
    const borderM   = 24;
    page.drawRectangle({
      x: borderM, y: borderM, width:  width  - 2 * borderM, height: height - 2 * borderM,
      borderWidth: 2, borderColor: rgb(0.45, 0.45, 0.45),
    });
    let y = height - 90;
    y = center("CME Consultants", fontBold, 24, y);
    y = center("in association with", fontRegular, 12, y);
    if (centerLogoImg) {
      page.drawImage(centerLogoImg, {
        x: (width - centerLogoDims.width) / 2, y: y - centerLogoDims.height,
        width:  centerLogoDims.width, height: centerLogoDims.height,
      });
      y -= centerLogoDims.height + 20;
    } else {
      y = center("MedSwipe", fontBold, 20, y);
      y -= 20;
    }
    y = center("Certifies that:", fontRegular, 14, y);
    y = center(certificateFullName, fontBold, 22, y, rgb(0, 0.3, 0.6));
    y = center("has participated in the enduring material titled", fontRegular, 12, y);
    y = center("“MedSwipe ENT CME Module”", fontBold, 14, y);
    y = center("on", fontRegular, 12, y);
    y = center(claimDateStr, fontRegular, 14, y);
    if (certificateDegree === "MD" || certificateDegree === "DO") {
        y = center("and is awarded", fontRegular, 12, y);
        y = centerMixed(`${formattedCredits} `, fontBold, "AMA PRA Category 1 Credits™", fontItalic, 14, y);
        y -= 24;
        const accLines = [
          "This activity has been planned and implemented in accordance with the",
          "accreditation requirements and policies of the Accreditation Council for",
          "Continuing Medical Education (ACCME) through the joint providership of",
          "CME Consultants and MedSwipe. CME Consultants is accredited by the ACCME",
          "to provide continuing medical education for physicians.",
          "",
          "CME Consultants designates this enduring material for a maximum of 24.0 AMA PRA Category 1 Credits™.",
          "Physicians should claim only the credit commensurate with the extent of their participation in the activity."
        ];
        const accSize = 9;
        accLines.forEach((ln) => {
          if (ln.includes("AMA PRA Category 1 Credits™")) {
            const [pre] = ln.split("AMA PRA Category 1 Credits™");
            const fullW = fontRegular.widthOfTextAtSize(pre, accSize) + fontItalic.widthOfTextAtSize("AMA PRA Category 1 Credits™", accSize);
            const xStart = (width - fullW) / 2;
            page.drawText(pre, { x: xStart, y, size: accSize, font: fontRegular, color: gray });
            page.drawText("AMA PRA Category 1 Credits™", { x: xStart + fontRegular.widthOfTextAtSize(pre, accSize), y, size: accSize, font: fontItalic, color: gray });
          } else {
            const w = fontRegular.widthOfTextAtSize(ln, accSize);
            page.drawText(ln, { x: (width - w) / 2, y, size: accSize, font: ln.startsWith("CME Consultants designates") ? fontBold : fontRegular, color: gray });
          }
          y -= accSize + 2;
        });
    } else {
        y = center(`and attended ${formattedCredits} hours of this accredited activity.`, fontRegular, 12, y);
        y -= 6;
        y = centerMixed("(This activity was designated for 24.0 ", fontRegular, "AMA PRA Category 1 Credits™)", fontItalic, 10, y);
        y -= 18;
        const nonMdFooterLines = [
            "CME Consultants is accredited by the Accreditation Council for Continuing Medical",
            "Education (ACCME) to provide continuing medical education for physicians."
        ];
        const nonMdFooterSize = 9;
        nonMdFooterLines.forEach((ln) => {
            const w = fontRegular.widthOfTextAtSize(ln, nonMdFooterSize);
            page.drawText(ln, { x: (width - w) / 2, y, size: nonMdFooterSize, font: fontRegular, color: gray });
            y -= nonMdFooterSize + 2;
        });
    }

    /* ───────── 4. Save, Upload, and Update History ───────── */
    const pdfBytes = await pdfDoc.save();
    const safeName = certificateFullName.replace(/[^a-zA-Z0-9]/g, "_");
    const filePath = `cme_certificates/${uid}/${Date.now()}_${safeName}_CME.pdf`;
    const pdfFileName = filePath.split('/').pop();

    await bucket.file(filePath).save(Buffer.from(pdfBytes), {
      metadata: { contentType: "application/pdf" },
    });
    logger.info(`PDF saved to GCS at: ${filePath}`);

    try {
        const userDoc = await userRef.get();
        if (userDoc.exists) { // <<< FIX #2
            let history = userDoc.data().cmeClaimHistory || [];
            const historyIndex = history.findIndex(entry =>
                entry.timestamp && entry.timestamp.isEqual(claimTimestamp)
            );
            if (historyIndex > -1) {
                history[historyIndex].filePath = filePath;
                history[historyIndex].pdfFileName = pdfFileName;
                await userRef.update({ cmeClaimHistory: history });
                logger.info(`Successfully updated history entry at index ${historyIndex} with filePath.`);
            } else {
                 logger.error(`Could not find history entry with timestamp ${claimTimestamp.toDate().toISOString()} to update with filePath.`);
            }
        }
    } catch (updateError) {
        logger.error("Error updating Firestore history with certificate filePath:", updateError);
    }

    return { success: true, filePath: filePath };
  }
);



/*  ────────────────────────────────────────────────────────────────
    Stripe Webhook Handler – FULLY REPLACED
    Handles:
      • Board-Review subscription   (tier = "board_review")
      • CME-Annual  subscription    (tier = "cme_annual")
      • One-time CME-Credit bundle  (tier = "cme_credit")
    ──────────────────────────────────────────────────────────────── */
    exports.stripeWebhookHandler = onRequest(
      {
        region: "us-central1",
        timeoutSeconds: 180, // Increased timeout slightly for more complex logic
        memory: "256MiB",
        secrets: ["STRIPE_WEBHOOK_SECRET", "STRIPE_SECRET_KEY"],
      },
      async (req, res) => {
        const stripeSecret = process.env.STRIPE_SECRET_KEY;
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
        if (!stripeSecret || !webhookSecret) {
          logger.error("Stripe keys missing from environment for webhook.");
          return res.status(500).send("Server mis-configured (webhook keys).");
        }
        const stripeClient = stripe(stripeSecret);
    
        if (req.method === "GET") return res.status(200).send("Webhook OK");
    
        let event;
        try {
          event = stripeClient.webhooks.constructEvent(
            req.rawBody,
            req.headers["stripe-signature"],
            webhookSecret
          );
        } catch (err) {
          logger.error("⚠️ Webhook signature verification failed:", err.message);
          return res.status(400).send(`Webhook Error: ${err.message}`);
        }
    
        const dataObject = event.data.object;
        logger.info(`Received Stripe event: ${event.type}, ID: ${event.id}`);
    
    
        // --- Handle checkout.session.completed ---
        if (event.type === "checkout.session.completed") {
          const session = dataObject;
          let uid = session.client_reference_id;
const tier = session.metadata?.tier || "unknown";
const planName = session.metadata?.planName || "Subscription";
const paid = session.payment_status === "paid";
const custId = session.customer;
const customerEmail = session.customer_email || session.customer_details?.email;

// If no UID, try to find user by email
if (!uid && customerEmail) {
  // Normalize email to lowercase for consistent matching
  const normalizedEmail = customerEmail.toLowerCase().trim();
  logger.info(`No UID provided, attempting to find user with email: ${normalizedEmail}`);
  
  const usersQuery = await admin.firestore()
    .collection('users')
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();
  
  if (!usersQuery.empty) {
    uid = usersQuery.docs[0].id;
    console.log(`Found user ${uid} with email ${normalizedEmail}`);
  } else {
    console.error(`No user found with email ${normalizedEmail}`);
    return res.status(200).send("No user found with provided email");
  }
}
    
          logger.info(`➡️ checkout.session.completed: ${session.id} | tier=${tier} | mode=${session.mode} | uid=${uid} | paid=${paid}`);
    
          if (!uid || !paid) {
            logger.warn("No uid or not paid in checkout.session.completed – aborting Firestore write.");
            return res.status(200).send("No-op (uid/paid check)");
          }
    
          const userRef = admin.firestore().collection("users").doc(uid);
          const updates = {
            stripeCustomerId: custId,
            isRegistered: true, // User made a purchase, so they are registered
            lastStripeEvent: admin.firestore.Timestamp.now(),
            lastStripeEventType: event.type,
          };
    
          let newAccessTier = "free_guest"; // Default, will be updated

          // Handle one-time payment for 2-week CME free trial
if (session.mode === "payment") {
  const lineItems = await stripeClient.checkout.sessions.listLineItems(session.id, { limit: 1 });
  const firstItem = lineItems.data?.[0];
  
  // Check if this is YOUR SPECIFIC CME trial price ID
  if (firstItem?.price?.id === "price_1RpNIGJDkW3cIYXu6OeJF8QE") { // <-- Replace with your actual price ID
    logger.info("Processing 2-week CME free trial (one-time payment)");
    
    // Calculate end date as 2 weeks from now
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);
    
    const startTS = admin.firestore.Timestamp.fromDate(startDate);
    const endTS = admin.firestore.Timestamp.fromDate(endDate);
    
    Object.assign(updates, {
      // CME Annual settings
      cmeSubscriptionActive: true,
      cmeSubscriptionPlan: "2 Week Free Trial",
      cmeSubscriptionStartDate: startTS,
      cmeSubscriptionEndDate: endTS,
      cmeSubscriptionTrialEndDate: endTS,
      cmeSubscriptionId: null,
      
      // CME Annual ALSO includes Board Review
      boardReviewActive: true,
      boardReviewTier: "Granted by CME Trial",
      boardReviewSubscriptionStartDate: startTS,
      boardReviewSubscriptionEndDate: endTS,
      boardReviewTrialEndDate: endTS,
      
      // Trial flags
      hasActiveTrial: true,
      trialType: "cme_annual_2week_free"
    });
    
    newAccessTier = "cme_annual";
    
    // Update Firestore and return early
    updates.accessTier = newAccessTier;
    await userRef.set(updates, { merge: true });
    logger.info(`✅ Firestore updated for ${uid} - 2 week CME trial activated`);
    return res.status(200).send("OK (CME trial activated)");
  }
}
    
          if (session.mode === "subscription") {
            const subId = session.subscription;
            if (!subId) {
              logger.error("No subscription ID on session for checkout.session.completed");
              return res.status(200).send("No subId in session");
            }

            // ─── AUTO-CANCEL FREE-YEAR PROMO ───
            //
            // If the user applied a promotion code whose metadata contains
            // freeYear=true, tell Stripe to stop the subscription at the
            // end of its very first billing period (one year).
            //
            if (session.discounts?.length) {
              try {
                const promoId = session.discounts[0].promotion_code;
                const promo   = await stripeClient.promotionCodes.retrieve(promoId);

                if (promo?.metadata?.freeYear === "true") {
                  await stripeClient.subscriptions.update(subId, {
                    cancel_at_period_end: true,
                  });
                  logger.info(`Auto-cancel scheduled for free-year promo sub ${subId}`);
                }
              } catch (err) {
                logger.error("Auto-cancel routine failed:", err);
              }
            }
            // ── END AUTO-CANCEL BLOCK ──
            
            let subscription; // This is the Stripe subscription object from the event
            try {
              // In your original code, 'subscription' here was the Stripe subscription object.
              // It was retrieved to get period start/end.
              subscription = await stripeClient.subscriptions.retrieve(subId, { expand: ["items"] });
            } catch (err) {
              logger.error("Subscription fetch failed for checkout.session.completed:", err);
              return res.status(200).send("Sub fetch failed"); // Original behavior
            }
    
            const item0 = subscription.items?.data?.[0] || {};
            const startUnix = item0.current_period_start ?? subscription.current_period_start;
            const endUnix = item0.current_period_end ?? subscription.current_period_end;
            const startTS = startUnix ? admin.firestore.Timestamp.fromMillis(startUnix * 1000) : null;
            const endTS = endUnix ? admin.firestore.Timestamp.fromMillis(endUnix * 1000) : null;
    
            if (tier === "board_review") {
              Object.assign(updates, {
                boardReviewActive: true,
                boardReviewTier: planName,
                boardReviewSubscriptionId: subId,
                boardReviewSubscriptionStartDate: startTS ?? admin.firestore.FieldValue.serverTimestamp(),
                boardReviewSubscriptionEndDate: endTS,
                boardReviewTrialEndDate: endTS, // Explicitly store trial end date
                hasActiveTrial: true, // ADD THIS LINE
    trialType: "board_review" // ADD THIS LINE
              });
              newAccessTier = "board_review";
            } else if (tier === "cme_annual") {
              Object.assign(updates, {
                cmeSubscriptionActive: true,
                cmeSubscriptionPlan: planName,
                cmeSubscriptionId: subId,
                cmeSubscriptionStartDate: startTS ?? admin.firestore.FieldValue.serverTimestamp(),
                cmeSubscriptionEndDate: endTS,
                cmeSubscriptionTrialEndDate: endTS, // Explicitly store trial end date
                hasActiveTrial: true, // ADD THIS LINE
    trialType: "cme_annual", // ADD THIS LINE
                // CME Annual also grants Board Review access
                boardReviewActive: true, 
                boardReviewTier: "Granted by CME Annual",
                boardReviewSubscriptionId: subId, // Can use the same subId for tracking
                boardReviewSubscriptionStartDate: startTS ?? admin.firestore.FieldValue.serverTimestamp(),
                boardReviewSubscriptionEndDate: endTS,
                boardReviewTrialEndDate: endTS, // Also for BR granted by CME Annual
              });
              newAccessTier = "cme_annual";
            } else {
              logger.warn(`Unhandled subscription tier "${tier}" in checkout.session.completed`);
            }
          } else if (session.mode === "payment") {
            if (tier === "cme_credits") {
              let credits = parseInt(session.metadata?.credits ?? "0", 10);
              if (!credits) {
                try {
                  const items = await stripeClient.checkout.sessions.listLineItems(session.id, { limit: 1 });
                  credits = items.data?.[0]?.quantity ?? 1;
                } catch (err) { credits = 1; }
              }
              Object.assign(updates, {
                cmeCreditsAvailable: admin.firestore.FieldValue.increment(credits),
                lastCmeCreditPurchaseDate: admin.firestore.Timestamp.now(),
              });
              // Determine access tier after incrementing credits
              // We need to fetch current user data to see if they have an active cme_annual sub
              try {
                const userDoc = await userRef.get();
                if (userDoc.exists) {
                    const currentData = userDoc.data();
                    const tempUpdatedData = { ...currentData, ...updates, cmeCreditsAvailable: (currentData.cmeCreditsAvailable || 0) + credits };
                    newAccessTier = determineAccessTier(tempUpdatedData);
                } else {
                    // New user, only credits
                    newAccessTier = "cme_credits_only";
                }
              } catch (docError) {
                logger.error("Error fetching user doc for tier determination after credit purchase:", docError);
                newAccessTier = "cme_credits_only"; // Fallback
              }
    
            } else {
              logger.warn(`Unhandled payment tier "${tier}" in checkout.session.completed`);
            }
          } else {
            logger.warn(`Unhandled session mode "${session.mode}" in checkout.session.completed`);
          }
    
          updates.accessTier = newAccessTier; // Set the determined access tier
    
          await userRef.set(updates, { merge: true });
          logger.info(`✅ Firestore updated for ${uid} from checkout.session.completed. New accessTier: ${newAccessTier}`);
          return res.status(200).send("OK (checkout.session.completed)");
        }
    
        // --- Handle customer.subscription.updated, customer.subscription.deleted ---
        // These events handle changes like renewals, cancellations, and expirations.
        if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
          const subscription = dataObject; // This is the Stripe subscription object from the event
          const customerId = subscription.customer;
          const status = subscription.status;
          const cancelAtPeriodEnd = subscription.cancel_at_period_end;
      
          logger.info(`Subscription details: ID=${subscription.id}, Status=${status}, CancelAtPeriodEnd=${cancelAtPeriodEnd}, Start=${subscription.current_period_start}, End=${subscription.current_period_end}`);
      
          const usersQuery = admin.firestore().collection("users").where("stripeCustomerId", "==", customerId);
          const querySnapshot = await usersQuery.get();
    
          if (querySnapshot.empty) {
            logger.warn(`No user found with Stripe Customer ID: ${customerId} for event ${event.type}`);
            return res.status(200).send("No user for customer ID");
          }
    
          const userDoc = querySnapshot.docs[0];
          const uid = userDoc.id;
          const userRef = userDoc.ref;
          const userData = userDoc.data();
    
          const updates = {
            lastStripeEvent: admin.firestore.Timestamp.now(),
            lastStripeEventType: event.type,
          };
    
          // Original logic for planName and tier determination
          const planName = subscription.metadata?.planName || userData.boardReviewTier || userData.cmeSubscriptionPlan || "Subscription";
          const tier = subscription.metadata?.tier || (userData.boardReviewActive ? "board_review" : (userData.cmeSubscriptionActive ? "cme_annual" : "unknown"));
    
          const isActiveStatus = status === "active" || status === "trialing";
          
          // --- Define startTS and endTS safely --- (This block was from your original)
          let startTS = null;
          let endTS   = null;

          const startSec = Number(subscription.current_period_start);
          if (Number.isFinite(startSec) && startSec > 0) {
            startTS = admin.firestore.Timestamp.fromMillis(startSec * 1000);
          } else {
            logger.warn(
              `Subscription ${subscription.id} has invalid current_period_start: ${subscription.current_period_start}`
            );
          }

          const endSec = Number(subscription.current_period_end);
          if (Number.isFinite(endSec) && endSec > 0) {
            endTS = admin.firestore.Timestamp.fromMillis(endSec * 1000);
          } else {
            logger.warn(
              `Subscription ${subscription.id} has invalid current_period_end: ${subscription.current_period_end}`
            );
          }
          // --- End safe definition ---


          // Update specific subscription type fields
          if (tier === "board_review") {
            updates.boardReviewActive = isActiveStatus;
            updates.boardReviewTier = isActiveStatus ? planName : "Expired/Canceled";
            updates.boardReviewWillCancelAtPeriodEnd = cancelAtPeriodEnd;
            if (status !== "trialing") { // If no longer in trial (active, canceled, past_due, etc.)
              updates.boardReviewTrialEndDate = admin.firestore.FieldValue.delete();
              updates.hasActiveTrial = admin.firestore.FieldValue.delete(); // ADD THIS LINE
    updates.trialType = admin.firestore.FieldValue.delete(); // ADD THIS LINE
          }

            if (isActiveStatus) {
                updates.boardReviewSubscriptionStartDate = startTS || admin.firestore.FieldValue.delete();
                updates.boardReviewSubscriptionEndDate = endTS || admin.firestore.FieldValue.delete();
            } else {
                // If not active, we might want to keep the end date or clear it
                // For now, we'll rely on boardReviewActive: false
            }
          } else if (tier === "cme_annual") {
            updates.cmeSubscriptionActive = isActiveStatus;
            updates.cmeSubscriptionPlan = isActiveStatus ? planName : "Expired/Canceled";
            updates.cmeSubscriptionWillCancelAtPeriodEnd = cancelAtPeriodEnd;
            if (status !== "trialing") { // If no longer in trial
              updates.cmeSubscriptionTrialEndDate = admin.firestore.FieldValue.delete();
              updates.hasActiveTrial = admin.firestore.FieldValue.delete(); // ADD THIS LINE
    updates.trialType = admin.firestore.FieldValue.delete(); // ADD THIS LINE
          }

            if (isActiveStatus) {
              updates.cmeSubscriptionStartDate = startTS || admin.firestore.FieldValue.delete();
              updates.cmeSubscriptionEndDate = endTS || admin.firestore.FieldValue.delete();
            }

             // CME Annual also affects Board Review status
            updates.boardReviewActive = isActiveStatus;
            updates.boardReviewTier = isActiveStatus
                ? "Granted by CME Annual"
                : (userData.boardReviewActive ? "Expired/Canceled" : userData.boardReviewTier); // Original logic here
                if (status !== "trialing") { // If no longer in trial for CME Annual
                  updates.boardReviewTrialEndDate = admin.firestore.FieldValue.delete(); // Clear BR trial end too
              }

            if (isActiveStatus) {
                if (startTS) updates.boardReviewSubscriptionStartDate = startTS;
                if (endTS) updates.boardReviewSubscriptionEndDate = endTS;
            }
        } else {
            logger.warn(`Unhandled subscription tier "${tier}" in ${event.type}`);
        }

        const potentiallyUpdatedUserData = { ...userData, ...updates };
        updates.accessTier = determineAccessTier(potentiallyUpdatedUserData);

        await userRef.set(updates, { merge: true });
        logger.info(`Firestore updated for ${uid} from ${event.type}. New accessTier: ${updates.accessTier}`);

        // --- START: New MailerLite Trial Status Sync ---
        // If the subscription is no longer active, update MailerLite
        if (!isActiveStatus && userData.email) {
            const mailerLiteApiKey = process.env.MAILERLITE_API_KEY;
            if (mailerLiteApiKey) {
                logger.info(`Subscription for ${userData.email} ended. Updating MailerLite 'is_on_trial' to false.`);
                try {
                    await axios.post(
                        `https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(userData.email)}`,
                        {
                            fields: {
                                is_on_trial: "false",
                            },
                        },
                        {
                            headers: {
                                "Authorization": `Bearer ${mailerLiteApiKey}`,
                                "Content-Type": "application/json",
                                "Accept": "application/json",
                            },
                        }
                    );
                    logger.info(`Successfully updated MailerLite trial status for ${userData.email}.`);
                } catch (apiError) {
                    logger.error(`Failed to update MailerLite trial status for ${userData.email}.`, apiError.response?.data || apiError.message);
                }
            }
        }
        // --- END: New MailerLite Trial Status Sync ---

        return res.status(200).send(`OK (${event.type})`);
    }
        
        // --- Handle invoice.payment_failed ---
        if (event.type === 'invoice.payment_failed') {
            const invoice = dataObject;
            const customerId = invoice.customer;
            const subscriptionId = invoice.subscription; // ID of the subscription that failed
    
            logger.info(`➡️ Invoice payment failed for Sub ID: ${subscriptionId}, Cust ID: ${customerId}`);
    
            if (!customerId || !subscriptionId) {
                logger.warn("Invoice.payment_failed: Missing customer or subscription ID.");
                return res.status(200).send("Missing info for payment_failed");
            }
    
            const usersQuery = admin.firestore().collection("users").where("stripeCustomerId", "==", customerId);
            const querySnapshot = await usersQuery.get();
    
            if (querySnapshot.empty) {
                logger.warn(`No user found with Stripe Customer ID: ${customerId} for invoice.payment_failed`);
                return res.status(200).send("No user for customer ID (payment_failed)");
            }
            
            const userDoc = querySnapshot.docs[0];
            const uid = userDoc.id;
            const userRef = userDoc.ref;
            const userData = userDoc.data();
            
            const updates = {
                lastStripeEvent: admin.firestore.Timestamp.now(),
                lastStripeEventType: event.type,
            };
    
            // Determine which subscription failed and mark it inactive
            if (userData.boardReviewSubscriptionId === subscriptionId) {
                updates.boardReviewActive = false;
                updates.boardReviewTier = "Payment Failed";
                logger.info(`Marking Board Review inactive for user ${uid} due to payment failure.`);
            }
            if (userData.cmeSubscriptionId === subscriptionId) {
                updates.cmeSubscriptionActive = false;
                updates.cmeSubscriptionPlan = "Payment Failed";
                // If CME Annual fails, Board Review granted by it also becomes inactive
                updates.boardReviewActive = false; 
                updates.boardReviewTier = "Payment Failed (CME Annual)";
                logger.info(`Marking CME Annual (and associated Board Review) inactive for user ${uid} due to payment failure.`);
            }
    
            // Re-determine accessTier
            const potentiallyUpdatedUserData = { ...userData, ...updates };
            updates.accessTier = determineAccessTier(potentiallyUpdatedUserData);
    
            await userRef.set(updates, { merge: true });
            logger.info(`✅ Firestore updated for ${uid} from invoice.payment_failed. New accessTier: ${updates.accessTier}`);
            return res.status(200).send("OK (invoice.payment_failed)");
        }
    
    
        logger.info(`Webhook event ${event.type} (ID: ${event.id}) not explicitly handled or no action taken.`);
        return res.status(200).send("OK (event not handled)");
      }
    );
    // --- END OF ORIGINAL stripeWebhookHandler ---
    
    
    
    /*  ────────────────────────────────────────────────────────────────
        createStripeCheckoutSession – FULLY REPLACED
        Builds sessions for:
          • Board-Review subscription
          • CME-Annual  subscription
          • CME-Credit  one-time bundle (quantity ≥1)
        ──────────────────────────────────────────────────────────────── */
    exports.createStripeCheckoutSession = onCall(
      {
        region: "us-central1",
        memory: "256MiB",
        secrets: ["STRIPE_SECRET_KEY"],
      },
      async (req) => {
        if (!req.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }
        const uid        = req.auth.uid;
        const priceId    = req.data.priceId;        // required
        const planName   = req.data.planName || "Subscription";
        const tier       = req.data.tier;           // required on client
        let   quantity   = req.data.quantity || 1;  // only for credits
    
        if (!priceId || typeof priceId !== "string")
          throw new HttpsError("invalid-argument", "priceId missing.");
    
        if (!tier || typeof tier !== "string")
          throw new HttpsError("invalid-argument", "tier missing.");
    
        /* Detect mode – anything with tier === cme_credit → payment */
        const creditPriceId = "price_1RXcdsJDkW3cIYXuKTLAM472"; // <-- your one-time price
        const mode = tier === "cme_credits" || priceId === creditPriceId
          ? "payment"
          : "subscription";
    
        /* subscriptions always quantity 1 */
        if (mode === "subscription") quantity = 1;
    
        const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);
        const APP_URL      = "https://medswipeapp.com";
    
        const params = {
          mode,
          payment_method_types: ["card"],
          client_reference_id: uid,
          line_items: [{ price: priceId, quantity }],
          success_url: `${APP_URL}/checkout-success.html`,
          cancel_url : `${APP_URL}/checkout-cancel.html?tier=${encodeURIComponent(tier)}`,
          metadata: {
            planName,
            tier,
            ...(mode === "payment" ? { credits: String(quantity) } : {}),
          },
          allow_promotion_codes: true,
        };
    
        if (mode === "subscription") {
          params.subscription_data = {
            metadata: { planName, tier },
            // Add a 7-day trial period for all subscriptions
            trial_period_days: 7,
          };
        }
    
        const session = await stripeClient.checkout.sessions.create(params);
        logger.info(`🟢 session ${session.id} | mode=${mode} | tier=${tier}`);
        return { sessionId: session.id };
      }
    );
    


// --- Callable Function to Create Stripe Customer Portal Session ---
exports.createStripePortalSession = onCall(
  {
    region: "us-central1", // Or your preferred region
    memory: "256MiB",
    secrets: ["STRIPE_SECRET_KEY"] // Needs the secret key
  },
  async (request) => {
    logger.log("createStripePortalSession called.");

    // 1. Auth check
    if (!request.auth) {
      logger.error("Portal Session: Authentication failed.");
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    const uid = request.auth.uid;
    logger.log(`Portal Session: Authenticated user: ${uid}`);

    // 2. Initialize Stripe Client
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      logger.error("CRITICAL: Portal Session: Stripe secret key missing.");
      throw new HttpsError("internal", "Server config error [SK].");
    }
    const stripeClient = stripe(secretKey);
    logger.info("Portal Session: Stripe client initialized.");

    // 3. Get Stripe Customer ID from Firestore
    let stripeCustomerId;
    try {
      const userDocRef = admin.firestore().collection('users').doc(uid);
      const userDocSnap = await userDocRef.get();

      if (!userDocSnap.exists) {
        logger.error(`Portal Session: User document not found for UID: ${uid}`);
        throw new HttpsError("not-found", "User data not found.");
      }
      stripeCustomerId = userDocSnap.data()?.stripeCustomerId; // Get the stored ID

      if (!stripeCustomerId) {
        logger.error(`Portal Session: Stripe Customer ID not found in Firestore for UID: ${uid}`);
        throw new HttpsError("failed-precondition", "Subscription not found for this user.");
      }
       logger.log(`Portal Session: Found Stripe Customer ID: ${stripeCustomerId} for UID: ${uid}`);

    } catch (dbError) {
      logger.error(`Portal Session: Firestore lookup failed for UID ${uid}:`, dbError);
      throw new HttpsError("internal", "Failed to retrieve user data.");
    }

    // 4. Define Return URL (Where user comes back *after* portal)
    const YOUR_APP_BASE_URL = "https://medswipeapp.com"; // <<< Double-check this URL
    const returnUrl = `${YOUR_APP_BASE_URL}/`; // Return to dashboard/homepage

    // 5. Create the Stripe Billing Portal Session
    try {
      const portalSession = await stripeClient.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: returnUrl,
      });

      logger.log(`Portal Session: Created Stripe Portal Session ${portalSession.id} for Customer ${stripeCustomerId}`);
      // 6. Return the Portal Session URL to the client
      return { portalUrl: portalSession.url };

    } catch (error) {
      logger.error(`Portal Session: Error creating Stripe Portal Session for Customer ${stripeCustomerId}:`, error);
      throw new HttpsError("internal", `Failed to create portal session: ${error.message}`);
    }
  }
); // End createStripePortalSession

// --- Add this entire new function right here ---

exports.getCertificateDownloadUrl = onCall(
  {
    secrets: [], // No secrets needed for this one
    region: "us-central1",
  },
  async (request) => {
    // 1. Authentication Check
    if (!request.auth) {
      logger.error("getCertificateDownloadUrl: Unauthenticated access attempt.");
      throw new HttpsError("unauthenticated", "You must be logged in to download certificates.");
    }
    const uid = request.auth.uid;

    // 2. Input Validation
    const { filePath } = request.data;
    if (!filePath || typeof filePath !== 'string') {
      throw new HttpsError("invalid-argument", "A valid file path must be provided.");
    }

    // 3. CRITICAL: Ownership Verification
    // Ensure the requested file path belongs to the user making the request.
    // The path format is `cme_certificates/${uid}/...`
    if (!filePath.startsWith(`cme_certificates/${uid}/`)) {
        logger.error(`SECURITY VIOLATION: User ${uid} attempted to access forbidden path ${filePath}`);
        throw new HttpsError("permission-denied", "You do not have permission to access this file.");
    }

    // 4. Generate the Signed URL
    try {
      const options = {
        version: "v4",
        action: "read",
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      };

      // Get a signed URL for the file
      const [signedUrl] = await admin.storage().bucket(BUCKET_NAME).file(filePath).getSignedUrl(options);
      
      logger.info(`Successfully generated signed URL for user ${uid} for file ${filePath}`);
      return { success: true, downloadUrl: signedUrl };

    } catch (error) {
      logger.error(`Error generating signed URL for ${filePath}:`, error);
      if (error.code === 404) {
          throw new HttpsError("not-found", "The requested certificate file does not exist.");
      }
      throw new HttpsError("internal", "Could not generate the download link. Please try again.");
    }
  }
);

// --- Callable Function to Record CME Answer and Award Credits Annually ---
// --- Define Configuration Parameters (Keep as is from your file) ---
const ACCURACY_THRESHOLD = 0.70;  // 70 % required for credit
const MINUTES_PER_QUESTION = 4.8;   // avg time per Q
const MINUTES_PER_QUARTER_CREDIT = 15;    // 0.25 credit ÷ 15 min
const MAX_CME_CREDITS_PER_YEAR = 24;    // annual cap (renamed from MAX_CME_CREDITS for clarity with your existing constant)
// --- End Configuration Parameters ---

exports.recordCmeAnswerV2 = onCall(
  {
    region: "us-central1", // Or your preferred region
    memory: "512MiB",
    timeoutSeconds: 60,
  },
  async (event) => { // 'event' contains 'auth' and 'data'

    /* 1. Authentication check */
    if (!event.auth) {
      logger.error("recordCmeAnswerV2: Authentication failed. No auth context.");
      throw new HttpsError("unauthenticated", "Please log in first.");
    }
    const uid = event.auth.uid;
    logger.info(`recordCmeAnswerV2: Called by authenticated user: ${uid}`);

    /* 2. Validate payload */
    const { questionId, category, isCorrect /*, timeSpent is not used in this version but could be added */ } = event.data;
    if (!questionId || typeof questionId !== "string" || questionId.trim() === "") {
      logger.error("recordCmeAnswerV2: Validation failed. Invalid questionId.", { data: event.data });
      throw new HttpsError("invalid-argument", "A valid question ID (questionId) is required.");
    }
    if (!category || typeof category !== "string" || category.trim() === "") {
      logger.error("recordCmeAnswerV2: Validation failed. Invalid category.", { data: event.data });
      throw new HttpsError("invalid-argument", "A valid category is required.");
    }
    if (typeof isCorrect !== "boolean") {
      logger.error("recordCmeAnswerV2: Validation failed. Invalid isCorrect flag.", { data: event.data });
      throw new HttpsError("invalid-argument", "A boolean 'isCorrect' flag is required.");
    }
    logger.info(`recordCmeAnswerV2: Processing for QID (text): "${questionId.substring(0, 50)}...", Correct: ${isCorrect}`);


    /* 3. Resolve current CME-year */
    const activeYearId = await getActiveYearId(); // Uses your existing async function
    if (!activeYearId) {
      logger.warn(`recordCmeAnswerV2: No active CME year found. Cannot record answer for user ${uid}.`);
      // Match the return structure of successful calls for consistency if client expects it
      return {
        status: "no_active_year",
        message: "No active CME accreditation year. Credits cannot be awarded at this time.",
        creditedThisAnswer: 0,
        newYearTotalCredits: 0,
        totalAnsweredInYear: 0,
        activeYearId: null
      };
      // Or throw: throw new HttpsError("failed-precondition", "No active CME year could be determined.");
    }
    logger.info(`recordCmeAnswerV2: Active CME Year ID: ${activeYearId} for user ${uid}.`);

    // 3.5 Check User's Access Tier (copied from your existing function)
    const userDocRefForTierCheck = db.collection("users").doc(uid); // db is your global Firestore instance
    const userDocSnapForTierCheck = await userDocRefForTierCheck.get();
    if (!userDocSnapForTierCheck.exists) {
        logger.error(`recordCmeAnswerV2: User document not found for UID: ${uid}.`);
        throw new HttpsError("not-found", "User data not found. Cannot process CME answer.");
    }
    const userDataForTierCheck = userDocSnapForTierCheck.data();
    const accessTier = userDataForTierCheck.accessTier;
    if (accessTier !== "cme_annual" && accessTier !== "cme_credits_only") {
        logger.info(`recordCmeAnswerV2: User ${uid} has accessTier '${accessTier}', not eligible for CME credits for QID "${questionId.substring(0,50)}...".`);
        return {
            status: "tier_ineligible",
            message: "Your current subscription tier is not eligible for CME credits.",
            creditedThisAnswer: 0,
            newYearTotalCredits: 0,
            totalAnsweredInYear: 0,
            activeYearId: activeYearId
        };
    }
    logger.info(`recordCmeAnswerV2: User ${uid} has eligible tier '${accessTier}'.`);


    /* 4. Build doc refs */
    const questionHash = crypto.createHash("sha256").update(questionId).digest("hex");
    const answerDocId  = `${activeYearId}_${questionHash}`;

    const answerRef    = db.collection("users").doc(uid)
                           .collection("cmeAnswers").doc(answerDocId);
    const yearStatsRef = db.collection("users").doc(uid)
                           .collection("cmeStats").doc(activeYearId);
    const userRef      = db.collection("users").doc(uid); // This is userDocRefForTierCheck

    /* 5. Single Firestore transaction */
    const result = await db.runTransaction(async (tx) => {

      /* 5a. Pull docs */
      // userSnap is already fetched as userDocSnapForTierCheck, but for transaction consistency, get it again or pass its data.
      // For simplicity in adapting, let's re-fetch within transaction.
      const [answerSnap, yearSnap, userSnapTx] = await Promise.all([
        tx.get(answerRef),
        tx.get(yearStatsRef),
        tx.get(userRef) // Fetch user doc again inside transaction
      ]);

      /* Ensure aggregate objects exist */
      let userData = userSnapTx.exists ? userSnapTx.data() : {}; // Use the transaction-fetched user data
      if (!userData.cmeStats) {
        userData.cmeStats = { totalAnswered: 0, totalCorrect: 0, creditsEarned: 0.00, creditsClaimed: 0.00 };
      } else { // Ensure all sub-fields exist
        userData.cmeStats.totalAnswered = userData.cmeStats.totalAnswered || 0;
        userData.cmeStats.totalCorrect = userData.cmeStats.totalCorrect || 0;
        userData.cmeStats.creditsEarned = userData.cmeStats.creditsEarned || 0.00;
        userData.cmeStats.creditsClaimed = userData.cmeStats.creditsClaimed || 0.00;
      }


      let yearData = yearSnap.exists
        ? { totalAnsweredInYear: 0, totalCorrectInYear: 0, creditsEarned: 0.00, ...yearSnap.data() }
        : { totalAnsweredInYear: 0, totalCorrectInYear: 0, creditsEarned: 0.00 };
      // Ensure creditsEarned is a number for calculations
      yearData.creditsEarned = parseFloat(yearData.creditsEarned || 0);


      /* 5b. Handle scenarios */
      let messageForLog = "";
      if (!answerSnap.exists) {                                      // ❶ First attempt
        messageForLog = "First attempt";
        tx.set(answerRef, {
          originalQuestionId: questionId, // Store the full text
          answeredAt: admin.firestore.FieldValue.serverTimestamp(),
          isCorrect,
          category
        });

        yearData.totalAnsweredInYear += 1;
        if (isCorrect) yearData.totalCorrectInYear += 1;

        userData.cmeStats.totalAnswered += 1;
        if (isCorrect) userData.cmeStats.totalCorrect += 1;

      } else if (answerSnap.data().isCorrect === true) {             // ❷ Already correct
        logger.info(`recordCmeAnswerV2: Question (hash: ${questionHash}) already correctly recorded for user ${uid} in year ${activeYearId}.`);
        return {
          status:               "already_correct", // More specific status
          message:              "You already earned credit for this question this year.",
          creditedThisAnswer:   0,
          newYearTotalCredits:  yearData.creditsEarned,
          totalAnsweredInYear:  yearData.totalAnsweredInYear,
          activeYearId,
          // For client-side UI updates, mirror structure of your old function if needed
          overallCreditsEarned: parseFloat(userData.cmeStats.creditsEarned.toFixed(2)),
          overallTotalAnswered: userData.cmeStats.totalAnswered,
          overallTotalCorrect:  userData.cmeStats.totalCorrect,
        };

      } else if (answerSnap.data().isCorrect === false && isCorrect) { // ❸ Fix a miss
        messageForLog = "Fixing a miss";
        tx.update(answerRef, {
          isCorrect:  true,
          correctedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        yearData.totalCorrectInYear += 1; // Only increment correct, not answered again
        userData.cmeStats.totalCorrect += 1; // Overall correct count up

      } else { // isCorrect is false, and previous answer was also false (or some other edge case)
        messageForLog = "Repeat incorrect or no change";
         logger.info(`recordCmeAnswerV2: Question (hash: ${questionHash}) previously incorrect, and still incorrect for user ${uid} in year ${activeYearId}.`);
        // Optionally, update a 'lastAttemptAt' timestamp on answerRef if desired
        // tx.update(answerRef, { lastAttemptAt: admin.firestore.FieldValue.serverTimestamp() });
        return {
          status:               "still_incorrect", // More specific
          message:              "Answer recorded. Accuracy for this question this year remains unchanged.",
          creditedThisAnswer:   0,
          newYearTotalCredits:  yearData.creditsEarned,
          totalAnsweredInYear:  yearData.totalAnsweredInYear,
          activeYearId,
          overallCreditsEarned: parseFloat(userData.cmeStats.creditsEarned.toFixed(2)),
          overallTotalAnswered: userData.cmeStats.totalAnswered,
          overallTotalCorrect:  userData.cmeStats.totalCorrect,
        };
      }
      logger.info(`recordCmeAnswerV2: Scenario for ${uid}, year ${activeYearId}, QID_hash ${questionHash}: ${messageForLog}`);

      /* 5c. Recalculate credits */
      const accuracy  = yearData.totalAnsweredInYear > 0
        ? yearData.totalCorrectInYear / yearData.totalAnsweredInYear
        : 0;

      let prevCreditsInYear = yearData.creditsEarned; // This is already a float from init
      let newCreditsInYear  = prevCreditsInYear;

      if (accuracy >= ACCURACY_THRESHOLD) {
        const minutes       = yearData.totalAnsweredInYear * MINUTES_PER_QUESTION;
        const quarterCreds  = Math.round(minutes / MINUTES_PER_QUARTER_CREDIT); // Rounds to nearest 0.25
        newCreditsInYear    = Math.min(quarterCreds * 0.25, MAX_CME_CREDITS_PER_YEAR);
      }

      // Ensure calculations are with floats and then toFixed for storage/comparison
      const creditedThisAnswerDelta = parseFloat((newCreditsInYear - prevCreditsInYear).toFixed(2));
      yearData.creditsEarned   = parseFloat(newCreditsInYear.toFixed(2));


      /* 5d. Persist aggregates */
      yearData.lastUpdated = admin.firestore.FieldValue.serverTimestamp();
      tx.set(yearStatsRef, yearData, { merge: true }); // yearData contains all necessary fields

      // Update overall (lifetime) creditsEarned
      // Ensure userData.cmeStats.creditsEarned is a number
      const currentOverallCreditsEarned = parseFloat(userData.cmeStats.creditsEarned || 0);
      userData.cmeStats.creditsEarned = parseFloat(
        (currentOverallCreditsEarned + creditedThisAnswerDelta).toFixed(2)
      );
      tx.set(userRef, { cmeStats: userData.cmeStats }, { merge: true }); // Only merge cmeStats field

      /* 5e. Return */
      let finalStatus = "no_change";
      let finalMessage = "Answer recorded. No change in credits earned this answer.";

      if (creditedThisAnswerDelta > 0) {
          finalStatus = "success";
          finalMessage = `Answer recorded. ${creditedThisAnswerDelta.toFixed(2)} credits earned this answer for year ${activeYearId}.`;
      } else if (yearData.creditsEarned >= MAX_CME_CREDITS_PER_YEAR) {
          finalStatus = "limit_reached";
          finalMessage = `Answer recorded. Yearly credit limit for ${activeYearId} reached.`;
      } else if (accuracy < ACCURACY_THRESHOLD && yearData.totalAnsweredInYear > 0) {
          finalStatus = "accuracy_low";
          finalMessage = `Answer recorded. Yearly accuracy for ${activeYearId} (${(accuracy*100).toFixed(0)}%) below threshold for new credits.`;
      }


      logger.info(`recordCmeAnswerV2: Transaction for user ${uid}, year ${activeYearId}, QID_hash: ${questionHash} successful. Credits this answer (year): ${creditedThisAnswerDelta.toFixed(2)}, New total for year: ${yearData.creditsEarned.toFixed(2)}, Total answered in year: ${yearData.totalAnsweredInYear}, New OVERALL earned: ${userData.cmeStats.creditsEarned.toFixed(2)}, Overall answered: ${userData.cmeStats.totalAnswered}`);

      return {
        status: finalStatus,
        message: finalMessage,
        creditedThisAnswer: creditedThisAnswerDelta, // The actual change from this event
        newYearTotalCredits: yearData.creditsEarned, // Total for the year after this event
        totalAnsweredInYear: yearData.totalAnsweredInYear,
        activeYearId,
        // Add overall stats for client convenience, similar to your old function
        overallCreditsEarned: userData.cmeStats.creditsEarned,
        overallTotalAnswered: userData.cmeStats.totalAnswered,
        overallTotalCorrect:  userData.cmeStats.totalCorrect,
      };
    }); // end transaction

    logger.info(`recordCmeAnswerV2 Final Result for ${uid} → Status: ${result.status}, Message: ${result.message}`);
    return result;
  }
);
// --- End Callable Function recordCmeAnswerV2 ---

exports.initializeNewUser = onDocumentCreated("users/{userId}", async (event) => {
  const userDocRef = event.data.ref;
  const user = event.data.data();
  const uid = event.params.userId;

  logger.info(`Initializing new user document for UID: ${uid}`);

  // Determine if the user is registered based on whether an email exists.
  const isRegistered = !!user.email;

  const defaultSensitiveData = {
    isRegistered: isRegistered,
    accessTier: "free_guest",
    boardReviewActive: false,
    boardReviewSubscriptionEndDate: null,
    cmeSubscriptionActive: false,
    cmeSubscriptionEndDate: null,
    cmeCreditsAvailable: 0,
    stripeCustomerId: null,
    mailerLiteSubscriberId: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  try {
    // Use .update() here. It will not overwrite existing fields from the client
    // like username, createdAt, etc. It only adds the new default fields.
    await userDocRef.update(defaultSensitiveData);
    logger.info(`Successfully initialized sensitive fields for user: ${uid}`);
    return null;
  } catch (error) {
    logger.error(`Error initializing user ${uid}:`, error);
    return null;
  }
});


// This function is called by the client when a user finalizes their registration.
// It now includes logic to check for and apply promotional access.
exports.finalizeRegistration = onCall(
  { region: "us-central1", memory: "512MiB" }, // Increased memory slightly for safety
  async (request) => {
    // 1. Authentication check (as before)
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please log in to register.");
    }
    const uid = request.auth.uid;
    // Normalize email to prevent issues with capitalization
    const email = request.auth.token.email.toLowerCase().trim();

    // 2. Input validation (as before, now including referrerId)
    const { username, marketingOptIn, referrerId } = request.data;
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      throw new HttpsError("invalid-argument", "A valid username is required.");
    }
    if (typeof marketingOptIn !== 'boolean') {
      throw new HttpsError("invalid-argument", "A valid marketing preference is required.");
    }

    logger.info(`Finalizing registration for UID: ${uid} with email: ${email}`);

    // 3. --- NEW: Check for an available promotion ---
    const promotionsRef = db.collection('promotions');
    const promoQuery = promotionsRef
      .where('email', '==', email)
      .where('status', '==', 'available')
      .limit(1);

    const promoSnapshot = await promoQuery.get();
    const promoDoc = promoSnapshot.empty ? null : promoSnapshot.docs[0];

    // 4. Prepare the base user data for Firestore
    const updateData = {
      username: username,
      email: email,
      isRegistered: true,
      marketingOptIn: marketingOptIn,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // --- START: New Referral Logic ---
    // If a valid referrerId was passed from the client, add it to the data to be saved.
    if (referrerId && typeof referrerId === 'string' && referrerId.trim().length > 0) {
      logger.info(`User ${uid} was referred by ${referrerId}. Adding to document.`);
      updateData.referredBy = referrerId;
  }
  // --- END: New Referral Logic ---

    // 5. --- NEW: If a promotion was found, add subscription fields ---
    if (promoDoc) {
      const promoData = promoDoc.data();
      logger.info(`Found available promotion ${promoDoc.id} for user ${uid}.`);

      const now = new Date();
      // Calculate the end date by adding the duration days
      const endDate = new Date(now.getTime() + promoData.durationDays * 24 * 60 * 60 * 1000);
      const endDateTimestamp = admin.firestore.Timestamp.fromDate(endDate);

      // Set the user's access tier based on the promotion
      updateData.accessTier = promoData.accessTier;

      // Add the specific subscription fields based on the tier
      if (promoData.accessTier === 'cme_annual') {
        updateData.cmeSubscriptionActive = true;
        updateData.cmeSubscriptionEndDate = endDateTimestamp;
        // CME Annual also grants Board Review access
        updateData.boardReviewActive = true;
        updateData.boardReviewSubscriptionEndDate = endDateTimestamp;
        updateData.boardReviewTier = `Promotional Access (${promoData.durationDays} days)`;
      } else if (promoData.accessTier === 'board_review') {
        updateData.boardReviewActive = true;
        updateData.boardReviewSubscriptionEndDate = endDateTimestamp;
        updateData.boardReviewTier = `Promotional Access (${promoData.durationDays} days)`;
      }
      
      // Add a note to the user's document for your records
      updateData.notes = `Promotional access granted via promo ID: ${promoDoc.id}`;
    }

    // 6. Update Firestore documents
    try {
      const userRef = db.collection('users').doc(uid);

      if (promoDoc) {
        // --- Use a Transaction to safely claim the promotion ---
        // This ensures the promotion can't be claimed by two people at once.
        const promoRef = promoDoc.ref;
        await db.runTransaction(async (transaction) => {
          // First, re-read the promotion inside the transaction to ensure it's still available
          const freshPromoDoc = await transaction.get(promoRef);
          if (!freshPromoDoc.exists || freshPromoDoc.data().status !== 'available') {
            // If someone else claimed it in the last millisecond, throw an error.
            throw new Error("This promotional offer is no longer available.");
          }

          // If it's still available, update both the user and the promotion document
          transaction.set(userRef, updateData, { merge: true });
          transaction.update(promoRef, {
            status: 'claimed',
            claimedByUid: uid,
            claimedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });
        logger.info(`Successfully finalized registration for user ${uid} WITH promotional access.`);

      } else {
        // No promotion found, just update the user document as normal
        await userRef.set(updateData, { merge: true });
        logger.info(`Successfully finalized registration for user ${uid} (standard access).`);
      }

      // --- START: Full MailerLite Sync Logic ---
      const mailerLiteApiKey = process.env.MAILERLITE_API_KEY;

      if (mailerLiteApiKey) {
        logger.info(`Setting initial MailerLite fields for new user ${email}.`);
        try {
          await axios.post(
            `https://connect.mailerlite.com/api/subscribers`,
            {
              email: email,
              fields: {
                name: username,
                is_on_trial: "false",
                inactivity_status: "inactive", // This will trigger the automation
              },
              status: "active",
            },
            {
              headers: {
                "Authorization": `Bearer ${mailerLiteApiKey}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
              },
            }
          );
          logger.info(`Successfully set initial MailerLite fields for ${email}.`);
        } catch (apiError) {
          logger.error(`Failed to set initial fields for new user ${email}.`, apiError.response?.data || apiError.message);
        }
      }
      // --- END: Full MailerLite Sync Logic ---

      // Return success, a message, and whether a promotion was applied.
      return { success: true, message: "Registration complete!", promoApplied: !!promoDoc };

    } catch (error) {
      logger.error(`Error finalizing registration for ${uid}:`, error);
      // Provide a more specific error message if the promo was already claimed
      if (error.message.includes("promotional offer is no longer available")) {
          throw new HttpsError("already-exists", error.message);
      }
      throw new HttpsError("internal", "Failed to update your profile. Please try again.");
    }
  }
);

// --- Cloud Function for Safe User Profile Updates ---
exports.updateUserProfile = onCall(
  {
    region: "us-central1",
    memory: "256MiB",
  },
  async (request) => {
    // 1. Authentication check
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please log in first.");
    }
    const uid = request.auth.uid;
    
    // 2. Define allowed fields that users can update
    const allowedFields = [
      'username',
      'bookmarks',
      'answeredQuestions',
      'streaks',
      'specialty',
      'experienceLevel',
      'spacedRepetitionSettings'
    ];
    
    // 3. Validate input data
    const updateData = request.data || {};

    // --- START: NEW VALIDATION BLOCK ---
    // If a username is being updated, validate it.
    if (updateData.username !== undefined) {
      const newUsername = updateData.username;
      if (typeof newUsername !== 'string' || newUsername.trim().length < 3) {
        logger.warn(`User ${uid} tried to update with invalid username: "${newUsername}"`);
        throw new HttpsError("invalid-argument", "Username must be at least 3 characters long.");
      }
      // Trim the username to save a clean version
      updateData.username = newUsername.trim();
    }
    // You could add similar validation for experienceLevel if needed, e.g.,
    // if (updateData.experienceLevel !== undefined && !['PGY-1', 'PGY-2', ...].includes(updateData.experienceLevel)) { ... }
    // --- END: NEW VALIDATION BLOCK ---

    const invalidFields = Object.keys(updateData).filter(field => !allowedFields.includes(field));
    
    if (invalidFields.length > 0) {
      throw new HttpsError("invalid-argument", `Cannot update restricted fields: ${invalidFields.join(', ')}`);
    }
    
    // 4. Add timestamp
    updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    
    // 5. Update user document
    try {
      const userRef = admin.firestore().collection('users').doc(uid);
      await userRef.set(updateData, { merge: true });
      
      logger.info(`User profile updated for ${uid}. Fields: ${Object.keys(updateData).join(', ')}`);
      return { success: true };
    } catch (error) {
      logger.error(`Error updating user profile for ${uid}:`, error);
      throw new HttpsError("internal", "Failed to update profile.");
    }
  }
);

// --- FULLY OPTIMIZED AND SECURE LEADERBOARD CLOUD FUNCTION ---
exports.getLeaderboardData = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
  },
  async (request) => {
    logger.info("getLeaderboardData function called", { authUid: request.auth?.uid });
    
    // AGGRESSIVE CHECK AND POTENTIAL RE-INITIALIZATION
    let currentDbInstance = db; // Try to use the global one
    logger.info("Inside getLeaderboardData. typeof global db:", typeof currentDbInstance, "Is global db truthy?", !!currentDbInstance);

    if (!currentDbInstance || typeof currentDbInstance.collection !== 'function') {
        logger.warn("Global 'db' is not valid inside getLeaderboardData. Attempting to re-initialize locally for this call.");
        currentDbInstance = admin.firestore();
        logger.info("Locally re-initialized db. typeof currentDbInstance:", typeof currentDbInstance, "Is it truthy?", !!currentDbInstance);
        if (!currentDbInstance || typeof currentDbInstance.collection !== 'function') {
            logger.error("CRITICAL: Failed to get a valid Firestore instance even with local re-initialization in getLeaderboardData!");
            throw new HttpsError("internal", "Database service is critically unavailable.");
        }
    }

    // 1. Authentication Check
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    const currentAuthUid = request.auth.uid;

    // 2. Get the calling user's data and validate
    const currentUserDocRef = currentDbInstance.collection("users").doc(currentAuthUid);
    const currentUserDoc = await currentUserDocRef.get();

    if (!currentUserDoc.exists) {
      logger.warn(`User ${currentAuthUid} has no document. Returning empty leaderboards.`);
      return {
        xpLeaderboard: [],
        weeklyXpLeaderboard: [],
        streakLeaderboard: [],
        answeredLeaderboard: [],
        currentUserRanks: { xp: null, weeklyXp: null, streak: null, answered: null },
      };
    }

    const currentUserData = currentUserDoc.data();
    
    // --- START: NEWLY ADDED SUBSCRIPTION CHECK ---
    const allowedTiers = ['board_review', 'cme_annual', 'cme_credits_only'];
    if (!allowedTiers.includes(currentUserData.accessTier)) {
      logger.warn(`User ${currentAuthUid} with tier "${currentUserData.accessTier}" attempted to access a restricted feature.`);
      // You can either return empty leaderboards or throw an error.
      // Throwing an error is often better for security to make it clear access is denied.
      throw new HttpsError(
        "permission-denied",
        "You do not have sufficient permissions to view the leaderboard."
      );
    }
    // --- END: NEWLY ADDED SUBSCRIPTION CHECK ---
    
    // Check if current user has required fields for leaderboard logic
    if (!currentUserData.specialty || !currentUserData.email || !currentUserData.isRegistered) {
      logger.warn(`User ${currentAuthUid} is missing required fields (specialty/email/isRegistered). Returning empty leaderboards.`);
      return {
        xpLeaderboard: [],
        weeklyXpLeaderboard: [],
        streakLeaderboard: [],
        answeredLeaderboard: [],
        currentUserRanks: { xp: null, weeklyXp: null, streak: null, answered: null },
      };
    }

    const currentUserSpecialty = currentUserData.specialty;
    logger.info(`Filtering leaderboard for specialty: "${currentUserSpecialty}"`);

    // 3. Helper functions
    function getStartOfWeekMilliseconds(date = new Date()) {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
      const startOfWeekDate = new Date(d.setDate(diff));
      startOfWeekDate.setHours(0, 0, 0, 0);
      return startOfWeekDate.getTime();
    }

    // Helper function to calculate weekly stats for a user
    function calculateWeeklyStats(userData, weekStartMillis) {
      let weeklyAnsweredCount = 0;
      let weeklyXp = 0;

      if (userData.answeredQuestions) {
        for (const questionKey in userData.answeredQuestions) {
          const answer = userData.answeredQuestions[questionKey];
          if (answer.timestamp && answer.timestamp >= weekStartMillis) {
            weeklyAnsweredCount++;
            weeklyXp += 1; // 1 XP for answering
            if (answer.isCorrect === true) {
              weeklyXp += 2; // +2 additional for correct
            }
          }
        }
      }

      return { weeklyAnsweredCount, weeklyXp };
    }

    const TOP_N_LEADERBOARD = 10;
    const weekStartMillis = getStartOfWeekMilliseconds();

    try {
      // 4. OPTIMIZED QUERY: Use Firestore query to filter at database level
      let usersSnapshot;
      
      try {
        // Attempt optimized query (requires composite index)
        usersSnapshot = await currentDbInstance.collection("users")
          .where("isRegistered", "==", true)
          .where("specialty", "==", currentUserSpecialty)
          .get();
        logger.info(`Optimized query successful. Found ${usersSnapshot.size} eligible users.`);
      } catch (indexError) {
        // Fallback to less optimized query if composite index doesn't exist
        logger.warn("Composite index not available, falling back to single-field query:", indexError.message);
        usersSnapshot = await currentDbInstance.collection("users")
          .where("isRegistered", "==", true)
          .get();
        logger.info(`Fallback query returned ${usersSnapshot.size} registered users.`);
      }

      // 5. Process eligible users
      const allEligibleUsersData = [];
      
      usersSnapshot.forEach((doc) => {
        const userData = doc.data();
        
        // Apply ALL filtering criteria
        if (
          userData.isRegistered === true &&
          userData.email && // Must have email
          userData.specialty === currentUserSpecialty // Must match specialty
        ) {
          const weeklyStats = calculateWeeklyStats(userData, weekStartMillis);
          const longestStreak = Math.max(
            userData.streaks?.longestStreak || 0,
            userData.streaks?.currentStreak || 0
          );

          allEligibleUsersData.push({
            uid: doc.id,
            username: userData.username || "Anonymous",
            xp: userData.stats?.xp || 0,
            weeklyXp: weeklyStats.weeklyXp,
            level: userData.stats?.level || 1,
            currentStreak: userData.streaks?.currentStreak || 0,
            longestStreak,
            weeklyAnsweredCount: weeklyStats.weeklyAnsweredCount,
          });
        }
      });

      logger.info(`Processed ${allEligibleUsersData.length} eligible users for leaderboards.`);

      // 6. Create sorted leaderboards with proper ranking
      let currentUserRanks = { xp: null, weeklyXp: null, streak: null, answered: null };

      // Helper function to create leaderboard and find user rank
      function createLeaderboardWithRanking(data, sortKey) {
        const sorted = [...data].sort((a, b) => b[sortKey] - a[sortKey]);
        const leaderboard = sorted.slice(0, TOP_N_LEADERBOARD).map((user, index) => ({
          ...user,
          rank: index + 1
        }));
        
        const currentUserIndex = sorted.findIndex(u => u.uid === currentAuthUid);
        let currentUserRank = null;
        if (currentUserIndex !== -1) {
          currentUserRank = {
            ...sorted[currentUserIndex],
            rank: currentUserIndex + 1
          };
        }
        
        return { leaderboard, currentUserRank };
      }

      // All-Time XP Leaderboard
      const xpResults = createLeaderboardWithRanking(allEligibleUsersData, 'xp');
      const xpLeaderboard = xpResults.leaderboard;
      currentUserRanks.xp = xpResults.currentUserRank;

      // Weekly XP Leaderboard
      const weeklyXpResults = createLeaderboardWithRanking(allEligibleUsersData, 'weeklyXp');
      const weeklyXpLeaderboard = weeklyXpResults.leaderboard;
      currentUserRanks.weeklyXp = weeklyXpResults.currentUserRank;

      // Streak Leaderboard
      const streakResults = createLeaderboardWithRanking(allEligibleUsersData, 'longestStreak');
      const streakLeaderboard = streakResults.leaderboard;
      currentUserRanks.streak = streakResults.currentUserRank;

      // Weekly Answered Leaderboard
      const answeredResults = createLeaderboardWithRanking(allEligibleUsersData, 'weeklyAnsweredCount');
      const answeredLeaderboard = answeredResults.leaderboard;
      currentUserRanks.answered = answeredResults.currentUserRank;

      logger.info("Leaderboard data prepared successfully.");
      
      return {
        xpLeaderboard,
        weeklyXpLeaderboard,
        streakLeaderboard,
        answeredLeaderboard,
        currentUserRanks,
      };

    } catch (error) {
      logger.error("Error during leaderboard data processing in getLeaderboardData:", error, {stack: error.stack});
      throw new HttpsError(
        "internal",
        "An error occurred while processing leaderboard data.",
        error.message
      );
    }
  }
);

const MAILERLITE_GROUP_ID = "156027000658593431"; // Your MailerLite Group ID

const MAX_USERS_TO_PROCESS_PER_RUN = 100; // Adjustable: How many users to process in one go

exports.syncUsersToMailerLiteDaily = onSchedule(
  {
    schedule: "every day 22:00",
    timeZone: "America/New_York",
    secrets: ["MAILERLITE_API_KEY"],
    timeoutSeconds: 540,
    memory: "512MiB",
    retryConfig: {
      retryCount: 2,
    }
  },
  async (event) => {
    logger.info(`Scheduled MailerLite sync started. Event ID: ${event.jobName}, Timestamp: ${event.scheduleTime}`);

    const mailerLiteApiKey = process.env.MAILERLITE_API_KEY;
    if (!mailerLiteApiKey) {
      logger.error("MAILERLITE_API_KEY secret is not configured. Aborting MailerLite sync.");
      return;
    }

    try {
      const usersRef = db.collection("users");
      
      // Query for users who might be on free trials
      const snapshot = await usersRef
        .where("email", "!=", null)
        .where("mailerLiteSubscriberId", "==", null)
        .where("hasActiveTrial", "==", true)
        .limit(MAX_USERS_TO_PROCESS_PER_RUN)
        .get();

      if (snapshot.empty) {
        logger.info("No new users to sync to MailerLite at this time.");
        return;
      }

      logger.info(`Found ${snapshot.docs.length} users to potentially sync to MailerLite.`);
      let successCount = 0;
      let errorCount = 0;
      let skippedCount = 0;

      for (const userDoc of snapshot.docs) {
        const userId = userDoc.id;
        const userData = userDoc.data();

        // Since we're now querying for hasActiveTrial=true, we know these are trial users
// Just do a quick verification
if (!userData.hasActiveTrial) {
  logger.warn(`User ${userId} was in trial query but hasActiveTrial is false. Skipping.`);
  skippedCount++;
  continue;
}

// Get the trial type from the data
const trialType = userData.trialType || "unknown_trial";

        // Check if they have trial end dates (indicating they're on a trial)
        const hasBoardReviewTrial = userData.boardReviewTrialEndDate ? true : false;
        const hasCmeAnnualTrial = userData.cmeSubscriptionTrialEndDate ? true : false;
        
        if (!hasBoardReviewTrial && !hasCmeAnnualTrial) {
          logger.info(`User ${userId} has active subscription but no trial end date. Likely a paid customer. Skipping.`);
          skippedCount++;
          continue;
        }

        // Additional check: If they have a stripeCustomerId, they've likely made a payment
        // (though this could be from a previous purchase, so this check might need adjustment)
        // For the strictest interpretation of "free trial only", you might want to check
        // if they've EVER made a payment vs just having a customer ID
        
        // Optional stricter check - uncomment if needed:
        // if (userData.stripeCustomerId) {
        //   logger.info(`User ${userId} has stripeCustomerId, indicating past payment. Skipping.`);
        //   skippedCount++;
        //   continue;
        // }

        // Validate email
        if (!userData.email || typeof userData.email !== 'string' || !userData.email.includes('@')) {
          logger.warn(`User ${userId} has invalid or missing email. Skipping.`);
          skippedCount++;
          continue;
        }

        const email = userData.email;
        const name = userData.firstName || userData.username || userData.displayName || "";
        
        // Use the trialType we already have from the database
const trialTypeForMailerLite = userData.trialType === "cme_annual" ? "cme_annual_trial" : 
userData.trialType === "board_review" ? "board_review_trial" : 
"unknown_trial";

        logger.info(`Processing FREE TRIAL user ${userId} (Email: ${email}, Trial Type: ${trialType}) for MailerLite sync.`);

        try {
          const response = await axios.post(
            `https://connect.mailerlite.com/api/subscribers`,
            {
              email: email,
              fields: {
                name: name,
                customer_type: "free_trial",
                ttrial_type: trialTypeForMailerLite,
                subscription_plan: userData.cmeSubscriptionPlan || userData.boardReviewTier || "Free Trial",
                // Track marketing consent even though we're adding them regardless
                has_marketing_consent: userData.marketingOptIn ? "yes" : "no"
              },
              groups: [MAILERLITE_GROUP_ID],
              status: "active", // Active for transactional trial emails
            },
            {
              headers: {
                "Authorization": `Bearer ${mailerLiteApiKey}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
              },
              timeout: 10000,
            }
          );

          const subscriberId = response.data?.data?.id;
          logger.info(`Successfully added/updated FREE TRIAL user ${email} in MailerLite. Subscriber ID: ${subscriberId}`);
          successCount++;

          // Update Firestore
          await userDoc.ref.update({
            mailerLiteSubscriberId: subscriberId || `SYNCED_NO_ID_${Date.now()}`,
            mailerLiteLastSyncTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            mailerLiteSubscriberType: "free_trial_user",
            mailerLiteSyncError: admin.firestore.FieldValue.delete()
          });

        } catch (apiError) {
          errorCount++;
          let errorMessage = apiError.message;
          let errorStatus = "UNKNOWN";
          let errorData = null;

          if (apiError.response) {
            errorStatus = apiError.response.status;
            errorData = apiError.response.data;
            errorMessage = errorData?.message || JSON.stringify(errorData) || apiError.message;
            logger.error(`MailerLite API Error for ${email} (User ID: ${userId}): Status ${errorStatus}`, { errorData });
          } else if (apiError.request) {
            logger.error(`MailerLite API No Response for ${email} (User ID: ${userId}):`, apiError.request);
            errorMessage = "No response from MailerLite API.";
          } else {
            logger.error(`MailerLite API Request Setup Error for ${email} (User ID: ${userId}):`, apiError.message);
          }

          if (errorStatus === 422 || errorStatus === 400) {
            await userDoc.ref.update({
              mailerLiteSubscriberId: `ERROR_API_${errorStatus}`,
              mailerLiteSyncError: {
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                message: errorMessage,
                status: errorStatus,
                data: errorData ? JSON.stringify(errorData).substring(0, 500) : null,
                groupId: MAILERLITE_GROUP_ID
              }
            });
            logger.warn(`Marked user ${userId} with persistent MailerLite sync error ${errorStatus}.`);
          }
        }
      }

      logger.info(`MailerLite sync finished. Processed: ${snapshot.docs.length}, Success: ${successCount}, Errors: ${errorCount}, Skipped: ${skippedCount}.`);

    } catch (error) {
      logger.error("Unhandled error during scheduled MailerLite sync:", error);
    }
  }
);

// --- Daily Scheduled Function to Sync User Activity Status to MailerLite ---
exports.syncActivityToMailerLite = onSchedule(
  {
    schedule: "every day 22:00",
    timeZone: "America/New_York",
    secrets: ["MAILERLITE_API_KEY"],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (event) => {
    logger.info("Starting daily sync of user activity status to MailerLite.");

    const mailerLiteApiKey = process.env.MAILERLITE_API_KEY;
    if (!mailerLiteApiKey) {
      logger.error("MailerLite API Key is not configured. Aborting sync.");
      return;
    }

    const usersRef = db.collection("users");
    const snapshot = await usersRef
      .where("isRegistered", "==", true)
      .get();

    if (snapshot.empty) {
      logger.info("No registered users found to sync.");
      return;
    }

    logger.info(`Found ${snapshot.docs.length} registered users to process for activity status.`);
    const now = Date.now();
    const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
    
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let unsubscribedCount = 0;
    let retryCount = 0;

    // Process each user individually
    for (const doc of snapshot.docs) {
      const userData = doc.data();
      const uid = doc.id;

      // Skip trial users
      if (userData.hasActiveTrial === true) {
        skippedCount++;
        continue;
      }

      // Skip users without valid emails
      if (!userData.email || typeof userData.email !== 'string' || !userData.email.includes('@')) {
        skippedCount++;
        continue;
      }

      // Calculate last activity
      const lastAnswered = userData.streaks?.lastAnsweredDate;
      let lastActivityMillis = 0;

      if (lastAnswered) {
        if (typeof lastAnswered.toMillis === 'function') {
          lastActivityMillis = lastAnswered.toMillis();
        } else if (typeof lastAnswered === 'string') {
          lastActivityMillis = new Date(lastAnswered).getTime();
        }
      }

      // Determine status
      const newStatus = (lastActivityMillis && lastActivityMillis > twentyFourHoursAgo) ? 'active' : 'inactive';

      // Retry logic for rate limits
      let attempts = 0;
      let success = false;
      
      while (attempts < 3 && !success) {
        try {
          await axios.post(
            `https://connect.mailerlite.com/api/subscribers`,
            {
              email: userData.email,
              fields: {
                inactivity_status: newStatus,
              },
              // Removed resubscribe: true to respect unsubscribes
            },
            {
              headers: {
                "Authorization": `Bearer ${mailerLiteApiKey}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
              },
            }
          );
          successCount++;
          success = true;

        } catch (apiError) {
          const statusCode = apiError.response?.status;
          const errorMessage = apiError.response?.data?.message || '';
          const errorDetail = apiError.response?.data?.errors?.email?.[0] || '';
          
          // Check if the error is because user is unsubscribed or doesn't exist
          if (statusCode === 400 || statusCode === 422) {
            // Check for unsubscribed status in various error message formats
            if (errorMessage.toLowerCase().includes('unsubscribed') || 
                errorDetail.toLowerCase().includes('unsubscribed') ||
                errorMessage.toLowerCase().includes('subscriber not found') ||
                errorDetail.toLowerCase().includes('does not exist')) {
              unsubscribedCount++;
              logger.info(`User ${userData.email} is unsubscribed or not in MailerLite. Skipping.`);
              break; // Exit retry loop, don't retry for unsubscribed users
            } else {
              // Other 400/422 error - log and don't retry
              errorCount++;
              logger.error(
                `Validation error for ${userData.email}. Status: ${statusCode}. Error:`,
                apiError.response?.data || apiError.message
              );
              break;
            }
          } else if (statusCode === 429) {
            // Rate limit hit - wait and retry
            attempts++;
            if (attempts < 3) {
              retryCount++;
              const waitTime = attempts * 2000; // 2s, 4s, 6s
              logger.info(`Rate limit hit for ${userData.email}. Waiting ${waitTime}ms before retry ${attempts}/3`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
              errorCount++;
              logger.error(`Failed after 3 attempts for ${userData.email} due to rate limits`);
            }
          } else {
            // Other error - don't retry
            errorCount++;
            const errorDetails = apiError.response?.data || apiError.message || 'Unknown error';
            logger.error(
              `Failed to update MailerLite for user ${uid} (${userData.email}). Status: ${statusCode}. Error:`,
              errorDetails
            );
            break;
          }
        }
      }

      // Always add delay between users to prevent rate limits
      if (successCount > 0 && successCount % 5 === 0) {
        // Every 5 successful updates, wait 1 second
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        // Small delay between all requests
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    logger.info(`MailerLite sync completed. Processed: ${successCount}, Errors: ${errorCount}, Skipped: ${skippedCount}, Unsubscribed/Not Found: ${unsubscribedCount}, Retries: ${retryCount}`);
  }
);

// --- Configuration for Weekly Digest ---
const MAILERLITE_WEEKLY_DIGEST_GROUP_ID = "164298506172892979"; // <<< REPLACE THIS with your actual "Weekly Digest" Group ID from MailerLite
const MIN_QUESTIONS_FOR_CATEGORY = 3; // The minimum questions a user must answer in a category for it to be considered for strongest/weakest

/**
 * =================================================================================
 *  Function A: Weekly Logger
 *  Scheduled to run late every Saturday night.
 *  Creates a snapshot of each user's cumulative stats for accurate weekly calculations.
 * =================================================================================
 */
exports.logWeeklyUserStats = onSchedule(
  {
    schedule: "every saturday 23:50", // Runs at 11:50 PM every Saturday
    timeZone: "America/Los_Angeles", // Pacific Time Zone
    secrets: [], // No secrets needed for this function
    memory: "512MiB",
    timeoutSeconds: 540, // 9 minutes, allows for processing many users
  },
  async (event) => {
    logger.info("Starting scheduled job: logWeeklyUserStats.");

    const usersRef = db.collection("users");
    const today = new Date();
    const dateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    let processedCount = 0;

    try {
      // Query for all users who are registered and have an email.
      const snapshot = await usersRef
        .where("isRegistered", "==", true)
        .where("email", "!=", null)
        .get();

      if (snapshot.empty) {
        logger.info("No registered users found to log stats for. Job finished.");
        return;
      }

      logger.info(`Found ${snapshot.docs.length} users to process for weekly stat logging.`);

      // Process users in parallel for efficiency
      const promises = snapshot.docs.map(async (userDoc) => {
        const userId = userDoc.id;
        const userData = userDoc.data();
        const userStats = userData.stats || {};

        const snapshotData = {
          timestamp: admin.firestore.Timestamp.now(),
          totalAnswered: userStats.totalAnswered || 0,
          totalCorrect: userStats.totalCorrect || 0,
          xp: userStats.xp || 0,
        };

        // The path is /weeklySnapshots/{userId}/snapshots/{YYYY-MM-DD}
        const snapshotRef = db.collection("weeklySnapshots").doc(userId)
                              .collection("snapshots").doc(dateString);

        await snapshotRef.set(snapshotData);
        processedCount++;
      });

      await Promise.all(promises);

      logger.info(`Successfully logged weekly stats for ${processedCount} users. Job finished.`);

    } catch (error) {
      logger.error("Error during logWeeklyUserStats execution:", error);
    }
  }
);


/**
 * =================================================================================
 *  Function B: Digest Calculator & MailerLite Pusher
 *  Scheduled to run every Sunday morning.
 *  Calculates weekly stats from snapshots and syncs them to MailerLite.
 * =================================================================================
 */

const checkMailerLiteUnsubscribeStatus = async (email, mailerLiteApiKey) => {
  if (!email || !mailerLiteApiKey) {
    return { isUnsubscribed: false, found: false };
  }

  try {
    const response = await axios.get(
      `https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(email)}`,
      {
        headers: {
          Authorization: `Bearer ${mailerLiteApiKey}`,
          Accept: "application/json",
        },
      }
    );

    const status =
      response.data?.data?.status ||
      response.data?.status ||
      "";

    return {
      isUnsubscribed: typeof status === "string" && status.toLowerCase() === "unsubscribed",
      found: true,
    };
  } catch (error) {
    const statusCode = error.response?.status;
    const errorMessage = (error.response?.data?.message || "").toLowerCase();
    const errorDetail = (error.response?.data?.errors?.email?.[0] || "").toLowerCase();

    if (
      errorMessage.includes("unsubscribed") ||
      errorDetail.includes("unsubscribed")
    ) {
      return { isUnsubscribed: true, found: true };
    }

    if (statusCode === 404 || errorMessage.includes("not found")) {
      return { isUnsubscribed: false, found: false };
    }

    logger.warn(
      `Unable to determine MailerLite status for ${email}. Assuming subscribed.`,
      error.response?.data || error.message
    );

    return { isUnsubscribed: false, found: true };
  }
};

exports.calculateAndSyncWeeklyDigest = onSchedule(
  {
    schedule: "every sunday 08:00", // Runs at 8:00 AM every Sunday
    timeZone: "America/Los_Angeles", // Pacific Time Zone
    secrets: ["MAILERLITE_API_KEY"], // Needs the API key we configured
    memory: "1GiB", // More memory for potentially heavy calculations
    timeoutSeconds: 540, // 9 minutes
  },
  async (event) => {
    logger.info("Starting scheduled job: calculateAndSyncWeeklyDigest.");
    const mailerLiteApiKey = process.env.MAILERLITE_API_KEY;

    if (!mailerLiteApiKey) {
      logger.error("MAILERLITE_API_KEY is not available. Aborting job.");
      return;
    }

    const usersRef = db.collection("users");
    let successCount = 0;
    let skippedCount = 0;
    let unsubscribedCount = 0;

    try {
      // 1. Get all eligible users: registered, have an email, and opted-in.
      const usersSnapshot = await usersRef
        .where("isRegistered", "==", true)
        .where("email", "!=", null)
        .where("marketingOptIn", "==", true)
        .get();

      if (usersSnapshot.empty) {
        logger.info("No eligible users found for weekly digest. Job finished.");
        return;
      }

      logger.info(`Found ${usersSnapshot.docs.length} eligible users to process for the weekly digest.`);

      // Process each user
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const userData = userDoc.data();
        const userEmail = userData.email;

        // 2. Get the last two snapshots for the user
        const snapshotsRef = db.collection("weeklySnapshots").doc(userId).collection("snapshots");
        const snapshotQuery = await snapshotsRef.orderBy("timestamp", "desc").limit(2).get();

        if (snapshotQuery.docs.length === 0) {
          skippedCount++;
          continue; // No snapshots for this user, skip them.
        }

        // 3. Calculate weekly stats using the snapshot "logbook" method
        const latestSnapshot = snapshotQuery.docs[0].data();
        const previousSnapshot = snapshotQuery.docs[1] ? snapshotQuery.docs[1].data() : { totalAnswered: 0, totalCorrect: 0, xp: 0 };

        const weeklyAnswered = latestSnapshot.totalAnswered - previousSnapshot.totalAnswered;
        const weeklyCorrect = latestSnapshot.totalCorrect - previousSnapshot.totalCorrect;
        const weeklyXp = latestSnapshot.xp - previousSnapshot.xp;

        // Requirement: Only send to users who answered at least one question this week.
        if (weeklyAnswered <= 0) {
          skippedCount++;
          continue;
        }

        const weeklyAccuracy = weeklyAnswered > 0 ? Math.round((weeklyCorrect / weeklyAnswered) * 100) : 0;

        // 4. Calculate Strongest/Weakest Category (this requires a scan of recent answers)
        let strongestCategory = "N/A";
        let weakestCategory = "N/A";
        const answeredQuestions = userData.answeredQuestions || {};
        const categoryStats = {};

        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const oneWeekAgoMillis = oneWeekAgo.getTime();

        for (const qId in answeredQuestions) {
          const answer = answeredQuestions[qId];
          if (answer.timestamp && answer.timestamp >= oneWeekAgoMillis) {
            const category = answer.category || "Uncategorized";
            if (!categoryStats[category]) {
              categoryStats[category] = { answered: 0, correct: 0 };
            }
            categoryStats[category].answered++;
            if (answer.isCorrect) {
              categoryStats[category].correct++;
            }
          }
        }

        const eligibleCategories = Object.entries(categoryStats)
          .filter(([cat, stats]) => stats.answered >= MIN_QUESTIONS_FOR_CATEGORY)
          .map(([cat, stats]) => ({
            name: cat,
            accuracy: (stats.correct / stats.answered) * 100,
          }));

                // --- START: FINAL Logic for Strongest/Weakest Category (with Accuracy %) ---
                if (eligibleCategories.length > 1) {
                  // If there are 2 or more eligible categories, find the best and worst.
                  eligibleCategories.sort((a, b) => b.accuracy - a.accuracy); // Sort descending
        
                  const strongest = eligibleCategories[0];
                  const weakest = eligibleCategories[eligibleCategories.length - 1];
        
                  // Format the string to include the name and the rounded accuracy percentage
                  strongestCategory = `${strongest.name} (${Math.round(strongest.accuracy)}% Accuracy)`;
                  weakestCategory = `${weakest.name} (${Math.round(weakest.accuracy)}% Accuracy)`;
        
                } else if (eligibleCategories.length === 1) {
                  // If there is only 1 eligible category, format it as the strongest.
                  const strongest = eligibleCategories[0];
                  strongestCategory = `${strongest.name} (${Math.round(strongest.accuracy)}% Accuracy)`;
                  weakestCategory = "Focus on other topics!"; // The helpful message remains
                }
                // If eligibleCategories.length is 0, both will remain "N/A" by default.
                // --- END: FINAL Logic ---

        // 5. Respect MailerLite unsubscribe status before syncing
        try {
          const { isUnsubscribed } = await checkMailerLiteUnsubscribeStatus(
            userEmail,
            mailerLiteApiKey
          );

          if (isUnsubscribed) {
            unsubscribedCount++;
            skippedCount++;
            logger.info(
              `Skipping weekly digest sync for ${userId} (${userEmail}) because the user is unsubscribed in MailerLite.`
            );
            continue;
          }
        } catch (statusError) {
          logger.error(
            `Failed to check MailerLite status for ${userId} (${userEmail}).`,
            statusError.response?.data || statusError.message
          );
          // Proceed with sync attempt even if status check fails unexpectedly
        }

        // 6. Prepare and sync the data to MailerLite
        const mailerLitePayload = {
          email: userEmail,
          fields: {
            weekly_answered: weeklyAnswered,
            weekly_xp: weeklyXp,
            weekly_accuracy: weeklyAccuracy,
            strongest_category: strongestCategory,
            weakest_category: weakestCategory,
          },
          groups: [MAILERLITE_WEEKLY_DIGEST_GROUP_ID],
        };

        try {
          await axios.post(
            "https://connect.mailerlite.com/api/subscribers",
            mailerLitePayload,
            {
              headers: {
                "Authorization": `Bearer ${mailerLiteApiKey}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
              },
            }
          );
          successCount++;
          logger.info(`Successfully synced weekly digest data for user ${userId} (${userEmail}).`);
        } catch (apiError) {
          logger.error(`Failed to sync MailerLite data for user ${userId}.`, apiError.response?.data || apiError.message);
        }
      }

      logger.info(
        `Weekly digest job finished. Successfully synced: ${successCount}, Skipped (no activity/data): ${skippedCount}, Unsubscribed: ${unsubscribedCount}.`
      );

    } catch (error) {
      logger.error("Error during calculateAndSyncWeeklyDigest execution:", error);
    }
  }
);

exports.recomputeAccessTier = onCall(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const requestedUid = typeof request.data?.uid === "string" ? request.data.uid.trim() : "";
    const targetUid = requestedUid || request.auth.uid;

    if (!targetUid) {
      throw new HttpsError("invalid-argument", "A user ID must be provided.");
    }

    const isAdminCaller = request.auth.token?.admin === true;
    if (targetUid !== request.auth.uid && !isAdminCaller) {
      throw new HttpsError("permission-denied", "Insufficient permissions to recompute this user.");
    }

    const userRef = db.collection("users").doc(targetUid);
    const userSnapshot = await userRef.get();

    if (!userSnapshot.exists) {
      throw new HttpsError("not-found", "User record not found.");
    }

    const userData = userSnapshot.data() || {};
    const nowMs = Date.now();

    const recomputeDetails = recomputeAccessTierFromData(userData, nowMs);
    const updates = { ...recomputeDetails.updates };
    const newAccessTier = recomputeDetails.newAccessTier;

    let wroteChanges = false;
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      await userRef.set(updates, { merge: true });
      wroteChanges = true;
    }

    return {
      success: true,
      uid: targetUid,
      accessTier: newAccessTier,
      updated: wroteChanges,
      updatedFields: wroteChanges
        ? Object.keys(updates).filter((field) => field !== "updatedAt")
        : [],
      cme: {
        before: formatWindowForResponse(recomputeDetails.originalCmeWindow),
        after: formatWindowForResponse(recomputeDetails.updatedCmeWindow),
      },
      boardReview: {
        before: formatWindowForResponse(recomputeDetails.originalBoardWindow),
        after: formatWindowForResponse(recomputeDetails.updatedBoardWindow),
      },
      trial: {
        hasActiveTrial: !!userData.hasActiveTrial,
        trialType: userData.trialType || null,
      },
    };
  }
);
