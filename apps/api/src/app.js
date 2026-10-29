import express, { Router } from 'express';
import { buildConnectorRegistry } from '@localstock/connectors';
import { errorHandler } from './middleware/error-handler.js';
import { createAdminRouter } from './modules/admin/admin.routes.js';
import { createImportsRouter } from './modules/imports/imports.routes.js';
import { requestId, requestLogger } from './middleware/request-context.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createCatalogRouter } from './modules/catalog/catalog.routes.js';
import { createCheckoutRouter } from './modules/checkout/checkout.routes.js';
import { createDeliveryRouter } from './modules/delivery/delivery.routes.js';
import { createCompareRouter } from './modules/discovery/compare.routes.js';
import { createDiscoveryRouter } from './modules/discovery/discovery.routes.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createInventoryRouter } from './modules/inventory/inventory.routes.js';
import { createOffersRouter } from './modules/offers/offers.routes.js';
import { createOrdersRouter } from './modules/orders/orders.routes.js';
import { createOrganizationsRouter } from './modules/organizations/organizations.routes.js';
import { createPaymentsRouter } from './modules/payments/payments.routes.js';
import { createChangeFeed } from './modules/realtime/change-feed.js';
import { createStreamRouter } from './modules/realtime/stream.routes.js';
import { createWarehousesRouter } from './modules/warehouses/warehouses.routes.js';
import { AppError } from './shared/errors.js';

/**
 * @param {{config, logger, pool, redis, state: {shuttingDown: boolean}, connectors?}} deps
 *   connectors: external source registry; defaults to every source disabled.
 */
export function createApp(inputDeps) {
  const deps = {
    ...inputDeps,
    connectors: inputDeps.connectors ?? buildConnectorRegistry({ env: { NODE_ENV: inputDeps.config.NODE_ENV } }),
    changeFeed: inputDeps.changeFeed ?? createChangeFeed({ pool: inputDeps.pool, logger: inputDeps.logger }),
  };
  const app = express();
  app.disable('x-powered-by');
  // Closed on shutdown so open event streams do not hold the server open.
  app.locals.changeFeed = deps.changeFeed;

  app.use(requestId());
  // Keep the raw body for webhook signature verification.
  app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => (req.rawBody = buf) }));
  app.use(requestLogger(deps.logger));

  app.use(createHealthRouter(deps));

  const api = Router();
  for (const createRouter of [
    createAuthRouter,
    createOrganizationsRouter,
    createWarehousesRouter,
    createDeliveryRouter,
    createCatalogRouter,
    createOffersRouter,
    createInventoryRouter,
    createDiscoveryRouter,
    createCompareRouter,
    createStreamRouter,
    createCheckoutRouter,
    createOrdersRouter,
    createPaymentsRouter,
    createImportsRouter,
    // Last: it guards every /admin path, so earlier routers keep their own /admin routes.
    createAdminRouter,
  ]) {
    api.use(createRouter(deps));
  }
  app.use('/api/v1', api);

  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  app.use(errorHandler(deps.logger));
  return app;
}
