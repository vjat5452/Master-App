import { BaseConnector } from './base-connector.js';

/**
 * A source we have no authorized access to. It declares nothing as supported, reports
 * NOT_CONFIGURED health, and every operation fails with SOURCE_NOT_CONFIGURED. It never
 * returns data, so nothing can be mistaken for a live result.
 */
export class NotConfiguredConnector extends BaseConnector {
  /** @param {{ missing: string[], reason: string } & ConstructorParameters<typeof BaseConnector>[0]} opts */
  constructor({ missing, reason, ...opts }) {
    super({ ...opts, capabilities: {} });
    this.missing = missing;
    this.reason = reason;
  }

  validateConfiguration() {
    return { ok: false, missing: [...this.missing], reason: this.reason };
  }
}
