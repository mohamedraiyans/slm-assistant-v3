import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import type { FeatureState } from '@slm/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { RequestUser } from '../auth/types';
import { FeaturesService } from './features.service';

@Controller('features')
@UseGuards(JwtAuthGuard)
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  /** Every signed-in user needs this, so the UI knows which tabs to show. */
  @Get()
  list(): Promise<FeatureState[]> {
    return this.features.list();
  }

  @Patch(':key')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(
    @Param('key') key: string,
    @Body() body: { enabled?: unknown },
    @CurrentUser() user: RequestUser,
  ): Promise<FeatureState> {
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('"enabled" must be true or false');
    }
    return this.features.setEnabled(key, body.enabled, user.id);
  }
}
