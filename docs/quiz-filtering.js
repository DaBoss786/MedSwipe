export function applyCategoryAndAnsweredFilters({
  questions,
  category,
  bookmarksOnly = false,
  includeAnswered = false,
  answeredIds = []
}) {
  let filtered = questions;

  if (!bookmarksOnly && category && category !== "") {
    filtered = filtered.filter(q => q["Category"] && q["Category"].trim() === category);
  }

  if (!bookmarksOnly && !includeAnswered && answeredIds.length > 0) {
    filtered = filtered.filter(q => !answeredIds.includes(q["Question"]?.trim()));
  }

  return filtered;
}
