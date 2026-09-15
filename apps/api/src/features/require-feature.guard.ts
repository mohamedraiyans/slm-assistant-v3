import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureKey } from '@slm/shared-types';
import { FeaturesService } from './features.service';

const FEATURE_KEY = 'requiredFeature';

/** Marks a controller or route as belonging to an optional feature. Pair with FeatureGuard. */
export const RequireFeature = (key: FeatureKey) =>
  SetMetadata(FEATURE_KEY, key);

/**
 * Rejects requests to a disabled feature's routes. Hiding the tab in the UI is only
 * cosmetic — this is what actually turns the feature off. Responds 404 rather than
 * 403 so a disabled feature is indistinguishable from one that doesn't exist.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeaturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<FeatureKey | undefined>(
      FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!key) return true;

    if (!(await this.features.isEnabled(key))) {
      throw new NotFoundException();
    }
    return true;
  }
}
