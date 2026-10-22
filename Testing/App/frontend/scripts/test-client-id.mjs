import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moduleLoader } from './helpers/hook-harness.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('native randomUUID remains the preferred client identifier', () => {
  const expected = 'a1711e8f-8a7f-43fb-989f-0672078306d7';
  const { createClientId } = moduleLoader(
    {},
    { crypto: { randomUUID: () => expected } },
  )('@/lib/client-id');
  assert.equal(createClientId(), expected);
});

test('LAN HTTP without randomUUID creates distinct API-compatible UUIDs using getRandomValues', () => {
  let sequence = 0;
  const { createClientId } = moduleLoader(
    {},
    { crypto: { getRandomValues: (bytes) => bytes.fill(++sequence) } },
  )('@/lib/client-id');
  const first = createClientId();
  const second = createClientId();
  assert.match(first, uuid);
  assert.match(second, uuid);
  assert.notEqual(first, second);
});

test('non-browser fallback also preserves the UUID request shape', () => {
  const { createClientId } = moduleLoader({}, { crypto: undefined })('@/lib/client-id');
  assert.match(createClientId(), uuid);
});
