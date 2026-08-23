import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ERROR_CODES } from '@ghostlink/shared';
import { JwtService } from './jwt.service';

/**
 * Resolves the session JWT from the Authorization header and attaches
 * `req.sessionId`. Rejection reason is intentionally generic to avoid
 * leaking whether an id exists.
 */
@Injectable()
export class TokenAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { sessionId?: string }>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ error: { code: ERROR_CODES.UNAUTHORIZED, message: 'missing bearer token' } });
    }
    const token = header.slice('Bearer '.length).trim();
    const payload = this.jwt.verifySessionToken(token);
    if (!payload) {
      throw new UnauthorizedException({ error: { code: ERROR_CODES.INVALID_TOKEN, message: 'invalid or expired token' } });
    }
    req.sessionId = payload.sid;
    return true;
  }
}
