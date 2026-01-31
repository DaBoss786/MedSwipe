export function recordAnsweredQuestion(answeredQuestions, questionId, entry) {
  const safeAnsweredQuestions = answeredQuestions || {};

  if (safeAnsweredQuestions[questionId]) {
    return { answeredQuestions: safeAnsweredQuestions, added: false };
  }

  return {
    answeredQuestions: { ...safeAnsweredQuestions, [questionId]: entry },
    added: true
  };
}

export function getAnsweredQuestionIds(answeredQuestions) {
  return Object.keys(answeredQuestions || {});
}
