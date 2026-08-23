import { describe, expect, it } from 'vitest';
import { generateSessionId, generateRoomId, generateQrCode, randomString } from '../src/ids';

describe('ids', () => {
  it('session ids are namespaced and unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const id = generateSessionId();
      expect(id).toMatch(/^gl_[a-z0-9]{24}$/);
      seen.add(id);
    }
    expect(seen.size).toBe(500);
  });

  it('room ids are namespaced', () => {
    expect(generateRoomId()).toMatch(/^rm_[a-z0-9]{24}$/);
  });

  it('qr codes avoid ambiguous characters', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateQrCode();
      expect(code).toMatch(/^ql_[a-hj-km-z2-9]{6}$/);
      expect(code.slice(3)).not.toMatch(/[0oil1]/);
    }
  });

  it('randomString honors length', () => {
    expect(randomString(10)).toHaveLength(10);
    expect(randomString(0)).toBe('');
  });
});
