import { EXPERIMENTAL_STUDENTS } from '@/config/experimental';
import { EXPERIMENTAL_QUEUE, type ExperimentalQueueSort } from '@/config/experimental-workspace';

export function getExperimentalQueue(query: string, sort: ExperimentalQueueSort) {
  const terms = query.trim().toLowerCase().split(/\s+/);
  const students = EXPERIMENTAL_STUDENTS.filter((student) =>
    terms.every((term) => student.name.toLowerCase().includes(term)),
  );
  const order = EXPERIMENTAL_QUEUE.sortOptions.find((option) => option.id === sort);

  return order
    ? students.sort(
        (first, second) =>
          (first.submittedAgoMinutes - second.submittedAgoMinutes) * order.direction,
      )
    : students;
}
