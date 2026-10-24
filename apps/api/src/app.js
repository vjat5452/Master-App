import express, { Router } from 'express';
import { errorHandler } from './middleware/error-handler.js';
import { requestId, requestLogger } from './middleware/request-context.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createCatalogRouter } from './modules/catalog/catalog.routes.js';
import { createCheckoutRouter } from './modules/checkout/checkout.routes.js';
import { createDeliveryRouter } from './modules/delivery/delivery.routes.js';
import { createDiscoveryRouter } from './modules/discovery/discovery.routes.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createInventoryRouter } from './modules/inventory/inventory.routes.js';
import { createOffersRouter } from './modules/offers/offers.routes.js';
import { createOrdersRouter } from './modules/orders/orders.routes.js';
import { createOrganizationsRouter } from './modules/organizations/organizations.routes.js';
import { createPaymentsRouter } from './modules/payments/payments.routes.js';
import { createWarehousesRouter } from './modules/warehouses/warehouses.routes.js';
import { AppError } from './shared/errors.js';

/**
 * @param {{config, logger, pool, redis, state: {shuttingDown: boolean}}} deps
 */
export function createApp(deps) {
  const app = express();
  app.disable('x-powered-by');

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
    createCheckoutRouter,
    createOrdersRouter,
    createPaymentsRouter,
  ]) {
    api.use(createRouter(deps));
  }
  app.use('/api/v1', api);

  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  app.use(errorHandler(deps.logger));
  return app;
}
