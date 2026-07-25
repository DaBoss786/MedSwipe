import { describe, expect, it, vi } from 'vitest';

vi.mock('./firebase-config.js', () => ({
  db: {},
  doc: vi.fn(),
  getDoc: vi.fn()
}));

import {
  applyQuestionAccessPolicy,
  getCasePrepModeForSpecialty,
  getPilotQuestionAccessConfig,
  resolvePolicyFromAuthState
} from './specialty-policy.js';

describe('Anesthesiology specialty policy', () => {
  it('hides Case Prep without enabling pilot behavior', () => {
    const authState = {
      specialty: 'Anesthesiology',
      accessTier: 'free_guest'
    };
    const policy = resolvePolicyFromAuthState(authState);

    expect(getCasePrepModeForSpecialty(authState.specialty, policy)).toBe('hidden');
    expect(policy.enabled).toBe(false);
    expect(policy.fullFeaturePilotForFreeGuest).toBe(false);
    expect(policy.skipOnboardingQuiz).toBe(false);
    expect(policy.skipOnboardingCarousel).toBe(false);
    expect(policy.skipPaywall).toBe(false);
    expect(getPilotQuestionAccessConfig(authState, policy)).toEqual({
      enabled: false,
      questionCap: null,
      questionPilotFlagField: null
    });

    const questions = [
      { Question: 'Free', Specialty: 'Anesthesiology', Free: true },
      { Question: 'Premium', Specialty: 'Anesthesiology', Free: false, pilotNeurosurgery: true }
    ];
    expect(applyQuestionAccessPolicy(questions, authState, policy)).toEqual([
      questions[0]
    ]);
  });

  it.each([
    ['ENT', 'default'],
    ['Urology', 'default'],
    ['Neurosurgery', 'coming_soon']
  ])('preserves the %s Case Prep mode', (specialty, expectedMode) => {
    const policy = resolvePolicyFromAuthState({ specialty });
    expect(getCasePrepModeForSpecialty(specialty, policy)).toBe(expectedMode);
  });
});
