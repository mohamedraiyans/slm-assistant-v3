import { Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { AuthUser } from '@slm/shared-types';
import type { Request, Response } from 'express';
import type { User } from '../../generated/prisma/client';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { RequestUser } from './types';

const ACCESS_TOKEN_MAX_AGE_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
    const secure = this.config.get('NODE_ENV') === 'production';
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: ACCESS_TOKEN_MAX_AGE_MS,
    });
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    });
  }

  private clearAuthCookies(res: Response) {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {
    // Passport redirects to Google's consent screen; nothing to do here.
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const user = req.user as User;
    const { accessToken, refreshToken } = await this.authService.issueTokenPair(user);
    this.setAuthCookies(res, accessToken, refreshToken);
    res.redirect(this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000');
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res() res: Response) {
    const raw = req.cookies?.refresh_token;
    if (!raw) throw new UnauthorizedException('No refresh token');
    const { user, refreshToken } = await this.authService.rotateRefreshToken(raw);
    const accessToken = this.authService.generateAccessToken(user);
    this.setAuthCookies(res, accessToken, refreshToken);
    res.json({ ok: true });
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    const raw = req.cookies?.refresh_token;
    if (raw) await this.authService.revokeRefreshToken(raw);
    this.clearAuthCookies(res);
    res.json({ ok: true });
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() currentUser: RequestUser): Promise<AuthUser> {
    const user = await this.authService.getUserById(currentUser.id);
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
    };
  }
}
