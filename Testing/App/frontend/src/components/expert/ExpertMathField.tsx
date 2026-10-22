'use client';

import 'mathlive/fonts.css';

import { ExpertMathPalette } from '@/components/expert/ExpertMathPalette';
import { ExpertMathToolbar } from '@/components/expert/ExpertMathToolbar';
import { Button } from '@/components/ui/button';
import { EXPERT_MATH_COPY as COPY } from '@/config/expert-math';
import { layout } from '@/config/layout';
import { useExpertMathField } from '@/hooks/use-expert-math-field';

interface ExpertMathFieldProps {
  value: string;
  onChange: (latex: string) => void;
  label: string;
  disabled?: boolean;
  onValidityChange?: (ready: boolean) => void;
}

export function ExpertMathField(props: ExpertMathFieldProps) {
  const {
    hostRef,
    toolbarRef,
    paletteRef,
    searchRef,
    paletteId,
    status,
    invalid,
    retry,
    symbolsOpen,
    toggleSymbols,
    insert,
    preserveFocus,
    groupId,
    selectGroup,
    query,
    setQuery,
    clearSearch,
    searching,
    visibleGroups,
  } = useExpertMathField(props);
  const styles = layout.expertMath;
  const disabled = props.disabled || status !== 'ready';

  return (
    <div className={styles.root}>
      <span className={styles.label}>{props.label}</span>
      <div ref={hostRef} className={styles.host} />
      {status === 'loading' ? (
        <p role="status" className={styles.pending}>
          {COPY.loading}
        </p>
      ) : null}
      {status === 'error' ? (
        <div role="alert" className={styles.error}>
          <span>{COPY.error}</span>
          <Button variant="outline" size="compact" onClick={retry}>
            {COPY.retry}
          </Button>
        </div>
      ) : null}
      <ExpertMathToolbar
        toolbarRef={toolbarRef}
        paletteId={paletteId}
        symbolsOpen={symbolsOpen}
        onToggleSymbols={toggleSymbols}
        onInsert={insert}
        onPointerDown={preserveFocus}
        disabled={disabled}
      />
      {symbolsOpen ? (
        <ExpertMathPalette
          paletteRef={paletteRef}
          searchRef={searchRef}
          id={paletteId}
          groupId={groupId}
          onGroupChange={selectGroup}
          query={query}
          onQueryChange={setQuery}
          onClearSearch={clearSearch}
          searching={searching}
          groups={visibleGroups}
          onInsert={insert}
          onPointerDown={preserveFocus}
          disabled={disabled}
        />
      ) : null}
      {status === 'ready' && invalid ? (
        <p role="status" className={styles.invalid}>
          {COPY[invalid]}
        </p>
      ) : null}
    </div>
  );
}
