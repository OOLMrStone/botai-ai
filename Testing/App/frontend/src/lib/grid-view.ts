import {
  EXPERT_COPY,
  type ExpertTask,
  type ExpertWork,
  type ExpertWorkspaceData,
} from '@/config/expert';
import { EXPERT_SOLUTION_COPY } from '@/config/expert-solution-layout';
import { EXPERT_UI_COPY } from '@/config/expert-ui';

export function gridReviewPresentation(task: ExpertTask) {
  const rejected = Boolean(task.analysis.rejectedReason);

  return {
    emptySolution: rejected ? EXPERT_SOLUTION_COPY.emptyRejected : EXPERT_SOLUTION_COPY.empty,
    emptyFindings: rejected
      ? EXPERT_UI_COPY.rejectedFindings
      : task.analysis.hasGrade === false
        ? EXPERT_UI_COPY.ungradedFindings
        : EXPERT_UI_COPY.noFindings,
  };
}

export function gridWorkLabel(work: ExpertWork) {
  return work.tasks.length === 1
    ? EXPERT_COPY.taskNumber(work.tasks[0].number)
    : EXPERT_COPY.tasks(work.tasks.length);
}

export function gridCounts(works: ExpertWork[]) {
  return {
    pending: works.filter((work) => work.status === 'pending').length,
    reviewed: works.filter((work) => work.status === 'reviewed').length,
  };
}

export function gridStudentRows(data: ExpertWorkspaceData) {
  return data.students.map((student) => ({
    ...student,
    pending: data.works.filter((work) => work.studentId === student.id && work.status === 'pending')
      .length,
  }));
}

export function gridScoreOptions(task: ExpertTask) {
  return Array.from({ length: task.analysis.maxScore + 1 }, (_, index) => index);
}

export function gridErrorSources(task: ExpertTask, blockId: string) {
  const index = task.blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return [];

  return task.blocks.slice(0, index).filter((block) => block.status === 'error');
}
