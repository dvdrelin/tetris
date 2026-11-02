// MP block B — shared wire-protocol helpers (backend and frontend share this module, so it is
// tested from either suite; here it rides the frontend runner).
import { normalizeRoomCode, MP_CLIENT_PING_MS } from '@neon-tetris/shared';

describe('normalizeRoomCode', () => {
  test('trims, uppercases and strips separators', () => {
    expect(normalizeRoomCode(' ab-12 ')).toBe('AB12');
    expect(normalizeRoomCode('ab_12')).toBe('AB12');
    expect(normalizeRoomCode('AB12')).toBe('AB12');
  });
  test('non-strings normalize to empty (the server then answers room_not_found)', () => {
    expect(normalizeRoomCode(undefined)).toBe('');
    expect(normalizeRoomCode(42)).toBe('');
    expect(normalizeRoomCode(null)).toBe('');
  });
  test('a lone code survives normalization byte-for-byte in shape', () => {
    expect(normalizeRoomCode('KP7Q')).toBe('KP7Q');
  });
});

describe('protocol constants', () => {
  test('client keepalive fires inside the nginx idle window (60 s)', () => {
    expect(MP_CLIENT_PING_MS).toBeGreaterThan(0);
    expect(MP_CLIENT_PING_MS).toBeLessThan(60_000);
  });
});
