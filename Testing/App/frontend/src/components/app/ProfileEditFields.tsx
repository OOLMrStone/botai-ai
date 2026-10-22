'use client';

import { ProfileChoiceField } from '@/components/app/ProfileChoiceField';
import { PROFILE_COPY } from '@/config/profile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { layout } from '@/config/layout';
import { COPY, DAILY_GOAL_OPTIONS, GOAL_OPTIONS, LEVEL_OPTIONS } from '@/config/onboarding-steps';

interface ProfileEditFieldsProps {
  name: string;
  onNameChange: (value: string) => void;
  goalId: string;
  onGoalChange: (goalId: string) => void;
  levelId: string;
  onLevelChange: (levelId: string) => void;
  dailyMinutes: number;
  onDailyChange: (minutes: number) => void;
}

// Поля режима редактирования профиля: обращение + выбор цели дня и цели по ЕГЭ.
// Выбор вариантов - тот же RadioGroup + SelectableCard, что и в онбординге.
export function ProfileEditFields({
  name,
  onNameChange,
  goalId,
  onGoalChange,
  levelId,
  onLevelChange,
  dailyMinutes,
  onDailyChange,
}: ProfileEditFieldsProps) {
  const dailyId = DAILY_GOAL_OPTIONS.find((option) => option.minutes === dailyMinutes)?.id ?? '';

  return (
    <div className={layout.settings.fields}>
      <div className={layout.settings.fieldGroup}>
        <Label htmlFor="profile-name" className={layout.typography.sectionTitle}>
          {COPY.profile.nameTitle}
        </Label>
        <Input
          id="profile-name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={COPY.profile.namePlaceholder}
          className={layout.settings.input}
        />
      </div>

      <ProfileChoiceField
        title={PROFILE_COPY.level}
        options={LEVEL_OPTIONS}
        value={levelId}
        onValueChange={onLevelChange}
      />
      <ProfileChoiceField
        title={COPY.profile.dailyGoalTitle}
        options={DAILY_GOAL_OPTIONS}
        value={dailyId}
        onValueChange={(next) => {
          const option = DAILY_GOAL_OPTIONS.find((item) => item.id === next);
          if (option) onDailyChange(option.minutes);
        }}
      />
      <ProfileChoiceField
        title={COPY.profile.goalTitle}
        options={GOAL_OPTIONS}
        value={goalId}
        onValueChange={onGoalChange}
      />
    </div>
  );
}
