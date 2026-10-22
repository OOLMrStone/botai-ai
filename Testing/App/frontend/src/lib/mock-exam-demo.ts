import { MOCK_EXAM_DEMO } from '@/config/mock-exam-demo';

export function isMockExamDemo(examId: string) {
  return MOCK_EXAM_DEMO.enabled && examId === MOCK_EXAM_DEMO.examId;
}

export function isMockExamDemoTask(examId: string, taskId?: string) {
  return isMockExamDemo(examId) && taskId === MOCK_EXAM_DEMO.taskId;
}
