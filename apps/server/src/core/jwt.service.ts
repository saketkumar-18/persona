import { Injectable } from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';

/**
 * Session-scoped JWTs. The token replaces a user account: possession of the
 * token IS the session. Tokens are opaque to the server beyond expiry and
 * session-id; no user identity, email, phone, or device fingerprint is stored.
 */

export interface SessionJwtPayload {
  sid: string;
  iat?: number;
}

@Injectable()
export class JwtService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  signSessionToken(sessionId: string, expiresIn = this.ttlSeconds): string {
    return sign({ sid: sessionId } satisfies SessionJwtPayload, this.secret, {
      expiresIn,
      algorithm: 'HS256',
    });
  }

  verifySessionToken(token: string): SessionJwtPayload | null {
    try {
      const payload = verify(token, this.secret, {
        algorithms: ['HS256'],
      }) as unknown as SessionJwtPayload;
      if (!payload || typeof payload.sid !== 'string') return null;
      return { sid: payload.sid };
    } catch {
      return null;
    }
  }
}
