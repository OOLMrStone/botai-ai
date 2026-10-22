import { QUIZ_TOPICS, type QuizDifficulty, type QuizQuestion } from '@/config/quiz-content';
import { QUIZ_ENGINE, type QuizLength } from '@/config/quiz-engine';

export function selectQuizQuestions(
  topicId: string,
  difficulty: QuizDifficulty,
  length: QuizLength,
): QuizQuestion[] {
  const topic = QUIZ_TOPICS.find((candidate) => candidate.id === topicId);
  const available = topic?.questions.filter((question) => question.difficulty === difficulty) ?? [];
  const selected: QuizQuestion[] = [];

  for (let index = 0; index < length; index += 1) {
    const kind = QUIZ_ENGINE.mechanics[index % QUIZ_ENGINE.mechanics.length];
    const remaining = available.filter((candidate) => !selected.includes(candidate));
    const question = remaining.find((candidate) => candidate.kind === kind) ?? remaining[0];
    if (question) selected.push(question);
  }

  return selected;
}

export function isQuizAnswerReady(
  question: QuizQuestion | undefined,
  selectedIds: string[],
  matchedIds: string[],
) {
  if (!question) return false;
  if (question.kind === 'pairs') return matchedIds.length === question.pairs.length;
  if (question.kind === 'build') return selectedIds.length === question.answerIds.length;

  return selectedIds.length === 1;
}

export function isQuizAnswerCorrect(
  question: QuizQuestion,
  selectedIds: string[],
  pairMistakes: number,
) {
  if (question.kind === 'pairs') return pairMistakes === 0;
  if (question.kind === 'choice') return selectedIds[0] === question.answerIds[0];

  const acceptedAnswers = [question.answerIds, ...(question.equivalentAnswerIds ?? [])];

  return acceptedAnswers.some(
    (answerIds) =>
      answerIds.length === selectedIds.length &&
      answerIds.every((id, index) => id === selectedIds[index]),
  );
}

export function toggleQuizAnswer(question: QuizQuestion, selectedIds: string[], id: string) {
  if (question.kind === 'pairs') return selectedIds;
  const options = question.options;
  if (!options.some((option) => option.id === id)) return selectedIds;
  if (selectedIds.includes(id)) return selectedIds.filter((selectedId) => selectedId !== id);
  if (question.kind === 'choice') return [id];
  if (selectedIds.length === question.answerIds.length) return selectedIds;

  return [...selectedIds, id];
}

export function quizRightPairs(question: QuizQuestion | undefined) {
  if (question?.kind !== 'pairs') return [];

  const { hashOffset, hashPrime, multiplier, increment, range } = QUIZ_ENGINE.shuffle;
  let seed: number = hashOffset;
  for (const character of question.id) {
    seed = Math.imul(seed ^ character.charCodeAt(0), hashPrime) >>> 0;
  }
  const shuffled = [...question.pairs];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, multiplier) + increment) >>> 0;
    const target = Math.floor((seed / range) * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }

  return shuffled;
}

export function quizOptionsByIds(question: QuizQuestion | undefined, ids: string[]) {
  if (!question || question.kind === 'pairs') return [];
  const options = new Map(question.options.map((option) => [option.id, option]));

  return ids.flatMap((id) => {
    const option = options.get(id);
    return option ? [option] : [];
  });
}
