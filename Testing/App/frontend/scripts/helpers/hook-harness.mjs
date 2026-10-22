import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '../..');
export function moduleLoader(mocks = {}, globals = {}) {
  const cache = new Map();
  function load(name) {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (!name.startsWith('@/')) return require(name);
    if (cache.has(name)) return cache.get(name).exports;
    const base = resolve(root, 'src', name.slice(2));
    const file = existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`;
    const result = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    const loadedModule = { exports: {} };
    cache.set(name, loadedModule);
    compileFunction(result.outputText, ['require', 'module', 'exports', ...Object.keys(globals)], {
      filename: file,
    })(load, loadedModule, loadedModule.exports, ...Object.values(globals));
    return loadedModule.exports;
  }
  return load;
}
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
export function hookHarness() {
  let slots = [],
    cursor = 0,
    effects = [];
  const react = {
    useState(value) {
      const i = cursor++;
      slots[i] ??= { value: typeof value === 'function' ? value() : value };
      return [
        slots[i].value,
        (next) => {
          slots[i].value = typeof next === 'function' ? next(slots[i].value) : next;
        },
      ];
    },
    useRef(value) {
      const i = cursor++;
      return (slots[i] ??= { current: value });
    },
    useCallback(value, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { value, deps };
      return slots[i].value;
    },
    useMemo(factory, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: factory(), deps };
      return slots[i].value;
    },
    useEffect(effect, deps) {
      const i = cursor++;
      if (same(slots[i]?.deps, deps)) return;
      effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: effect() };
      });
    },
  };
  return {
    react,
    render(fn) {
      cursor = 0;
      const value = fn();
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      return value;
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
      slots = [];
      effects = [];
    },
  };
}
export function memoryStore() {
  return (initializer) => {
    let state;
    const set = (patch) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    };
    const get = () => state;
    state = initializer(set, get);
    const store = (selector) => selector(state);
    store.getState = get;
    return store;
  };
}
export const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
