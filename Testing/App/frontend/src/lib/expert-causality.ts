import type { ExpertBlock, ExpertFinding } from '@/config/expert';
import { EXPERT_CAUSALITY_COPY, EXPERT_FINDING_REVIEW } from '@/config/expert-causality';

type ErrorRoots = Map<string, string[]>;

function resolveErrorRoots(block: ExpertBlock, earlierRoots: ErrorRoots): string[] {
  if (block.status === 'error') return [block.id];
  if (block.status !== 'follow_through') return [];

  return [
    ...new Set((block.followsFromBlockIds ?? []).flatMap((id) => earlierRoots.get(id) ?? [])),
  ];
}

function collectErrorRoots(blocks: ExpertBlock[]): ErrorRoots {
  const roots: ErrorRoots = new Map();

  for (const block of blocks) roots.set(block.id, resolveErrorRoots(block, roots));

  return roots;
}

function sameReferences(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((id, index) => id === second[index]);
}

export function updateExpertBlock(blocks: ExpertBlock[], edited: ExpertBlock): ExpertBlock[] {
  if (!blocks.some((block) => block.id === edited.id)) return blocks;

  const originalRoots = collectErrorRoots(blocks);
  const correctedCause = edited.status === 'correct' && !!originalRoots.get(edited.id)?.length;
  const earlierRoots: ErrorRoots = new Map();
  let replacementRoot: string | null = null;

  return blocks.map((original) => {
    const block = original.id === edited.id ? edited : original;
    if (block.status !== 'follow_through') {
      earlierRoots.set(block.id, resolveErrorRoots(block, earlierRoots));
      return block.followsFromBlockIds?.length ? { ...block, followsFromBlockIds: [] } : block;
    }

    const references = block.followsFromBlockIds ?? [];
    const rebasedReferences = references.map((id) =>
      id === edited.id && replacementRoot ? replacementRoot : id,
    );
    const roots = resolveErrorRoots(
      { ...block, followsFromBlockIds: rebasedReferences },
      earlierRoots,
    );

    // Переносим ошибку только по явно исправленной причине, не угадываем её по соседству.
    if (
      !roots.length &&
      correctedCause &&
      earlierRoots.has(edited.id) &&
      references.includes(edited.id)
    ) {
      replacementRoot = block.id;
      earlierRoots.set(block.id, [block.id]);
      return {
        ...block,
        status: 'error',
        followsFromBlockIds: [],
        explanation: EXPERT_CAUSALITY_COPY.promoted,
      };
    }

    earlierRoots.set(block.id, roots);
    const causeChanged = !sameReferences(originalRoots.get(block.id) ?? [], roots);
    const explanation =
      block.id !== edited.id && causeChanged
        ? roots.length
          ? EXPERT_CAUSALITY_COPY.rebased
          : EXPERT_CAUSALITY_COPY.missingCause
        : block.explanation;

    return sameReferences(references, roots) && explanation === block.explanation
      ? block
      : { ...block, followsFromBlockIds: roots, explanation };
  });
}

export function updateExpertFindings(
  before: ExpertBlock[],
  after: ExpertBlock[],
  findings: ExpertFinding[],
  editedId: string,
): ExpertFinding[] {
  const previous = before.find((block) => block.id === editedId);
  const edited = after.find((block) => block.id === editedId);
  if (
    !previous ||
    edited?.status !== 'correct' ||
    (previous.status !== 'error' && previous.status !== 'follow_through')
  )
    return findings;
  const replacement = after.find(
    (block) =>
      block.status === 'error' &&
      before.find((original) => original.id === block.id)?.status === 'follow_through',
  );

  return findings.map((finding) => {
    if (finding.blockId !== editedId || finding.kind === 'warning') return finding;
    const note = replacement ? EXPERT_FINDING_REVIEW.moved : EXPERT_FINDING_REVIEW.corrected;
    const original = [EXPERT_FINDING_REVIEW.moved, EXPERT_FINDING_REVIEW.corrected].reduce(
      (text, prefix) =>
        text.startsWith(`${prefix}\n\n`) ? text.slice(prefix.length + '\n\n'.length) : text,
      finding.description,
    );

    return {
      ...finding,
      blockId: replacement?.id ?? finding.blockId,
      title: EXPERT_FINDING_REVIEW.title,
      description: `${note}\n\n${original}`,
    };
  });
}
