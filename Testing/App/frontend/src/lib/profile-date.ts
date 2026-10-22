import { PROFILE_DATE_FORMAT, PROFILE_DATE_SUFFIX } from '@/config/profile';

export function formatProfileDate(date: string) {
  return PROFILE_DATE_FORMAT.format(new Date(date)).replace(PROFILE_DATE_SUFFIX, '');
}
