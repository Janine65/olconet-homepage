import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response, CookieOptions } from 'express';
import { AuthService, SESSION_COOKIE, SESSION_SECONDS, sessionToken } from './auth.service';
import { AuthRequest } from './auth.guard';
import { readAuthConfig } from './auth.config';
import { loginInput, passwordChangeInput } from './auth.input';
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

  @Post('password')
  @HttpCode(204)
  async changePassword(@Body() body: unknown, @Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) {
    if (!request.authUser) throw new UnauthorizedException('Bitte anmelden.');
    const { currentPassword, newPassword } = passwordChangeInput(body);
    await this.auth.changePassword(request.authUser.id, sessionToken(request.headers.cookie), currentPassword, newPassword);
    response.clearCookie(SESSION_COOKIE, this.cookie);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(sessionToken(request.headers.cookie));
    response.clearCookie(SESSION_COOKIE, this.cookie);
  }
}
