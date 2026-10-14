import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8');

function descendants(node, found = []) {
  if (node === null || node === undefined || typeof node !== 'object') return found;
  found.push(node);
  if (node.isPortal) descendants(node.child, found);
  for (const child of node.children ?? []) descendants(child, found);
  return found;
}
function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || node === undefined) return '';
  return (node.isPortal ? textOf(node.child) : (node.children ?? []).map(textOf).join(''));
}
const lookup = (tree, predicate) => descendants(tree).find(predicate);

test('visual order follows ContextMeter; footer, popover and Refresh match reference', async () => {
  let client;
  let rendered;
  let cursor = 0;
  const hooks = [];
  let effects = [];
  let layouts = [];
  const listeners = new Map();
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const schedule = (kind, effect, deps) => {
    const index = cursor++;
    const previous = hooks[index];
    if (previous && same(previous.deps, deps)) return;
    (kind === 'layout' ? layouts : effects).push(() => {
      previous?.cleanup?.();
      hooks[index] = { deps, cleanup: effect() };
    });
  };
  const React = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children }; },
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: initial };
      return [hooks[index].value, (next) => {
        hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next;
      }];
    },
    useRef(value) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { current: value };
      return hooks[index];
    },
    useId() {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { id: `test-${index}` };
      return hooks[index].id;
    },
    useEffect(fn, deps) { schedule('effect', fn, deps); },
    useLayoutEffect(fn, deps) { schedule('layout', fn, deps); },
  };
  let networkCalls = 0;
  const urls = [];
  const result = {
    ok: true, unit: 'credits', used: 789, remaining: 28811, total: 30000,
    overage: 0, plan: 'business', resetAt: '2026-11-01T00:00:00.000Z',
    sampledAt: '2026-10-07T01:29:19.000Z',
  };
  const document = {
    body: {},
    addEventListener(event, handler) { listeners.set(event, handler); },
    removeEventListener(event, handler) { if (listeners.get(event) === handler) listeners.delete(event); },
  };
  const window = {
    innerWidth: 1480, innerHeight: 800,
    __ModuleLoader__: { load(module) { client = module; } },
    addEventListener() {}, removeEventListener() {},
  };
  const sandbox = {
    window, document, Intl, Date, AbortController,
    setInterval: () => 42, clearInterval: () => {},
    fetch: async (url, options) => {
      urls.push(url);
      networkCalls++;
      assert.equal(options.credentials, 'same-origin');
      return { ok: true, json: async () => ({ ...result, remaining: networkCalls === 1 ? 28811 : 28810 }) };
    },
  };
  runInNewContext(source, sandbox, { filename: 'lib/client.js' });
  assert.equal(client.id, 'dsh-github-copilot-credits');
  const plugin = client.factory((id) => {
    if (id === 'react') return React;
    if (id === 'react-dom') return { createPortal: (child) => ({ isPortal: true, child }) };
    throw new Error(`Unknown baseline dependency ${id}`);
  });
  assert.deepEqual(Array.from(plugin.inject), ['slots']);
  plugin.apply({ slots: {
    inject(name, callback) { assert.equal(name, 'conversation.composer.dock'); callback(); },
    register(config, Component) { rendered = { config, Component }; },
  } });
  assert.equal(rendered.config.id, 'copilot-credits');
  assert.equal(rendered.config.order, 1);

  const render = () => { cursor = 0; effects = []; layouts = []; return rendered.Component(); };
  const flush = () => { for (const work of layouts.splice(0)) work(); for (const work of effects.splice(0)) work(); };
  let tree = render();
  assert.equal(tree.type, 'span');
  // DSH renders <StatsPills /> and <ContextMeter /> with default CSS order 0.
  // This plugin's root must be flex item order 1 to sit to the RIGHT of both.
  assert.equal(tree.props.style.order, 1);
  assert.match(textOf(tree), /Copilot 查询中/);
  flush();
  await new Promise((resolve) => setImmediate(resolve));
  tree = render();
  const trigger = lookup(tree, (node) => node.type === 'button' && node.props['aria-haspopup'] === 'dialog');
  assert.equal(trigger.props['aria-expanded'], false);
  assert.match(textOf(trigger), /28,811 \/ 30,000/);
  assert.equal(lookup(tree, (node) => node.isPortal), undefined, 'closed panel should not be rendered');
  const bar = lookup(trigger, (node) => node.props.role === 'progressbar');
  assert.equal(bar.props['aria-valuemax'], 30000);
  assert.equal(bar.props['aria-valuenow'], 1189, 'progress follows consumed allowance, not separately reported credits_used');
  assert.ok(lookup(bar, (node) => node.type === 'span' && String(node.props.style?.width).endsWith('%')));
  assert.equal(networkCalls, 1);

  let focuses = 0;
  trigger.props.ref.current = {
    getBoundingClientRect: () => ({ top: 420, right: 900, bottom: 446 }),
    contains: () => false,
    focus: () => { focuses++; },
  };
  trigger.props.onClick();
  tree = render();
  let portal = lookup(tree, (node) => node.isPortal);
  assert.ok(portal, 'click must open a real popover');
  portal.child.props.ref.current = {
    offsetWidth: 280, offsetHeight: 210, contains: () => false,
    focus: () => {},
  };
  flush();
  tree = render();
  portal = lookup(tree, (node) => node.isPortal);
  assert.equal(portal.child.props.role, 'dialog');
  assert.match(textOf(portal), /GitHub Copilotbusiness/);
  assert.match(textOf(portal), /已用789/);
  assert.match(textOf(portal), /剩余28,811/);
  assert.match(textOf(portal), /总额度30,000/);
  assert.match(textOf(portal), /重置日期2026-11-01/);
  assert.equal(portal.child.props.style.left, 620);
  assert.equal(portal.child.props.style.top, 202);
  assert.equal(networkCalls, 1, 'opening the panel must not itself refresh');

  const refresh = lookup(portal, (node) => node.type === 'button' && node.props['aria-label'] === '刷新 GitHub Copilot 用量');
  assert.equal(textOf(refresh), '刷新');
  refresh.props.onClick();
  const refreshing = render();
  assert.match(textOf(lookup(refreshing, (node) => node.isPortal)), /更新中…/);
  await new Promise((resolve) => setImmediate(resolve));
  tree = render();
  assert.match(textOf(tree), /28,810 \/ 30,000/);
  assert.deepEqual(urls, ['/api/copilot-credits', '/api/copilot-credits?refresh=1']);
  assert.equal(networkCalls, 2);

  listeners.get('keydown')?.({ key: 'Escape' });
  tree = render();
  assert.equal(lookup(tree, (node) => node.isPortal), undefined);
  assert.equal(focuses, 1, 'Escape restores trigger focus');
  flush();
  lookup(tree, (node) => node.type === 'button' && node.props['aria-haspopup'] === 'dialog').props.onClick();
  tree = render();
  flush();
  listeners.get('pointerdown')?.({ target: {} });
  tree = render();
  assert.equal(lookup(tree, (node) => node.isPortal), undefined, 'outside click dismisses the popover');
  assert.equal(networkCalls, 2, 'reopening does not refresh');
  flush();
  for (const hook of hooks) hook?.cleanup?.();
});
