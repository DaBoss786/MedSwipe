export function canAccessPremiumContent(user) {
  const accessTier = user?.accessTier ?? null;
  return accessTier === 'board_review' || accessTier === 'cme_annual';
}
