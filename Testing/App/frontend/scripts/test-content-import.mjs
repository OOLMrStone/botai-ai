import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import katex from 'katex';
import { renderToStaticMarkup } from 'react-dom/server';
import { moduleLoader, hookHarness } from './helpers/hook-harness.mjs';

const asset = '/api/catalog-media/00000000-0000-0000-0000-000000000001';
const reference =
  '/api/attempts/00000000-0000-0000-0000-000000000002/items/00000000-0000-0000-0000-000000000003/solution-media/00000000-0000-0000-0000-000000000004';
const images = [];
const load = moduleLoader({
  katex: { default: katex },
  'next/image': {
    default: ({ unoptimized, fill, ...props }) => {
      images.push({ unoptimized, fill, ...props });
      return React.createElement('img', props);
    },
  },
});

test('ordered inline text, TeX and lossless formula image remain within a valid paragraph', () => {
  images.length = 0;
  const { TaskBlockRenderer } = load('@/components/tasks/TaskBlockRenderer');
  const html = renderToStaticMarkup(
    React.createElement(TaskBlockRenderer, {
      blocks: [
        {
          type: 'paragraph',
          runs: [
            { type: 'text', value: 'До <script>' },
            { type: 'latex', value: '\\frac{1}{2}' },
            { type: 'formula', src: asset, width: 80, height: 40, heightEm: 2, alt: 'Формула' },
            { type: 'text', value: ' После' },
          ],
        },
      ],
    }),
  );
  assert.match(html, /До &lt;script&gt;/);
  assert.ok(
    html.indexOf('До') < html.indexOf('katex') &&
      html.indexOf('katex') < html.indexOf('<img') &&
      html.indexOf('<img') < html.indexOf('После'),
  );
  assert.doesNotMatch(html.match(/<p[\s\S]*<\/p>/)[0], /<div/);
  assert.equal(images[0].unoptimized, true);
  assert.equal(images[0].src, asset);
  assert.equal(images[0].style.width, '4em');
  assert.equal(images[0].style.verticalAlign, 'middle');
});
test('display math uses display layout while paragraph math stays inline', () => {
  const { TaskBlockRenderer } = load('@/components/tasks/TaskBlockRenderer');
  const html = renderToStaticMarkup(
    React.createElement(TaskBlockRenderer, {
      blocks: [
        { type: 'latex', value: 'x^2' },
        { type: 'paragraph', runs: [{ type: 'latex', value: 'x^2' }] },
      ],
    }),
  );
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 1);
  assert.doesNotMatch(html.match(/<p[\s\S]*<\/p>/)[0], /class="katex-display"/);
});
test('external and protocol-relative images cannot trigger a Next optimizer fetch', () => {
  const { taskMediaSrc } = load('@/lib/task-content');
  for (const url of [
    'https://example.test/x.png',
    '//127.0.0.1/x.png',
    '/api/catalog-media/../auth',
    `${asset}?token=x`,
  ])
    assert.equal(taskMediaSrc(url), null);
  assert.equal(taskMediaSrc(reference), reference);
  assert.equal(taskMediaSrc('/tasks/isosceles-triangle.svg'), '/tasks/isosceles-triangle.svg');
  const { TaskBlockRenderer } = load('@/components/tasks/TaskBlockRenderer');
  const html = renderToStaticMarkup(
    React.createElement(TaskBlockRenderer, {
      blocks: [{ type: 'image', src: 'https://example.test/remote.png', alt: 'remote' }],
    }),
  );
  assert.doesNotMatch(html, /<img/);
});
test('exact rich answer and solution take precedence without falling back to null or lossy text', () => {
  const { solutionBlocks } = load('@/lib/task-content');
  const answer = {
    type: 'paragraph',
    runs: [{ type: 'formula', src: reference, width: 10, height: 10 }],
  };
  const explanation = { type: 'text', value: 'Точное решение' };
  const blocks = solutionBlocks({
    referenceAnswer: null,
    referenceAnswerContent: [answer],
    referenceSolution: 'lossy',
    referenceContent: [explanation],
  });
  assert.equal(blocks[1], answer);
  assert.equal(blocks[3], explanation);
  assert.ok(!JSON.stringify(blocks).includes('lossy'));
});

function hookSetup() {
  const harness = hookHarness();
  const calls = [];
  const state = {
    attempt: {
      id: 'a',
      currentIndex: 0,
      items: [
        {
          id: 'i',
          answer: '',
          drawing: [],
          answerRevision: 0,
          task: { taskVersionId: 'v', part: 2, gradingCapability: 'unsupported' },
        },
      ],
    },
    answers: {},
    busy: false,
    unsaved: false,
    editingBusy: false,
  };
  const solution = { referenceAnswer: '2', referenceSolution: 'work' };
  const hookLoad = moduleLoader({
    react: harness.react,
    'next/navigation': { useRouter: () => ({ push() {} }) },
    '@/hooks/use-attempt': {
      useAttempt: () => ({
        ...state,
        save: async () => {
          calls.push('save');
          return structuredClone(state.attempt);
        },
      }),
    },
    '@/hooks/use-paywall': { usePaywall: () => ({ visible: false, open() {} }) },
    '@/hooks/use-attempt-activity': { useAttemptActivity() {} },
    '@/hooks/use-keyboard-viewport': { useKeyboardViewport() {} },
    '@/hooks/use-task-keyboard-navigation': { useTaskKeyboardNavigation() {} },
    '@/lib/api/learning': {
      fetchSolution: async () => {
        calls.push('GET');
        return solution;
      },
      revealSolution: async (...args) => {
        calls.push(args);
        return solution;
      },
    },
  });
  const render = () =>
    harness.render(() => hookLoad('@/hooks/use-training-shell').useTrainingShell('a'));
  return { state, calls, render };
}
test('unsupported reveal saves first, posts the complete input binding and cached access expires after every input change', async () => {
  const { state, calls, render } = hookSetup();
  await render().toggleSolution('i');
  let view = render();
  assert.deepEqual(calls, ['save', ['a', 'i', 0, null, null]]);
  assert.deepEqual(view.revealed, ['i']);
  state.unsaved = true;
  assert.deepEqual(render().revealed, []);
  state.unsaved = false;
  state.attempt.items[0].answerRevision++;
  assert.deepEqual(render().revealed, []);
  await render().toggleSolution('i');
  assert.deepEqual(render().revealed, ['i']);
  state.attempt.items[0].submission = { id: 'photo', revision: 0, images: [], status: 'draft' };
  assert.deepEqual(render().revealed, []);
  await render().toggleSolution('i');
  assert.deepEqual(render().revealed, ['i']);
  state.attempt.items[0].submission.revision++;
  assert.deepEqual(render().revealed, []);
});
test('supported and transient-unavailable tasks do not use an ungraded reveal POST', async () => {
  const { state, calls, render } = hookSetup();
  state.attempt.items[0].task.gradingCapability = 'unavailable';
  await render().toggleSolution('i');
  assert.deepEqual(calls, ['save', 'GET']);
});

test('school and expert statements accept only scoped task-media paths', () => {
  const { taskMediaSrc } = load('@/lib/task-content');
  const owner = '00000000-0000-4000-8000-000000000001';
  const image = '00000000-0000-4000-8000-000000000002';
  for (const scope of ['school/assignments', 'expert/works']) {
    const path = `/api/${scope}/${owner}/task-media/${image}`;
    assert.equal(taskMediaSrc(path), path);
    assert.equal(taskMediaSrc(`${path}?source=reference`), null);
    assert.equal(taskMediaSrc(path.replace('/task-media/', '/reference/')), null);
  }
  assert.equal(taskMediaSrc(`/api/media/${image}`), null);
});
