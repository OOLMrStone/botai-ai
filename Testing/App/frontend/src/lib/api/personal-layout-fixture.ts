import { PERSONAL_LAYOUT_FIXTURE_LOCAL } from '@/config/env';
import { PERSONAL_LAYOUT_FIXTURE as CONFIG } from '@/config/personal-layout-fixture';
import type { ExpertWorkDto } from '@/lib/api/expert-types';
import { apiFetch } from '@/lib/api/client';
import { expertWorkFromDto } from '@/lib/expert-adapter';
import {
  projectPersonalLayout,
  type PersonalLayoutProjection,
} from '@/lib/personal-layout-fixture';

export async function personalLayoutWork(work: ExpertWorkDto) {
  if (PERSONAL_LAYOUT_FIXTURE_LOCAL) {
    try {
      const projection = await apiFetch<PersonalLayoutProjection>(
        `${CONFIG.endpoint}?${new URLSearchParams({ workId: work.id })}`,
      );
      return projectPersonalLayout(work, projection);
    } catch {
      /* Отсутствующий fixture оставляет исходный AI-разбор. */
    }
  }
  return expertWorkFromDto(work);
}
