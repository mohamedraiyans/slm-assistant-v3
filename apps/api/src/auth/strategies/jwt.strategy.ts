import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';
import type { RequestUser } from '../types';

function extractFromCookie(req: Request): string | null {
  return req?.cookies?.access_token ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: extractFromCookie,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
    } satisfies StrategyOptionsWithoutRequest);
  }

  validate(payload: { sub: string; email: string; role: RequestUser['role'] }): RequestUser {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
