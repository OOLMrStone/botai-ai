'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { useExpertWorkspace } from '@/hooks/use-expert-workspace';
import { EXPERT_UI } from '@/config/expert-ui';
import { EXPERT_REVIEW_SCROLL } from '@/config/expert-review';
import { QUIZ_MOTION } from '@/config/quiz-motion';
import { centeredExperimentalScrollTop } from '@/lib/experimental-reveal';
import { useB2bLogin } from '@/hooks/use-b2b-login';

export type GridWorkspace = ReturnType<typeof useExpertWorkspace>;
export type GridDialog =
  'student' | 'criterion' | 'score' | 'advice' | 'findings' | 'logout' | null;

function reviewViewportTop(pane: HTMLElement, local: boolean) {
  if (local) return pane.getBoundingClientRect().top;
  const navigation = document.querySelector<HTMLElement>(EXPERT_UI.sectionNavSelector);
  return navigation?.getBoundingClientRect().height ?? 0;
}

export function useGridUi(workspace: GridWorkspace) {
  const [dialog, setDialog] = useState<GridDialog>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceScroll = useRef({ top: 0, blockId: undefined as string | undefined, offset: 0 });

  const selectedTask = workspace.selectedTask;
  const taskId = selectedTask?.id;
  const view = workspace.view;
  const { feedback, clearFeedback } = workspace;
  const toggleSource = (open: boolean) => {
    const pane = document.querySelector<HTMLElement>(EXPERT_UI.documentSelector);
    if (!pane) return;
    const local = ['auto', 'scroll'].includes(getComputedStyle(pane).overflowY);
    const top = reviewViewportTop(pane, local);
    const block = Array.from(
      pane?.querySelectorAll<HTMLElement>(EXPERT_UI.blockSelector) ?? [],
    ).find((element) => element.getBoundingClientRect().bottom > top);
    sourceScroll.current = {
      top: local ? pane.scrollTop : window.scrollY,
      blockId: block?.dataset.expertBlock,
      offset: block ? block.getBoundingClientRect().top - top : 0,
    };
    setSourceOpen(open);
  };
  useLayoutEffect(() => {
    const pane = document.querySelector<HTMLElement>(EXPERT_UI.documentSelector);
    if (!pane) return;
    const local = ['auto', 'scroll'].includes(getComputedStyle(pane).overflowY);
    const block = Array.from(pane.querySelectorAll<HTMLElement>(EXPERT_UI.blockSelector)).find(
      (element) => element.dataset.expertBlock === sourceScroll.current.blockId,
    );
    const currentTop = local ? pane.scrollTop : window.scrollY;
    const viewportTop = reviewViewportTop(pane, local);
    const top = block
      ? currentTop + block.getBoundingClientRect().top - viewportTop - sourceScroll.current.offset
      : sourceScroll.current.top;
    (local ? pane : window).scrollTo({
      ...EXPERT_REVIEW_SCROLL,
      top,
    });
  }, [sourceOpen]);
  useLayoutEffect(() => {
    if (view !== 'review' || !taskId) return;
    const documentPane = document.querySelector<HTMLElement>(EXPERT_UI.documentSelector);
    const verdictPane = document.querySelector<HTMLElement>(EXPERT_UI.verdictBodySelector);
    documentPane?.scrollTo(EXPERT_REVIEW_SCROLL);
    verdictPane?.scrollTo(EXPERT_REVIEW_SCROLL);
    if (documentPane && !['auto', 'scroll'].includes(getComputedStyle(documentPane).overflowY))
      document.querySelector(EXPERT_UI.reviewSelector)?.scrollIntoView({
        block: 'start',
        behavior: EXPERT_REVIEW_SCROLL.behavior,
      });
  }, [taskId, view]);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(clearFeedback, EXPERT_UI.feedbackMs);
    return () => window.clearTimeout(timer);
  }, [feedback, clearFeedback]);
  const editingBlock = selectedTask?.blocks.find((block) => block.id === editingBlockId) ?? null;
  const openWork = (id: string) => {
    setSelectedBlockId(null);
    workspace.openWork(id);
  };
  const selectTask = (id: string) => {
    setSelectedBlockId(null);
    workspace.selectTask(id);
  };
  const logout = () => {
    if (workspace.hasUnsavedChanges) setDialog('logout');
    else void workspace.logout();
  };
  const confirmLogout = async () => {
    await workspace.logout(true);
    setDialog(null);
  };
  const openStudentWorks = (name: string) => {
    workspace.setQuery(name);
    workspace.setFilter('pending');
    workspace.setView('queue');
  };
  const revealBlock = (id: string) => {
    const target = Array.from(document.querySelectorAll<HTMLElement>(EXPERT_UI.blockSelector)).find(
      (element) => element.dataset.expertBlock === id,
    );
    const container = target?.closest<HTMLElement>(EXPERT_UI.documentSelector);
    if (!target || !container) return;
    const local = ['auto', 'scroll'].includes(getComputedStyle(container).overflowY);
    const scrollElement = local ? container : document.documentElement;
    const bounds = container.getBoundingClientRect();
    const top = centeredExperimentalScrollTop({
      target: target.getBoundingClientRect(),
      viewport: {
        top: reviewViewportTop(container, local) + EXPERT_UI.revealInset,
        bottom: local ? bounds.bottom : window.innerHeight,
      },
      scrollTop: scrollElement.scrollTop,
      maxScrollTop: scrollElement.scrollHeight - scrollElement.clientHeight,
    });
    const behavior = window.matchMedia(QUIZ_MOTION.reducedMotionQuery).matches
      ? 'instant'
      : 'smooth';
    if (local) container.scrollTo({ top, behavior });
    else window.scrollTo({ top, behavior });
    setSelectedBlockId(id);
  };

  return {
    sourceOpen,
    openSource: () => toggleSource(true),
    closeSource: () => toggleSource(false),
    dialog,
    setDialog,
    editingBlock,
    setEditingBlockId,
    selectedBlockId,
    setSelectedBlockId,
    openWork,
    selectTask,
    logout,
    confirmLogout,
    openStudentWorks,
    revealBlock,
  };
}

export type GridUi = ReturnType<typeof useGridUi>;

export function useGridLogin(workspace: GridWorkspace) {
  return useB2bLogin(workspace.login);
}

export function useGridStudent(workspace: GridWorkspace, onClose: () => void) {
  const [studentId, setStudentId] = useState('');

  const submit = async () => {
    if (await workspace.addStudent(studentId)) {
      setStudentId('');
      onClose();
    }
  };

  return { studentId, setStudentId, submit };
}
