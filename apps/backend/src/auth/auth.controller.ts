import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response, CookieOptions } from 'express';
import { AuthService, SESSION_COOKIE, SESSION_SECONDS, sessionToken } from './auth.service';
import { AuthRequest } from './auth.guard';
import { readAuthConfig } from './auth.config';
import { loginInput } from './auth.input';
import { Public } from './public';

@Controller('api/auth')
export class AuthController {
  private readonly cookie: CookieOptions = {
    httpOnly: true,
    secure: readAuthConfig(process.env).secure,
    sameSite: 'strict',
    path: '/api',
  };

  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const { email, password } = loginInput(body);
    const result = await this.auth.login(email, password, sessionToken(request.headers.cookie));
    response.cookie(SESSION_COOKIE, result.token, { ...this.cookie, maxAge: SESSION_SECONDS * 1000 });
    return { user: result.user };
  }

  @Get('me')
  me(@Req() request: AuthRequest) {
    return { user: request.authUser };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(sessionToken(request.headers.cookie));
    response.clearCookie(SESSION_COOKIE, this.cookie);
  }
}
