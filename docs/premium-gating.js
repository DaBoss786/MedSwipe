export function canAccessPremiumContent(user, specialtyPolicy = null) {
  const accessTier = user?.accessTier ?? null;
  if (accessTier === 'board_review' || accessTier === 'cme_annual') {
    return true;
  }

  if (
    accessTier === 'free_guest' &&
    specialtyPolicy?.enabled === true &&
    specialtyPolicy?.fullFeaturePilotForFreeGuest === true
  ) {
    return true;
  }

  return false;
}
