# Zepto

| Field | Value |
|---|---|
| platform | Zepto |
| access_method | None available to third parties. Candidates: a partnership with Zepto; a licensed provider with proven upstream authorization |
| official_documentation_url | None found (no public developer API) |
| authorization_status | No access held or requested |
| credentials_required | Unknown |
| available_operations | None known for third parties |
| returned_fields | None documented |
| geographic_coverage | Unknown |
| rate_limits | Unknown |
| permitted_storage_and_display | Unknown; none granted |
| known_limitations | No public API; brand tools cover only a brand's own data; robots.txt disallows `/api/` and `/search`; terms could not be read |
| last_verified_at | 2026-10-29 |
| integration_status | RESEARCH_REQUIRED |

## Findings

**Verified**
- **No public developer API.**
- **Seller EDI integration.** Unicommerce documents an "EDI API" integration that lets existing Zepto sellers fetch their own purchase orders, enabled per account by Zepto support: https://support.unicommerce.com/index.php/knowledge-base/integration-with-zepto/
- **Zepto Atom** (May 2025) is a paid add-on to the Zepto Brand Portal. It gives brands PIN-code-level market share, sales, impressions and conversions about their own products. Sources:
  - https://www.socialsamosa.com/industry-updates/zepto-rolls-out-subscription-based-data-insights-service-zepto-atom-9074169
  - https://www.storyboard18.com/brand-marketing/zepto-launches-zepto-atom-for-hyperlocal-consumer-insights-for-brands-65984.htm
- **robots.txt.** https://www.zepto.com/robots.txt disallows `/api/`, `/search`, `/location/`, `/cart/` and `/account*`.

**Unknown**
- The terms of service: https://www.zepto.com/terms-of-service returned empty content when fetched.
- Any affiliate programme.
- Whether Zepto participates in ONDC.
- Whether Atom data may be redistributed.
- Any authorized channel for dark-store, ETA or fee data.

## Next step

Contact Zepto about a data partnership. Brand-portal data belongs to brands and is not a route for a comparison service.
