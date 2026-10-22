import { MOCK_EXAM_DEMO } from '@/config/mock-exam-demo';
import { sleep } from '@/lib/api/client';

export async function checkDemoPhoto(signal: AbortSignal): Promise<void> {
  // TODO: заменить подготовленную проверку запросом к сканеру.
  await sleep(MOCK_EXAM_DEMO.photoMs, signal);
}

export async function checkDemoSolution(signal: AbortSignal): Promise<{ score: number }> {
  // TODO: получать разбор конкретного решения от бэкенда.
  await sleep(MOCK_EXAM_DEMO.solutionMs, signal);
  return { score: MOCK_EXAM_DEMO.score };
}
