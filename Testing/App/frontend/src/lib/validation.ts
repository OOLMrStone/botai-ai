import { PASSWORD_MIN_LENGTH } from '@/config/auth';
import { SHORT_ANSWER } from '@/config/short-answer';

// Правила валидации форм - чистые функции, одна ответственность на функцию.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH;
}

export function isValidName(name: string): boolean {
  return name.trim().length > 0;
}

export function isShortAnswerDraft(answer: string): boolean {
  return SHORT_ANSWER.draft.test(answer);
}

export function isValidShortAnswer(answer: string | undefined): answer is string {
  return answer !== undefined && SHORT_ANSWER.complete.test(answer);
}

export function normalizeShortAnswer(answer: string): string | null {
  if (!isValidShortAnswer(answer)) return null;

  const negative = answer.startsWith(SHORT_ANSWER.minus);
  const unsigned = negative ? answer.slice(SHORT_ANSWER.minus.length) : answer;
  const [whole, fraction = ''] = unsigned.split(SHORT_ANSWER.separator);
  const integer = whole.replace(SHORT_ANSWER.leadingZeros, '');
  const decimal = fraction.replace(SHORT_ANSWER.trailingZeros, '');
  const sign = negative && (integer !== SHORT_ANSWER.zero || decimal) ? SHORT_ANSWER.minus : '';

  return `${sign}${integer}${decimal ? SHORT_ANSWER.decimal + decimal : ''}`;
}
