// No platform has an authorized integration yet (see docs/platforms/). searchUrl is only a
// link for the shopper to open; LocalStock never fetches these pages.
import { NotConfiguredConnector } from './not-configured.js';

export const PLATFORMS = Object.freeze([
  { code: 'blinkit', name: 'Blinkit', envPrefix: 'BLINKIT', doc: 'docs/platforms/blinkit.md', searchUrl: 'https://blinkit.com/s/?q={q}', searchUrlVerified: false },
  { code: 'zepto', name: 'Zepto', envPrefix: 'ZEPTO', doc: 'docs/platforms/zepto.md', searchUrl: 'https://www.zeptonow.com/search?query={q}', searchUrlVerified: true },
  { code: 'instamart', name: 'Swiggy Instamart', envPrefix: 'INSTAMART', doc: 'docs/platforms/swiggy-instamart.md', searchUrl: 'https://www.swiggy.com/instamart/search?query={q}', searchUrlVerified: false },
  { code: 'bigbasket', name: 'BigBasket', envPrefix: 'BIGBASKET', doc: 'docs/platforms/bigbasket.md', searchUrl: 'https://www.bigbasket.com/ps/?q={q}', searchUrlVerified: true },
  { code: 'amazon', name: 'Amazon India', envPrefix: 'AMAZON', doc: 'docs/platforms/amazon-india.md', searchUrl: 'https://www.amazon.in/s?k={q}', searchUrlVerified: true },
  { code: 'flipkart', name: 'Flipkart', envPrefix: 'FLIPKART', doc: 'docs/platforms/flipkart.md', searchUrl: 'https://www.flipkart.com/search?q={q}', searchUrlVerified: true },
]);

export function platformSearchLinks(query) {
  const q = encodeURIComponent(query.trim().replace(/\s+/g, ' '));
  return PLATFORMS.map((p) => ({ platformCode: p.code, name: p.name, url: p.searchUrl.replace('{q}', q), verified: p.searchUrlVerified }));
}

// Disabled until an approved adapter exists.
export function createPlatformConnector(platform, { enabled, logger, now }) {
  const reason = enabled
    ? `${platform.envPrefix}_ENABLED is true, but no authorized ${platform.name} integration has been implemented. See ${platform.doc}.`
    : `${platform.name} is not configured: LocalStock has no authorized access to ${platform.name} data. See ${platform.doc}.`;
  const connector = new NotConfiguredConnector({
    code: `${platform.code}-official`,
    platformCode: platform.code,
    name: platform.name,
    accessType: 'OFFICIAL_API',
    missing: ['authorized access agreement', `approved ${platform.name} integration`],
    reason,
    logger,
    now,
  });
  connector.platformName = platform.name;
  return connector;
}
