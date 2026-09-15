import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_REGISTRY } from './feature-registry';
import { FeaturesService } from './features.service';
import { FeatureGuard, RequireFeature } from './require-feature.guard';

// The generated Prisma client sits outside jest's rootDir; only the DI token is needed.
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

function createPrismaFake(rows: { key: string; enabled: boolean }[] = []) {
  const table = new Map(rows.map((row) => [row.key, row]));
  return {
    featureFlag: {
      findUnique: jest.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(table.get(where.key) ?? null),
      ),
      findMany: jest.fn(() => Promise.resolve([...table.values()])),
      upsert: jest.fn(
        ({
          where,
          update,
        }: {
          where: { key: string };
          update: { enabled: boolean };
        }) => {
          table.set(where.key, { key: where.key, enabled: update.enabled });
          return Promise.resolve(table.get(where.key));
        },
      ),
    },
  };
}

function createService(rows?: { key: string; enabled: boolean }[]) {
  const prisma = createPrismaFake(rows);
  return { prisma, service: new FeaturesService(prisma as never) };
}

describe('FeaturesService', () => {
  it('falls back to the registry default when an admin has never toggled the feature', async () => {
    const { service } = createService();
    await expect(service.isEnabled('recitation')).resolves.toBe(
      FEATURE_REGISTRY.recitation.defaultEnabled,
    );
  });

  it("keeps optional features off by default, so a deploy can't expose one silently", () => {
    expect(FEATURE_REGISTRY.recitation.defaultEnabled).toBe(false);
  });

  it('lets a stored override win over the default in both directions', async () => {
    const { service } = createService([{ key: 'recitation', enabled: true }]);
    await expect(service.isEnabled('recitation')).resolves.toBe(true);

    await service.setEnabled('recitation', false, 'admin-1');
    await expect(service.isEnabled('recitation')).resolves.toBe(false);
  });

  it('lists every registered feature, including ones with no stored row', async () => {
    const { service } = createService();
    const features = await service.list();

    expect(features.map((feature) => feature.key)).toEqual(
      Object.keys(FEATURE_REGISTRY),
    );
    expect(features[0]).toEqual({
      key: 'recitation',
      label: FEATURE_REGISTRY.recitation.label,
      description: FEATURE_REGISTRY.recitation.description,
      enabled: false,
    });
  });

  it('records which admin changed a flag', async () => {
    const { service, prisma } = createService();
    await service.setEnabled('recitation', true, 'admin-1');

    expect(prisma.featureFlag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ updatedBy: 'admin-1' }) as unknown,
        update: expect.objectContaining({ updatedBy: 'admin-1' }) as unknown,
      }),
    );
  });

  it.each(['unknown', 'constructor', '__proto__', 'toString'])(
    'refuses to create a flag for the unregistered key "%s"',
    async (key) => {
      const { service, prisma } = createService();
      await expect(service.setEnabled(key, true, 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.featureFlag.upsert).not.toHaveBeenCalled();
    },
  );
});

describe('FeatureGuard', () => {
  @RequireFeature('recitation')
  class GatedController {
    handler() {}
  }
  class UngatedController {
    handler() {}
  }

  const contextFor = (controller: new () => { handler: () => void }) =>
    ({
      getClass: () => controller,
      getHandler: () =>
        (controller.prototype as { handler: () => void }).handler,
    }) as unknown as ExecutionContext;

  function createGuard(enabled: boolean) {
    const features = { isEnabled: jest.fn().mockResolvedValue(enabled) };
    return {
      features,
      guard: new FeatureGuard(new Reflector(), features as never),
    };
  }

  it('lets requests through when the feature is on', async () => {
    const { guard } = createGuard(true);
    await expect(guard.canActivate(contextFor(GatedController))).resolves.toBe(
      true,
    );
  });

  it('answers 404, not 403, when the feature is off, so it looks absent rather than forbidden', async () => {
    const { guard } = createGuard(false);
    await expect(
      guard.canActivate(contextFor(GatedController)),
    ).rejects.toThrow(NotFoundException);
  });

  it('checks the key declared on the controller', async () => {
    const { guard, features } = createGuard(true);
    await guard.canActivate(contextFor(GatedController));
    expect(features.isEnabled).toHaveBeenCalledWith('recitation');
  });

  it("doesn't touch the database for routes that aren't feature-gated", async () => {
    const { guard, features } = createGuard(false);
    await expect(
      guard.canActivate(contextFor(UngatedController)),
    ).resolves.toBe(true);
    expect(features.isEnabled).not.toHaveBeenCalled();
  });
});
