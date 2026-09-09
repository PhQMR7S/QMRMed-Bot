export type QuizQuestion = {
  type: 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER';
  options?: unknown;
  answer: string;
};

export type QuizSessionState = {
  ids: number[];
  index: number;
  correct: number;
  exam: boolean;
  startedAt: number;
};

export const EXAM_DURATION_MS = 15 * 60_000;

export function isQuizExpired(session: QuizSessionState, now = Date.now()) {
  return session.exam && now - session.startedAt >= EXAM_DURATION_MS;
}

export function resolveSelectedValue(question: QuizQuestion, selected: string) {
  const options = question.options;
  if (Array.isArray(options) && /^\d+$/.test(selected)) {
    const value = options[Number(selected)];
    return value === undefined ? selected : String(value);
  }
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    const value = (options as Record<string, unknown>)[selected];
    return value === undefined ? selected : String(value);
  }
  return selected;
}

export function isAnswerCorrect(question: QuizQuestion, selected: string) {
  const selectedValue = resolveSelectedValue(question, selected);
  return selectedValue.trim().toLocaleLowerCase() === question.answer.trim().toLocaleLowerCase();
}

export function canUseInButtonQuiz(question: QuizQuestion) {
  return question.type === 'MCQ' || question.type === 'TRUE_FALSE';
}
