import type { RefObject } from 'react';
import { Search, X } from 'lucide-react';

import {
  ExpertMathSymbolButton,
  type ExpertMathSymbolActions,
} from '@/components/expert/ExpertMathSymbolButton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  EXPERT_MATH_COPY as COPY,
  EXPERT_MATH_SYMBOL_GROUPS,
  type ExpertMathSymbolGroup,
} from '@/config/expert-math';
import { layout } from '@/config/layout';
import { preventGestureContextMenuOutsideEditable } from '@/lib/gesture-surface';
import { cn } from '@/lib/utils';

interface ExpertMathPaletteProps extends ExpertMathSymbolActions {
  paletteRef: RefObject<HTMLDivElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  id: string;
  groupId: string;
  onGroupChange: (id: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
  onClearSearch: () => void;
  searching: boolean;
  groups: readonly ExpertMathSymbolGroup[];
}

export function ExpertMathPalette({
  paletteRef,
  searchRef,
  id,
  groupId,
  onGroupChange,
  query,
  onQueryChange,
  onClearSearch,
  searching,
  groups,
  onInsert,
  onPointerDown,
  disabled,
}: ExpertMathPaletteProps) {
  const styles = layout.expertMath;

  return (
    <div
      ref={paletteRef}
      id={id}
      className={cn(styles.palette, layout.gestureSurface)}
      aria-label={COPY.symbolsLabel}
      onContextMenu={preventGestureContextMenuOutsideEditable}
    >
      <div className={styles.search}>
        <Search className={styles.searchIcon} aria-hidden="true" />
        <Input
          ref={searchRef}
          type="search"
          aria-label={COPY.searchLabel}
          placeholder={COPY.search}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className={styles.searchInput}
          autoComplete="off"
        />
        {query ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-compact"
            className={styles.searchClear}
            aria-label={COPY.clearSearch}
            onPointerDown={onPointerDown}
            onClick={onClearSearch}
          >
            <X className={styles.icon} aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {!searching ? (
        <div className={styles.groups} role="group" aria-label={COPY.groupsLabel}>
          {EXPERT_MATH_SYMBOL_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              className={cn(
                layout.expert.taskTab,
                styles.groupTab,
                groupId === group.id && layout.expert.taskActive,
              )}
              aria-pressed={groupId === group.id}
              onPointerDown={onPointerDown}
              onClick={() => onGroupChange(group.id)}
            >
              {group.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.results} aria-live="polite">
        {groups.length ? (
          groups.map((group) => (
            <div key={group.id} className={styles.resultGroup}>
              {searching ? <p className={styles.resultLabel}>{group.label}</p> : null}
              <div className={styles.symbols} role="group" aria-label={group.label}>
                {group.symbols.map((symbol) => (
                  <ExpertMathSymbolButton
                    key={symbol.id}
                    symbol={symbol}
                    onInsert={onInsert}
                    onPointerDown={onPointerDown}
                    disabled={disabled}
                  />
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className={styles.empty}>{COPY.noResults}</p>
        )}
      </div>
    </div>
  );
}
