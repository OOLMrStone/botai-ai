export interface ResourceSnapshot<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
}
export interface CachedResource<T> {
  peek: () => T | null;
  get: () => Promise<T>;
  snapshot: () => ResourceSnapshot<T>;
  subscribe: (listener: () => void) => () => void;
  invalidate: () => void;
  set: (value: T) => void;
}
const resources = new Set<{ invalidate: () => void }>();
let owner: string | null = null;
export function setResourceOwner(next: string | null) {
  if (owner === next) return;
  owner = next;
  invalidateResources();
}
export function invalidateResources() {
  resources.forEach((resource) => resource.invalidate());
}
export function cachedResource<T>(load: () => Promise<T>): CachedResource<T> {
  let state: ResourceSnapshot<T> = { data: null, error: null, loading: false };
  let inflight: Promise<T> | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const resource: CachedResource<T> = {
    peek: () => state.data,
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (data) => {
      state = { data, error: null, loading: false };
      emit();
    },
    invalidate: () => {
      generation++;
      inflight = null;
      state = { data: null, error: null, loading: false };
      emit();
    },
    get: () => {
      if (state.data !== null) return Promise.resolve(state.data);
      if (inflight) return inflight;
      const started = generation;
      state = { ...state, loading: true };
      emit();
      inflight = load()
        .then(
          (data) => {
            if (started === generation) resource.set(data);
            return data;
          },
          (error: unknown) => {
            if (started === generation) {
              state = { data: null, error, loading: false };
              emit();
            }
            throw error;
          },
        )
        .finally(() => {
          if (started === generation) inflight = null;
        });
      return inflight;
    },
  };
  resources.add(resource);
  return resource;
}
