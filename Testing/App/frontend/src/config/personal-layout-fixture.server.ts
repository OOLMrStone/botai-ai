import { PERSONAL_LAYOUT_FIXTURE_DIRECTORY } from '@/config/env';

export const PERSONAL_LAYOUT_FIXTURE_SERVER = {
  directory: PERSONAL_LAYOUT_FIXTURE_DIRECTORY,
  manifestName: 'manifest.json',
  reviewName: 'review.expert-review.v2.json',
  reviewSha256: '5df5a3e203c146294a2a26907a8e739b22bef64009516c1abd34a29818926dd8',
  manifestMaxBytes: 16 * 1024,
  hosts: ['expert.localhost', 'dev.localhost', 'localhost', '127.0.0.1'],
  backendHosts: ['localhost', '127.0.0.1'],
  backendPort: '18086',
  schemaVersion: 'personal-layout-fixture.v1',
} as const;
