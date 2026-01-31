import { describe, it, expect } from 'vitest';
import { canAccessPremiumContent } from './premium-gating.js';

describe('canAccessPremiumContent', () => {
  it('blocks free users from premium content', () => {
    expect(canAccessPremiumContent({ accessTier: 'free_guest' })).toBe(false);
  });

  it('allows paid users to access premium content', () => {
    expect(canAccessPremiumContent({ accessTier: 'board_review' })).toBe(true);
    expect(canAccessPremiumContent({ accessTier: 'cme_annual' })).toBe(true);
  });

  it('handles missing tier or anonymous users safely', () => {
    expect(canAccessPremiumContent()).toBe(false);
    expect(canAccessPremiumContent(null)).toBe(false);
    expect(canAccessPremiumContent({})).toBe(false);
    expect(canAccessPremiumContent({ accessTier: undefined })).toBe(false);
  });
});
