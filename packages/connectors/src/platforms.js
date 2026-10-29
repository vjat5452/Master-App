// The four quick-commerce platforms LocalStock wants to compare with. None has an
// authorized integration yet (see docs/platforms/), so each is a NotConfiguredConnector.
// When access is granted, its adapter replaces the entry's `create` and documents the
// exact credentials the agreement provides; until then no credential names are invented.
import { NotConfiguredConnector } from './not-configured.js';

export const PLATFORMS = Object.freeze([
  { code: 'blinkit', name: 'Blinkit', envPrefix: 'BLINKIT', doc: 'docs/platforms/blinkit.md' },
  { code: 'zepto', name: 'Zepto', envPrefix: 'ZEPTO', doc: 'docs/platforms/zepto.md' },
  { code: 'instamart', name: 'Swiggy Instamart', envPrefix: 'INSTAMART', doc: 'docs/platforms/swiggy-instamart.md' },
  { code: 'bigbasket', name: 'BigBasket', envPrefix: 'BIGBASKET', doc: 'docs/platforms/bigbasket.md' },
]);

/** The platform's own connector: disabled until an approved adapter exists. */
export function createPlatformConnector(platform, { enabled, logger, now }) {
  const reason = enabled
    ? `${platform.envPrefix}_ENABLED is true, but no authorized ${platform.name} integration has been implemented. See ${platform.doc}.`
    : `${platform.name} is not configured: LocalStock has no authorized access to ${platform.name} data. See ${platform.doc}.`;
  return new NotConfiguredConnector({
    code: `${platform.code}-official`,
    platformCode: platform.code,
    name: platform.name,
    accessType: 'OFFICIAL_API',
    missing: ['authorized access agreement', `approved ${platform.name} integration`],
    reason,
    logger,
    now,
  });
}
