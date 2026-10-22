import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { moduleLoader } from './helpers/hook-harness.mjs';

const load = moduleLoader();
const { explainButtonProps } = load('@/lib/disabled-action');
const { DISABLED_ACTION_COPY: C } = load('@/config/disabled-action');
const { checkDisabledReason, photoDisabledReason } = load('@/lib/training-availability');

test('explained disabled action cannot invoke handlers, follow a rendered link or submit a form', () => {
  const action = () => assert.fail('Forbidden action was invoked');
  const props = explainButtonProps(
    {
      disabled: true,
      type: 'submit',
      render: createElement('a', { href: '/forbidden' }),
      onClick: action,
      onClickCapture: action,
      onDoubleClick: action,
      onKeyDown: action,
      onKeyUp: action,
      onPointerDown: action,
      onPointerUp: action,
      onMouseDown: action,
      onMouseUp: action,
      onTouchStart: action,
      onTouchEnd: action,
    },
    'Сначала запиши ответ',
  );
  assert.equal(props.disabled, false);
  assert.equal(props['aria-disabled'], true);
  assert.equal(props.type, 'button');
  assert.equal(props.nativeButton, true);
  assert.equal(props.render, undefined);
  for (const name of Object.keys(props).filter((key) => key.startsWith('on'))) {
    assert.equal(props[name], undefined, name);
  }
});

test('active actions and pending actions without an explanation retain their original behavior', () => {
  const action = () => {};
  for (const props of [
    { disabled: false, type: 'submit', onClick: action },
    { disabled: true, type: 'submit', onClick: action },
  ]) {
    assert.equal(explainButtonProps(props, props.disabled ? undefined : 'Не показывать'), props);
  }
});

test('the actual shared Button stays keyboard-focusable and describes its disabled reason', () => {
  const { Button } = load('@/components/ui/button');
  const html = renderToString(
    createElement(
      Button,
      {
        disabled: true,
        disabledReason: C.checkEmpty,
        type: 'submit',
        onClick: () => assert.fail('Must never check'),
      },
      'Проверить ответы',
    ),
  );
  const button = html.match(/<button\b[^>]*>/)?.[0];
  assert.ok(button);
  assert.match(button, /type="button"/);
  assert.match(button, /aria-disabled="true"/);
  assert.match(button, /aria-describedby="[^"]+"/);
  assert.doesNotMatch(button, /(?:\sdisabled(?:=|\s|>)|tabindex="-1")/i);
  assert.ok(html.includes('Проверить ответы'));
});

test('review explains invalid, unavailable, pending and empty states but never blocks a mixed ready batch', () => {
  const cases = [
    [[], C.checkEmpty],
    [['empty'], C.checkEmpty],
    [['invalid', 'empty'], C.checkInvalid],
    [['photo'], C.checkPhoto],
    [['pro'], C.checkPro],
    [['pending'], C.checkPending],
    [['unsupported'], C.checkUnsupported],
    [['unavailable'], C.checkUnavailable],
    [['failed'], C.checkRetry],
    [['rejected'], C.checkRetry],
    [['expired'], C.checkRetry],
    [['correct', 'incorrect'], C.checkFinished],
  ];
  for (const [states, reason] of cases) assert.equal(checkDisabledReason(states, 0, false), reason);
  assert.equal(checkDisabledReason(['ready', 'pro', 'unsupported'], 1, false), undefined);
  assert.equal(checkDisabledReason(['invalid'], 0, true), undefined);
  assert.equal(checkDisabledReason(['photo'], 0, false, false), C.checkPro);
  assert.equal(checkDisabledReason(['empty', 'pro'], 0, false, false), C.checkEmpty);
});

test('photo restrictions explain permanent locks and recovery, leaving pending transport strictly disabled', () => {
  const draft = { task: { responseType: 'photo' }, submission: { status: 'draft' } };
  assert.equal(photoDisabledReason(draft, false), undefined);
  for (const status of ['queued', 'running', 'graded']) {
    assert.equal(photoDisabledReason({ ...draft, submission: { status } }, false), C.photoLocked);
  }
  for (const status of ['expired', 'failed', 'rejected', 'cancelled']) {
    assert.equal(photoDisabledReason({ ...draft, submission: { status } }, false), C.photoRetry);
  }
  assert.equal(photoDisabledReason({ ...draft, result: { isGraded: true } }, false), C.photoLocked);
  assert.equal(
    photoDisabledReason({ ...draft, submission: { status: 'queued' } }, true),
    undefined,
  );
});

test('explanation popover keeps focus on its trigger and uses shared positioning', () => {
  const popover = Object.fromEntries(
    ['Root', 'Trigger', 'Portal', 'Positioner', 'Popup', 'Description'].map((name) => [name, name]),
  );
  const scoped = moduleLoader({
    react: { useId: () => 'reason-id' },
    '@base-ui/react/popover': { Popover: popover },
  });
  const { DisabledAction } = scoped('@/components/ui/disabled-action');
  const tree = DisabledAction({ children: createElement('button'), reason: C.checkEmpty });
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children)];
  }
  const elements = nodes(tree);
  const trigger = elements.find((node) => node.type === 'Trigger');
  const popup = elements.find((node) => node.type === 'Popup');
  assert.equal(trigger.props['aria-describedby'], 'reason-id');
  assert.equal(popup.props.initialFocus, false);
  assert.equal(popup.props.finalFocus, false);
  const directChildren = tree.props.children.filter(Boolean);
  assert.deepEqual(
    directChildren.map((node) => node.type),
    ['Trigger', 'Portal'],
  );
  const portal = directChildren.find((node) => node.type === 'Portal');
  assert.equal(portal.props.keepMounted, true);
  const description = nodes(portal).find((node) => node.props?.id === 'reason-id');
  assert.equal(description.props.children, C.checkEmpty);
});

test('explained Button does not introduce inline siblings that change space-y last-child geometry', () => {
  const { Button } = load('@/components/ui/button');
  for (const disabledReason of [undefined, C.checkEmpty]) {
    const html = renderToString(
      createElement(
        'div',
        { className: 'space-y-3' },
        createElement('p', null, 'Итого'),
        createElement(Button, { disabled: true, disabledReason }, 'Начать'),
      ),
    );
    assert.match(html, /<\/button><\/div>$/);
    assert.equal((html.match(/<button\b/g) ?? []).length, 1);
    assert.doesNotMatch(html, /<\/button><span\b/);
  }
});
