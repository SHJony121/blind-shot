import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { audio } from '../game/audio/AudioEngine';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'danger' | 'ghost' | 'default';
  small?: boolean;
  hotkey?: string;
};

export function Button({ variant = 'default', small, hotkey, className, onClick, onMouseEnter, children, ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'default' ? variant : '', small ? 'small' : '', className ?? ''].join(' ').trim();
  return (
    <button
      type="button"
      className={cls}
      onMouseEnter={(e) => {
        audio.uiHover();
        onMouseEnter?.(e);
      }}
      onClick={(e) => {
        audio.unlock();
        audio.uiClick();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
      {hotkey ? <span className="key">{hotkey}</span> : null}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="label">{label}</div>
      <div>{children}</div>
    </div>
  );
}

export function Seg<T extends string | number | boolean>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          type="button"
          key={String(o.value)}
          className={o.value === value ? 'on' : ''}
          onClick={() => {
            audio.unlock();
            audio.uiClick();
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="value">{format ? format(value) : value}</span>
    </div>
  );
}

export function Panel({ title, children, width }: { title?: string; children: ReactNode; width?: number }) {
  return (
    <div className="panel" style={width ? { width: `min(${width}px, 94vw)` } : undefined}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </div>
  );
}
