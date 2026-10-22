import { cachedResource } from '@/lib/cached-resource';
import { fetchProfile } from '@/lib/api/profile';
export const profileResource = cachedResource(fetchProfile);
