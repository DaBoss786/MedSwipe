// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'choice-user' } },
  db: {},
  doc: vi.fn((_db, ...parts) => parts.join('/')),
  getDoc: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  functions: {},
  httpsCallable: vi.fn(() => vi.fn()),
  setDoc: vi.fn(),
  updateProfile: vi.fn()
}));

vi.mock('./firebase-config.js', () => firebaseMocks);
vi.mock('./haptics.js', () => ({ setHapticsEnabled: vi.fn() }));
vi.mock('./platform.js', () => ({ isIosNativeApp: vi.fn(() => false) }));
vi.mock('./answered-questions.js', () => ({
  getAnsweredQuestionIds: vi.fn(() => []),
  recordAnsweredQuestion: vi.fn((answeredQuestions) => ({ answeredQuestions }))
}));

import { recordChoiceSelection } from './user.v2.js';

describe('recordChoiceSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseMocks.auth.currentUser = { uid: 'choice-user' };
  });

  it('returns complete post-selection counts for an existing document', async () => {
    const transaction = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({
          choiceA: 4,
          choiceB: 2,
          choiceC: 1,
          choiceD: 0,
          totalResponses: 7
        })
      }),
      set: vi.fn()
    };
    firebaseMocks.runTransaction.mockImplementation(async (_db, callback) => callback(transaction));

    await expect(recordChoiceSelection('Question 1', 'B')).resolves.toEqual({
      choiceA: 4,
      choiceB: 3,
      choiceC: 1,
      choiceD: 0,
      choiceE: 0,
      totalResponses: 8
    });
    expect(transaction.set).toHaveBeenCalledWith(
      'choiceStats/Question 1',
      {
        choiceA: 4,
        choiceB: 3,
        choiceC: 1,
        choiceD: 0,
        choiceE: 0,
        totalResponses: 8
      },
      { merge: true }
    );
    expect(firebaseMocks.getDoc).not.toHaveBeenCalled();
  });

  it('initializes a missing document and includes the current response', async () => {
    const transaction = {
      get: vi.fn().mockResolvedValue({ exists: () => false }),
      set: vi.fn()
    };
    firebaseMocks.runTransaction.mockImplementation(async (_db, callback) => callback(transaction));

    await expect(recordChoiceSelection('Question 2', 'E')).resolves.toEqual({
      choiceA: 0,
      choiceB: 0,
      choiceC: 0,
      choiceD: 0,
      choiceE: 1,
      totalResponses: 1
    });
  });

  it('returns null for invalid input, missing authentication, or transaction failure', async () => {
    await expect(recordChoiceSelection('Question 3', 'Z')).resolves.toBeNull();
    expect(firebaseMocks.runTransaction).not.toHaveBeenCalled();

    firebaseMocks.auth.currentUser = null;
    await expect(recordChoiceSelection('Question 3', 'A')).resolves.toBeNull();

    firebaseMocks.auth.currentUser = { uid: 'choice-user' };
    firebaseMocks.runTransaction.mockRejectedValue(new Error('offline'));
    await expect(recordChoiceSelection('Question 3', 'A')).resolves.toBeNull();
  });
});
