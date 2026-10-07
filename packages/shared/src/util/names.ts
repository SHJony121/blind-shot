import { NAME_MAX_LENGTH, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../constants/game';

/** Strip anything that is not a plain printable character and clamp the length. */
export function sanitizeName(raw: unknown, fallback = 'Guest'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _\-.]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function guestName(random: () => number = Math.random): string {
  return `Guest${1000 + Math.floor(random() * 9000)}`;
}

export function generateRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export const subjectLabel = (n: number): string => `SUBJECT ${String(n).padStart(2, '0')}`;
