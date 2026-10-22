'use client';

import { Button } from '@/components/ui/button';
import { RadioGroup } from '@/components/ui/radio-group';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { SelectableCard } from '@/components/onboarding/SelectableCard';
import { layout } from '@/config/layout';
import type { Option } from '@/config/onboarding-steps';

interface QuestionScreenProps {
  title: string;
  subtitle?: string;
  options: readonly Option[];
  value: string | null;
  onValueChange: (value: string) => void;
  onContinue: () => void;
  actionLabel: string;
}

// Обёртка «вопрос + список вариантов + Продолжить».
export function QuestionScreen({
  title,
  subtitle,
  options,
  value,
  onValueChange,
  onContinue,
  actionLabel,
}: QuestionScreenProps) {
  return (
    <ScreenShell
      footer={
        <Button
          className={layout.cta}
          size="default"
          disabled={value === null}
          onClick={onContinue}
        >
          {actionLabel}
        </Button>
      }
    >
      <ScreenHeading title={title} subtitle={subtitle} />

      {/* Список тянется на всё свободное место: карточки делят его поровну,
          но не ниже тач-пола и не выше потолка - экран заполнен и всегда влезает. */}
      <RadioGroup
        value={value ?? ''}
        onValueChange={(next) => onValueChange(String(next))}
        className={layout.list}
      >
        {options.map((option) => (
          <SelectableCard
            key={option.id}
            value={option.id}
            label={option.label}
            description={option.description}
            icon={option.icon}
            className={layout.card}
          />
        ))}
      </RadioGroup>
    </ScreenShell>
  );
}
