const {
  __TESTING__: {
    buildRateLimitDocId,
    enforceRateLimit,
    RATE_LIMIT_CONFIG,
  },
} = require("./index");

const testFirestoreApi = {
  FieldValue: {
    increment: (value) => ({ __op: "increment", value }),
    serverTimestamp: () => ({ __op: "serverTimestamp" }),
  },
  Timestamp: {
    fromMillis: (value) => ({ __op: "timestamp", value }),
  },
};

function createFakeDb(initialDocs = {}) {
  const operations = [];
  const docs = new Map(Object.entries(initialDocs));

  const db = {
    collection: (collectionName) => ({
      doc: (id) => ({
        id,
        path: `${collectionName}/${id}`,
      }),
    }),
    runTransaction: async (callback) => {
      let wrote = false;
      const tx = {
        get: async (docRef) => {
          if (wrote) {
            throw new Error("read after write");
          }
          operations.push(`get:${docRef.id}`);
          const data = docs.get(docRef.id);
          return {
            exists: Boolean(data),
            data: () => data,
          };
        },
        set: (docRef, data) => {
          wrote = true;
          operations.push(`set:${docRef.id}`);
          const current = docs.get(docRef.id) || {};
          const increment = data.count?.__op === "increment" ? data.count.value : data.count;
          docs.set(docRef.id, {
            ...current,
            ...data,
            count: Number(current.count || 0) + Number(increment || 0),
          });
        },
      };
      await callback(tx);
    },
  };

  return { db, docs, operations };
}

describe("enforceRateLimit", () => {
  const uid = "test-user";
  const key = "createStripeCheckoutSession";
  const limits = RATE_LIMIT_CONFIG.createStripeCheckoutSession;
  const nowMs = 120000;

  test("reads all rate-limit windows before writing any counter", async () => {
    const { db, operations } = createFakeDb();

    await enforceRateLimit(uid, key, limits, {
      db,
      firestore: testFirestoreApi,
      nowMs,
    });

    const expectedDocIds = limits.map((limit) => {
      const windowStartMs = Math.floor(nowMs / limit.windowMs) * limit.windowMs;
      return buildRateLimitDocId(uid, key, windowStartMs, limit.windowMs);
    });

    expect(operations).toEqual([
      `get:${expectedDocIds[0]}`,
      `get:${expectedDocIds[1]}`,
      `set:${expectedDocIds[0]}`,
      `set:${expectedDocIds[1]}`,
    ]);
  });

  test("blocks without writing when a rate-limit window is exhausted", async () => {
    const exhaustedLimit = limits[0];
    const exhaustedWindowStartMs =
      Math.floor(nowMs / exhaustedLimit.windowMs) * exhaustedLimit.windowMs;
    const exhaustedDocId = buildRateLimitDocId(
      uid,
      key,
      exhaustedWindowStartMs,
      exhaustedLimit.windowMs
    );
    const { db, operations } = createFakeDb({
      [exhaustedDocId]: { count: exhaustedLimit.max },
    });

    await expect(
      enforceRateLimit(uid, key, limits, {
        db,
        firestore: testFirestoreApi,
        nowMs,
      })
    ).rejects.toMatchObject({
      code: "resource-exhausted",
    });

    expect(operations.filter((operation) => operation.startsWith("set:"))).toEqual([]);
  });
});
