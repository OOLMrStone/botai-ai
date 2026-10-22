import { QuizExperience } from '@/components/quizzes/QuizExperience';
import { QuizzesComingSoon } from '@/components/quizzes/QuizzesComingSoon';
import { QUIZZES_ENABLED } from '@/config/navigation';

export default function QuizzesPage() {
  return QUIZZES_ENABLED ? <QuizExperience /> : <QuizzesComingSoon />;
}
