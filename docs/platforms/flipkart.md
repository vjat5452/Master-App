# Flipkart

| Field | Value |
|---|---|
| platform | Flipkart (flipkart.com), including Flipkart Minutes |
| access_method | Flipkart Affiliate API (developer portal lists a Product API, an Offers API and a Report API) |
| official_documentation_url | https://affiliate.flipkart.com/api-docs/affiliate_index.html |
| authorization_status | No access held or requested |
| credentials_required | A Flipkart Affiliate account and API credentials; exact names to be taken from the portal |
| available_operations | Product feed and offers per the portal's section list; search and per-product details not yet verified |
| returned_fields | Not yet verified |
| geographic_coverage | India |
| rate_limits | Not yet verified |
| permitted_storage_and_display | Per the Flipkart Affiliate terms; must be read before storing or displaying prices |
| known_limitations | Flipkart Minutes (quick commerce) location-specific stock is not known to be available through the affiliate API |
| last_verified_at | 2026-10-29 |
| integration_status | RESEARCH_REQUIRED |

## Sources (read 2026-10-29)

- Developer portal: https://affiliate.flipkart.com/api-docs/affiliate_index.html
- Third-party listings place the keyword search at `affiliate-api.flipkart.net`. This is unofficial, and must be confirmed on the portal before use.

## Next step

The account holder joins the Flipkart Affiliate programme and obtains API credentials. The adapter is then written from the portal documentation. Until then, LocalStock only shows a "Search on Flipkart" link (`https://www.flipkart.com/search?q=…`) opened in the shopper's browser.
