import { Controller, Get } from '@nestjs/common';
import type { HealthStatus } from '@slm/shared-types';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return { status: 'ok', service: 'api' };
  }
}
