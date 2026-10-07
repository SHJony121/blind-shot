import { useEffect, useRef, useState } from 'react';
import { Button, Panel } from '../components';

const STEPS = [
  'WATCH YOUR OPPONENTS',
  'AIM YOUR WEAPON',
  'THEY DISAPPEAR',
  'REMEMBER WHERE THEY WERE',
  'EVERYONE FIRES AT ZERO',
  'LAST SUBJECT ALIVE WINS',
];

const STEP_TIME = 1.6;
const SUBJECTS = [
  { x: 160, y: 262, color: '#e3b23c', you: true },
  { x: 58, y: 160, color: '#c8553d' },
  { x: 160, y: 58, color: '#3f7cac' },
  { x: 262, y: 160, color: '#5c9e5a' },
];

/** Animated top-down tutorial that loops through the whole Blind Shot cycle. */
function Demo({ step, t }: { step: number; t: number }) {
  const hidden = step === 2 || step === 3;
  const firing = step === 4 && t < 0.5;
  const after = step >= 4;
  // Opponent 2 (blue) sidesteps while hidden; you aim where they WERE (and miss), red aims at green.
  const blueX = step >= 3 ? 160 + Math.min(1, step === 3 ? t / STEP_TIME : 1) * 34 : 160;
  const youAim = step >= 1 ? { x: 160, y: 58 } : { x: 160, y: 160 };
  const aims: Record<number, { x: number; y: number }> = {
    0: youAim,
    1: { x: 262, y: 160 },
    2: { x: 160, y: 262 },
    3: { x: 58, y: 160 },
  };
  const dead = new Set<number>(after ? [0, 1, 3] : []);
  return (
    <svg className="demo" viewBox="0 0 320 320">
      <circle cx="160" cy="160" r="150" fill="#2b333a" stroke="#e3b23c" strokeWidth="6" strokeDasharray="14 10" />
      <circle cx="160" cy="160" r="28" fill="none" stroke="rgba(227,178,60,0.5)" strokeWidth="3" />
      {hidden ? <rect x="0" y="0" width="320" height="320" fill="rgba(120,0,0,0.25)" /> : null}
      {SUBJECTS.map((s, i) => {
        const isHidden = hidden && i !== 0;
        const x = i === 2 ? blueX : s.x;
        const aim = aims[i]!;
        const showLaser = (step === 0 || step === 1) || (hidden && i === 0);
        const isDead = dead.has(i) && step === 5;
        return (
          <g key={i} opacity={isHidden ? 0 : isDead ? 0.35 : 1} style={{ transition: 'opacity 150ms' }}>
            {showLaser || firing ? (
              <line
                x1={x}
                y1={s.y}
                x2={aim.x}
                y2={aim.y}
                stroke={firing ? '#fff3c4' : s.color}
                strokeWidth={firing ? 5 : 2.5}
                opacity={firing ? 1 : 0.85}
              />
            ) : null}
            <circle cx={x} cy={s.y} r="17" fill={s.color} stroke="#0b0d0f" strokeWidth="4" />
            {isDead ? <text x={x} y={s.y + 7} textAnchor="middle" fontSize="20" fill="#0b0d0f" fontFamily="Anton">X</text> : null}
            {s.you ? (
              <text x={x} y={s.y + 40} textAnchor="middle" fontSize="16" fill="#ece6d6" fontFamily="Anton">YOU</text>
            ) : null}
          </g>
        );
      })}
      {hidden ? (
        <text x="160" y="170" textAnchor="middle" fontSize="34" fill="#ff4b3a" fontFamily="Anton">
          {step === 3 ? '3 · 2 · 1' : 'BLIND'}
        </text>
      ) : null}
      {firing ? <rect x="0" y="0" width="320" height="320" fill="rgba(255,248,220,0.35)" /> : null}
    </svg>
  );
}

export function HowToPlay({ onClose }: { onClose: () => void }) {
  const [clock, setClock] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    let last = performance.now();
    const loop = (now: number) => {
      setClock((c) => (c + (now - last) / 1000) % (STEP_TIME * STEPS.length));
      last = now;
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, []);
  const step = Math.floor(clock / STEP_TIME);
  const t = clock - step * STEP_TIME;

  return (
    <div className="screen-center">
      <Panel title="HOW TO PLAY" width={860}>
        <div className="howto">
          <Demo step={step} t={t} />
          <div>
            <ol>
              {STEPS.map((s, i) => (
                <li key={s} className={i === step ? 'on' : ''}>
                  {s}
                </li>
              ))}
            </ol>
            <p className="label" style={{ marginTop: 18, lineHeight: 1.6 }}>
              WASD MOVE · MOUSE AIM · SHIFT SPRINT · TAB SCORES · ESC MENU
              <br />
              YOU NEVER PRESS FIRE — EVERY SUBJECT SHOOTS AUTOMATICALLY AT ZERO. ONE SHOT EACH.
            </p>
          </div>
        </div>
        <div className="actions">
          <Button variant="primary" onClick={onClose}>
            GOT IT
          </Button>
        </div>
      </Panel>
    </div>
  );
}
