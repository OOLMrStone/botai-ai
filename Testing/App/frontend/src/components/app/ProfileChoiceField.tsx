'use client';

import { ChevronDown } from 'lucide-react';
import { FormSection } from '@/components/common/FormSection';
import { SelectableCard } from '@/components/onboarding/SelectableCard';
import { RadioGroup } from '@/components/ui/radio-group';
import { layout } from '@/config/layout';
import { PROFILE_COPY } from '@/config/profile';
import type { Option } from '@/config/onboarding-steps';

export function ProfileChoiceField({
  title,
  options,
  value,
  onValueChange,
}: {
  title: string;
  options: readonly Option[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.id === value);

  return (
    <FormSection title={title}>
      <details className={layout.settings.choice}>
        <summary className={layout.settings.choiceToggle}>
          <span>{selected?.label ?? PROFILE_COPY.choose}</span>
          <ChevronDown className={layout.settings.choiceChevron} aria-hidden="true" />
        </summary>
        <RadioGroup
          className={layout.settings.choiceOptions}
          aria-label={title}
          value={value}
          onValueChange={(next) => onValueChange(String(next))}
        >
          {options.map((option) => (
            <SelectableCard
              key={option.id}
              value={option.id}
              label={option.label}
              description={option.description}
              icon={option.icon}
            />
          ))}
        </RadioGroup>
      </details>
    </FormSection>
  );
}
