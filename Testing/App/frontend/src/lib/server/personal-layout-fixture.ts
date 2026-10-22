import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKEND_URL, PERSONAL_LAYOUT_FIXTURE_LOCAL } from '@/config/env';
import { PERSONAL_LAYOUT_FIXTURE as CONFIG } from '@/config/personal-layout-fixture';
import { PERSONAL_LAYOUT_FIXTURE_SERVER as PRIVATE } from '@/config/personal-layout-fixture.server';
import type { ExpertWorkDto } from '@/lib/api/expert-types';
import type { PipelineRunDetail, PipelineRunPage } from '@/lib/api/pipeline-console-types';
import {
  bindPersonalLayoutReview,
  isUneditedGradedWork,
  matchesPersonalLayout,
  personalLayoutSessionCookie,
  type PersonalLayoutManifest,
  type PersonalLayoutProjection,
} from '@/lib/personal-layout-fixture';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function privateFile(name: string, limit: number) {
  const path = join(PRIVATE.directory, name);
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit) throw new Error('Invalid private fixture file');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error('Private fixture limit');
  return bytes;
}

async function bundle() {
  if (!PERSONAL_LAYOUT_FIXTURE_LOCAL || !PRIVATE.directory) return null;
  const manifest: PersonalLayoutManifest = JSON.parse(
    (await privateFile(PRIVATE.manifestName, PRIVATE.manifestMaxBytes)).toString('utf8'),
  );
  if (
    manifest.schemaVersion !== PRIVATE.schemaVersion ||
    manifest.enabled !== true
  )
    return null;
  if (
    ![
      manifest.taskId,
      manifest.assignmentId,
      manifest.schoolId,
      manifest.expertId,
      manifest.studentId,
    ].every((id) => uuid.test(id)) ||
    manifest.fixtureSha256 !== PRIVATE.reviewSha256 ||
    !/^[0-9a-f]{64}$/.test(manifest.normalizedImageSha256) ||
    manifest.expectedImageCount !== CONFIG.imageCount ||
    manifest.expectedRevision !== CONFIG.revision
  )
    return null;
  const bytes = await privateFile(PRIVATE.reviewName, CONFIG.maxJsonBytes);
  if (sha256(bytes) !== PRIVATE.reviewSha256) return null;
  return { manifest, review: JSON.parse(bytes.toString('utf8')) as unknown };
}

async function boundedResponse(response: Response, limit: number) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit)
    throw new Error('Presentation source unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > limit) throw new Error('Presentation source limit');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

function backendReader(request: Request) {
  const target = new URL(BACKEND_URL);
  const incoming = new URL(request.url);
  if (
    target.protocol !== 'http:' ||
    target.port !== PRIVATE.backendPort ||
    !PRIVATE.backendHosts.some((host) => host === target.hostname) ||
    !PRIVATE.hosts.some((host) => host === incoming.hostname)
  )
    throw new Error('Local only');
  const cookie = personalLayoutSessionCookie(request.headers.get('cookie'));
  if (!cookie) throw new Error('Session required');
  return async (path: string, image = false) => {
    const response = await fetch(new URL(path, target), {
      headers: { cookie },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(CONFIG.timeoutMs),
    });
    return boundedResponse(response, image ? CONFIG.maxImageBytes : CONFIG.maxJsonBytes);
  };
}

export async function personalLayoutData(request: Request): Promise<PersonalLayoutProjection | null> {
  const loaded = await bundle();
  if (!loaded) return null;
  const { manifest, review } = loaded;
  const read = backendReader(request);
  const identity = JSON.parse((await read('/api/expert/me')).toString('utf8'));
  if (identity.id !== manifest.expertId || identity.school?.id !== manifest.schoolId) return null;
  const workId = new URL(request.url).searchParams.get('workId');
  if (!workId || !uuid.test(workId)) return null;
  const workPath = `/api/expert/works/${workId}`;
  const work: ExpertWorkDto = JSON.parse((await read(workPath)).toString('utf8'));
  if (!isUneditedGradedWork(work)) return null;
  let matched: PipelineRunDetail | null = null;
  let cursor: string | null = null;
  for (let page = 0; page < CONFIG.maxRunPages; page++) {
    const query = new URLSearchParams({ limit: String(CONFIG.runLimit) });
    if (cursor) query.set('cursor', cursor);
    const runs: PipelineRunPage = JSON.parse(
      (await read(`/api/local-demo/runs?${query}`)).toString('utf8'),
    );
    const run = runs.items.find(
      (item) =>
        item.workId === work.id &&
        item.submissionId === work.submissionId &&
        item.assignmentId === manifest.assignmentId,
    );
    if (run) {
      if (!uuid.test(run.id)) return null;
      matched = JSON.parse((await read(`/api/local-demo/runs/${run.id}`)).toString('utf8'));
      break;
    }
    cursor = runs.nextCursor ?? null;
    if (!cursor) break;
  }
  if (!matched || !uuid.test(work.images[0].id)) return null;
  const bytes = await read(`${workPath}/images/${work.images[0].id}`, true);
  if (
    bytes.length !== manifest.normalizedImageBytes ||
    !matchesPersonalLayout(manifest, work, matched, sha256(bytes))
  )
    return null;
  const fresh: ExpertWorkDto = JSON.parse((await read(workPath)).toString('utf8'));
  if (!isUneditedGradedWork(fresh) || JSON.stringify(fresh) !== JSON.stringify(work)) return null;
  return {
    workId,
    submissionId: work.submissionId,
    revision: work.revision,
    imageId: work.images[0].id,
    review: bindPersonalLayoutReview(review, work.images[0].id),
  };
}
