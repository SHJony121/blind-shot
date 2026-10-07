/**
 * Keyboard + mouse state. Kept free of game logic so touch controls can later feed
 * the same `InputState` (left stick = move, right stick = aim).
 */
export interface InputState {
  moveX: number;
  moveY: number;
  sprint: boolean;
  /** Pointer position in normalised device coordinates (-1..1). */
  pointerX: number;
  pointerY: number;
  /** Accumulated horizontal mouse movement since the last read (pointer-lock aim mode). */
  turnDelta: number;
}

type Listener = (key: string) => void;

export class Input {
  readonly state: InputState = { moveX: 0, moveY: 0, sprint: false, pointerX: 0, pointerY: 0, turnDelta: 0 };
  private readonly keys = new Set<string>();
  private readonly pressListeners = new Set<Listener>();
  private readonly releaseListeners = new Set<Listener>();
  private enabled = true;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.keys.clear();
    this.recompute();
  }

  onPress(cb: Listener): () => void {
    this.pressListeners.add(cb);
    return () => this.pressListeners.delete(cb);
  }

  onRelease(cb: Listener): () => void {
    this.releaseListeners.add(cb);
    return () => this.releaseListeners.delete(cb);
  }

  consumeTurn(): number {
    const d = this.state.turnDelta;
    this.state.turnDelta = 0;
    return d;
  }

  requestPointerLock(): void {
    void this.element.requestPointerLock?.();
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (e.code === 'Tab') e.preventDefault();
    if (!e.repeat) for (const cb of this.pressListeners) cb(e.code);
    if (!this.enabled) return;
    this.keys.add(e.code);
    this.recompute();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    for (const cb of this.releaseListeners) cb(e.code);
    this.keys.delete(e.code);
    this.recompute();
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.recompute();
  };

  private onMouseMove = (e: MouseEvent): void => {
    const rect = this.element.getBoundingClientRect();
    this.state.pointerX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    this.state.pointerY = -(((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    if (document.pointerLockElement === this.element) this.state.turnDelta += e.movementX;
  };

  private recompute(): void {
    const k = (c: string) => this.keys.has(c);
    this.state.moveX = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    this.state.moveY = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    this.state.sprint = k('ShiftLeft') || k('ShiftRight');
  }
}
