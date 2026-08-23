import { JwtService } from '../../src/core/jwt.service';

describe('JwtService', () => {
  const secret = 'x'.repeat(64);

  it('signs and verifies a session token', () => {
    const jwt = new JwtService(secret, 3600);
    const token = jwt.signSessionToken('gl_123');
    expect(jwt.verifySessionToken(token)).toEqual({ sid: 'gl_123' });
  });

  it('rejects tokens signed with a different secret', () => {
    const a = new JwtService(secret, 3600);
    const b = new JwtService('y'.repeat(64), 3600);
    const token = a.signSessionToken('gl_123');
    expect(b.verifySessionToken(token)).toBeNull();
  });

  it('rejects garbage and expired tokens', () => {
    const jwt = new JwtService(secret, 3600);
    expect(jwt.verifySessionToken('not.a.jwt')).toBeNull();
    const expired = jwt.signSessionToken('gl_123', -10);
    expect(jwt.verifySessionToken(expired)).toBeNull();
  });

  it('rejects tokens without a sid claim', () => {
    const jwt = new JwtService(secret, 3600);
    // forge-ish: sign with same helper shape but no sid — use library directly
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { sign } = require('jsonwebtoken') as typeof import('jsonwebtoken');
    const token = sign({ nope: true }, secret, { algorithm: 'HS256', expiresIn: 60 });
    expect(jwt.verifySessionToken(token)).toBeNull();
  });
});
