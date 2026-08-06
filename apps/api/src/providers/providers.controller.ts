import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { ProviderCredentialPublic, ProviderName } from '@slm/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { RequestUser } from '../auth/types';
import { ProvidersService } from './providers.service';

@Controller('providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('available')
  availableProviders(): Promise<ProviderName[]> {
    return this.providersService.findActiveProviderNames();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get()
  findAll(): Promise<ProviderCredentialPublic[]> {
    return this.providersService.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post()
  create(
    @Body()
    body: { provider: ProviderName; label: string; value: string; extraConfig?: Record<string, unknown> },
    @CurrentUser() user: RequestUser,
  ): Promise<ProviderCredentialPublic> {
    return this.providersService.create(body, user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.providersService.remove(id);
    return { ok: true };
  }
}
