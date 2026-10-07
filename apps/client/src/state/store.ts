import { useSyncExternalStore } from 'react';

/** Minimal observable store shared by the game (writer) and React UI (reader). */
export class Store<T extends object> {
  private listeners = new Set<() => void>();

  constructor(private state: T) {}

  get(): T {
    return this.state;
  }

  set(patch: Partial<T> | ((s: T) => Partial<T>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    let changed = false;
    for (const k of Object.keys(next) as (keyof T)[]) {
      if (this.state[k] !== next[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, () => store.get());
}
