'use client';

import { useState } from 'react';
import { useGridMathValidity } from '@/hooks/use-grid-math-validity';
import {
  EXPERT_STATUS_OPTIONS,
  type ExpertAnalysis,
  type ExpertBlock,
  type ExpertDiagram,
  type ExpertFinding,
  type ExpertTask,
} from '@/config/expert';
import { EXPERT_UI, type GridAnalysisMode } from '@/config/expert-ui';
import {
  supportsExpertFindingDeductions,
  validateExpertBlock,
  validateExpertBlockCauses,
  validateExpertFindingDeduction,
} from '@/lib/expert';
import { gridErrorSources } from '@/lib/grid-view';

export function useGridBlockEditor(
  initial: ExpertBlock,
  task: ExpertTask,
  onApply: (block: ExpertBlock) => void,
) {
  const [block, setBlock] = useState(initial);
  const [geometryValid, setGeometryValid] = useState(true);
  const [richTextValid, setRichTextValid] = useState(false);
  const [formulaIds, setFormulaIds] = useState(() =>
    initial.kind === 'math' ? initial.formulas.map((_, index) => String(index)) : [],
  );
  const math = useGridMathValidity(formulaIds);
  const setFormulaValid = (index: number, valid: boolean) =>
    math.setValidity(formulaIds[index], valid);
  const [showPhoto, setShowPhoto] = useState(false);
  const setCommon = (patch: Partial<Pick<ExpertBlock, 'title' | 'explanation'>>) =>
    setBlock((current) => ({ ...current, ...patch }));
  const errorSources = gridErrorSources(task, block.id);
  const causesValid = !validateExpertBlockCauses(task, block);
  const setStatus = (value: string) => {
    const status = EXPERT_STATUS_OPTIONS.find((option) => option.value === value)?.value ?? null;
    setBlock((current) => ({
      ...current,
      status,
      followsFromBlockIds: status === 'follow_through' ? current.followsFromBlockIds : [],
    }));
  };
  const toggleErrorSource = (id: string) => {
    if (!errorSources.some((source) => source.id === id)) return;

    setBlock((current) => {
      const selected = (current.followsFromBlockIds ?? []).filter((sourceId) =>
        errorSources.some((source) => source.id === sourceId),
      );

      return {
        ...current,
        followsFromBlockIds: selected.includes(id)
          ? selected.filter((sourceId) => sourceId !== id)
          : [...selected, id],
      };
    });
  };
  const setFormula = (index: number, value: string) =>
    setBlock((current) =>
      current.kind === 'math'
        ? {
            ...current,
            formulas: current.formulas.map((formula, i) => (i === index ? value : formula)),
          }
        : current,
    );
  const addFormula = () => {
    setFormulaIds((current) => [...current, crypto.randomUUID()]);
    setBlock((current) =>
      current.kind === 'math'
        ? { ...current, formulas: [...current.formulas, EXPERT_UI.emptyFormula] }
        : current,
    );
  };
  const removeFormula = (index: number) => {
    setFormulaIds((current) => current.filter((_, i) => i !== index));
    setBlock((current) =>
      current.kind === 'math'
        ? { ...current, formulas: current.formulas.filter((_, i) => i !== index) }
        : current,
    );
  };
  const setText = (text: string) =>
    setBlock((current) =>
      current.kind === 'text'
        ? { ...current, text }
        : current.kind === 'step'
          ? { ...current, lines: text.split('\n') }
          : current,
    );
  const diagram =
    block.kind === 'step'
      ? block.diagram
      : block.kind === 'number_line' || block.kind === 'unit_circle'
        ? block
        : undefined;
  const setDiagram = (next: ExpertDiagram) =>
    setBlock((current) =>
      current.kind === 'step'
        ? { ...current, diagram: next }
        : current.kind === next.kind
          ? { ...current, ...next }
          : current,
    );
  const canApply =
    geometryValid &&
    causesValid &&
    !validateExpertBlock(block) &&
    Boolean(block.title.trim()) &&
    (block.kind !== 'math' ||
      (math.valid &&
        block.formulas.length > 0 &&
        block.formulas.every((formula) => formula.trim() && !formula.includes('\\placeholder')))) &&
    (block.kind !== 'text' || (richTextValid && Boolean(block.text.trim()))) &&
    (block.kind !== 'step' ||
      richTextValid ||
      (!block.lines.some((line) => line.trim()) && Boolean(block.image || block.diagram)));

  return {
    block,
    geometryValid,
    setGeometryValid,
    setFormulaValid,
    formulaIds,
    setRichTextValid,
    showPhoto,
    togglePhoto: () => setShowPhoto((shown) => !shown),
    diagram,
    setDiagram,
    setCommon,
    setStatus,
    errorSources,
    causesValid,
    toggleErrorSource,
    markErrorHere: () => setStatus('error'),
    setFormula,
    addFormula,
    removeFormula,
    setText,
    canApply,
    apply: () => {
      if (canApply) onApply(block);
    },
  };
}

export function useGridAnalysisEditor(
  task: ExpertTask,
  mode: GridAnalysisMode,
  onApply: (analysis: ExpertAnalysis) => void,
) {
  const [analysis, setAnalysis] = useState(task.analysis);
  const canEditDeductions = supportsExpertFindingDeductions(task);
  const update = (patch: Partial<ExpertAnalysis>) =>
    setAnalysis((current) => ({ ...current, ...patch }));
  const updateFinding = (id: string, patch: Partial<ExpertFinding>) =>
    setAnalysis((current) => ({
      ...current,
      findings: current.findings.map((finding) =>
        finding.id === id ? { ...finding, ...patch } : finding,
      ),
    }));
  const addFinding = () => {
    const block = task.blocks[0];
    if (!block) return;
    setAnalysis((current) => ({
      ...current,
      findings: [
        ...current.findings,
        { id: crypto.randomUUID(), blockId: block.id, title: '', description: '' },
      ],
    }));
  };
  const removeFinding = (id: string) =>
    setAnalysis((current) => ({
      ...current,
      findings: current.findings.filter((finding) => finding.id !== id),
    }));
  const deductionError = analysis.findings
    .map((finding) => validateExpertFindingDeduction(task, finding))
    .find(Boolean);
  const canApply =
    mode === 'score'
      ? Boolean(analysis.verdict.trim()) &&
        Number.isInteger(analysis.score) &&
        analysis.score >= 0 &&
        analysis.score <= analysis.maxScore
      : mode === 'advice' ||
        analysis.findings.every(
          (finding) =>
            finding.title.trim() &&
            finding.description.trim() &&
            !validateExpertFindingDeduction(task, finding) &&
            (!finding.blockId || task.blocks.some((block) => block.id === finding.blockId)),
        );

  return {
    analysis,
    canEditDeductions,
    deductionError,
    update,
    updateFinding,
    addFinding,
    removeFinding,
    canApply,
    apply: () => {
      if (canApply) onApply(analysis);
    },
  };
}
