import { BaseConnector } from './base-connector.js';

// A source without authorized access: every operation fails and it never returns data.
export class NotConfiguredConnector extends BaseConnector {
  constructor({ missing, reason, ...opts }) {
    super({ ...opts, capabilities: {} });
    this.missing = missing;
    this.reason = reason;
  }

  validateConfiguration() {
    return { ok: false, missing: [...this.missing], reason: this.reason };
  }
}
