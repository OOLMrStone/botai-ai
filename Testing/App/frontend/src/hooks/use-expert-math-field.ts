'use client';

import { useEffect, useEffectEvent, useId, useRef, useState, type PointerEvent } from 'react';
import type { MathfieldElement } from 'mathlive';

import {
  EXPERT_MATH,
  EXPERT_MATH_STRUCTURE,
  EXPERT_MATH_SYMBOL_GROUPS,
} from '@/config/expert-math';
import { layout } from '@/config/layout';
import { useGestureSurfaceGuard } from '@/hooks/use-gesture-surface-guard';
import {
  createMathStructureReader,
  deleteEmptyMathDelimiter,
  deleteEmptyMathStructure,
  insertMathStructureRow,
} from '@/lib/expert-math-structure';

interface ExpertMathFieldOptions {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  onValidityChange?: (ready: boolean) => void;
}

export function useExpertMathField({
  value,
  onChange,
  label,
  disabled,
  onValidityChange,
}: ExpertMathFieldOptions) {
  const hostRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [invalid, setInvalid] = useState<'incomplete' | 'invalid' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [groupId, setGroupId] = useState<string>(EXPERT_MATH_SYMBOL_GROUPS[0].id);
  const [query, setQuery] = useState('');
  const paletteId = useId();
  const readValue = useEffectEvent(() => value);
  const readLabel = useEffectEvent(() => label);
  const readDisabled = useEffectEvent(() => Boolean(disabled));
  const change = useEffectEvent(onChange);
  const notifyValidity = useEffectEvent((valid: boolean) => onValidityChange?.(valid));
  const validate = useEffectEvent((field: MathfieldElement) => {
    const incomplete = !field.value.trim() || field.value.includes(EXPERT_MATH.placeholderCommand);
    const issue = incomplete ? 'incomplete' : field.errors.length ? 'invalid' : null;
    field.setAttribute('aria-invalid', String(Boolean(issue)));
    setInvalid(issue);
  });

  useGestureSurfaceGuard(toolbarRef);
  useGestureSurfaceGuard(paletteRef, { enabled: symbolsOpen });

  useEffect(() => {
    notifyValidity(status === 'ready' && invalid === null);
  }, [status, invalid]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let release = () => {};

    import('mathlive')
      .then(({ MathfieldElement: Mathfield }) => {
        if (disposed) return;

        Mathfield.locale = EXPERT_MATH.locale;
        Mathfield.decimalSeparator = EXPERT_MATH.decimalSeparator;
        Mathfield.fontsDirectory = null;
        Mathfield.soundsDirectory = null;
        Mathfield.computeEngine = null;
        Mathfield.keypressVibration = false;

        const field = new Mathfield();
        const readStructure = createMathStructureReader(field);
        let handledKey: 'Enter' | 'Backspace' | null = null;
        field.className = layout.expertMath.field;
        field.setAttribute('aria-label', readLabel());
        field.setAttribute('lang', EXPERT_MATH.locale);
        field.defaultMode = 'math';
        field.smartMode = false;
        field.mathVirtualKeyboardPolicy = EXPERT_MATH.keyboardPolicy;
        field.disabled = readDisabled();
        field.setValue(readValue(), { silenceNotifications: true });

        const nativeKeyboard = () => {
          window.mathVirtualKeyboard.hide(EXPERT_MATH.keyboardMotion);
          // MathLive подавляет системную клавиатуру на своём внутреннем поле ввода.
          field.shadowRoot
            ?.querySelector<HTMLElement>(EXPERT_MATH.nativeInputSelector)
            ?.setAttribute('inputmode', EXPERT_MATH.nativeInputMode);
        };
        const input = () => {
          validate(field);
          change(field.value);
        };
        const applyStructureInput = (key: 'Enter' | 'Backspace') =>
          key === 'Enter'
            ? insertMathStructureRow(field, readStructure())
            : deleteEmptyMathDelimiter(field) || deleteEmptyMathStructure(field, readStructure());
        const handleKeyDown = (event: KeyboardEvent) => {
          if (EXPERT_MATH.blockedKeys.some((key) => key === event.key)) event.preventDefault();
          handledKey = null;
          if (
            (event.key === 'Backspace' || event.key === 'Enter') &&
            !event.isComposing &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            applyStructureInput(event.key)
          ) {
            handledKey = event.key;
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        };
        const resetHandledKey = () => {
          handledKey = null;
        };
        const beforeInput = (event: InputEvent) => {
          if (!event.isTrusted || event.isComposing) return;

          const key = EXPERT_MATH_STRUCTURE.rowInputTypes.some((type) => type === event.inputType)
            ? 'Enter'
            : event.inputType === 'deleteContentBackward'
              ? 'Backspace'
              : null;
          if (key && (handledKey === key || applyStructureInput(key))) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        };

        field.addEventListener('input', input);
        field.addEventListener('mount', nativeKeyboard);
        field.addEventListener('focusin', nativeKeyboard);
        field.addEventListener('focusout', resetHandledKey);
        field.addEventListener('keydown', handleKeyDown, true);
        field.addEventListener('keyup', resetHandledKey, true);
        field.addEventListener('beforeinput', beforeInput, true);
        host.replaceChildren(field);
        field.menuItems = [];
        field.environmentPopoverPolicy = 'off';
        fieldRef.current = field;

        release = () => {
          field.removeEventListener('input', input);
          field.removeEventListener('mount', nativeKeyboard);
          field.removeEventListener('focusin', nativeKeyboard);
          field.removeEventListener('focusout', resetHandledKey);
          field.removeEventListener('keydown', handleKeyDown, true);
          field.removeEventListener('keyup', resetHandledKey, true);
          field.removeEventListener('beforeinput', beforeInput, true);
          field.remove();
          fieldRef.current = null;
        };

        // Эти свойства MathLive доступны только после connectedCallback.
        field.inlineShortcuts = { ...field.inlineShortcuts, ...EXPERT_MATH.inlineShortcuts };
        field.keybindings = field.keybindings.filter(
          (binding) => !EXPERT_MATH.sourceModeShortcuts.some((key) => key === binding.key),
        );
        nativeKeyboard();
        validate(field);
        setStatus('ready');
      })
      .catch(() => {
        if (!disposed) {
          release();
          setStatus('error');
        }
      });

    return () => {
      disposed = true;
      release();
    };
  }, [attempt]);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;

    if (field.value !== value) field.setValue(value, { silenceNotifications: true });
    field.setAttribute('aria-label', label);
    field.disabled = Boolean(disabled);
    validate(field);
  }, [value, label, disabled]);

  const insert = (template: string) => {
    const field = fieldRef.current;
    if (!field || disabled) return;

    field.focus();
    field.insert(template);
  };
  const retry = () => {
    setStatus('loading');
    setAttempt((current) => current + 1);
  };
  const preserveFocus = (event: PointerEvent<HTMLButtonElement>) => event.preventDefault();
  const group =
    EXPERT_MATH_SYMBOL_GROUPS.find((candidate) => candidate.id === groupId) ??
    EXPERT_MATH_SYMBOL_GROUPS[0];
  const normalizedQuery = query.trim().toLocaleLowerCase(EXPERT_MATH.locale);
  const visibleGroups = normalizedQuery
    ? EXPERT_MATH_SYMBOL_GROUPS.map((candidate) => ({
        ...candidate,
        symbols: candidate.symbols.filter((symbol) =>
          [symbol.label, symbol.id, symbol.preview, ...(symbol.aliases ?? [])].some((value) =>
            value.toLocaleLowerCase(EXPERT_MATH.locale).includes(normalizedQuery),
          ),
        ),
      })).filter((candidate) => candidate.symbols.length)
    : [group];
  const selectGroup = (id: string) => {
    setGroupId(id);
    setQuery('');
  };
  const clearSearch = () => {
    setQuery('');
    searchRef.current?.focus();
  };

  return {
    hostRef,
    toolbarRef,
    paletteRef,
    searchRef,
    paletteId,
    status,
    invalid,
    insert,
    retry,
    preserveFocus,
    symbolsOpen,
    toggleSymbols: () => setSymbolsOpen((open) => !open),
    groupId,
    selectGroup,
    query,
    setQuery,
    clearSearch,
    searching: Boolean(normalizedQuery),
    visibleGroups,
  };
}
