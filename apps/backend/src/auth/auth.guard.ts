import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, AuthUser, sessionToken } from './auth.service';
import { readAuthConfig } from './auth.config';
import { PUBLIC_ROUTE } from './public';
import { MULTIPART_ROUTE } from '../media/multipart';

export type AuthRequest = Request & { authUser?: AuthUser };

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly config = readAuthConfig(process.env);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const multipart = this.reflector.getAllAndOverride<boolean>(MULTIPART_ROUTE, [context.getHandler(), context.getClass()]);
      if (request.headers.origin !== this.config.origin ||
        request.headers['x-olconet-request'] !== '1' ||
        !request.is(multipart ? 'multipart/form-data' : 'application/json')) {
        throw new ForbiddenException('Ungueltiger Ursprung oder ungueltiges Anfrageformat.');
      }
    }
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const user = await this.auth.userForToken(sessionToken(request.headers.cookie));
    if (!user) throw new UnauthorizedException('Bitte anmelden.');
    request.authUser = user;
    return true;
  }
}
