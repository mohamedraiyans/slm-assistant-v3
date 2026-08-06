import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestUser } from '../types';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
