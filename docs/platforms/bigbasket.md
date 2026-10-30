# BigBasket

| Field | Value |
|---|---|
| platform | BigBasket (including BB Now) |
| access_method | None available. Candidates: a business partnership; affiliate networks (tracking links only, no data) |
| official_documentation_url | None found (no public developer portal or API documentation) |
| authorization_status | No access held or requested |
| credentials_required | Unknown |
| available_operations | None known |
| returned_fields | None documented |
| geographic_coverage | Unknown |
| rate_limits | Unknown |
| permitted_storage_and_display | **Not permitted** without agreement: the terms prohibit automated access and the collection of listings and prices |
| known_limitations | No API; the strongest written anti-collection terms of the four platforms |
| last_verified_at | 2026-10-29 |
| integration_status | RESEARCH_REQUIRED |

## Findings

**Verified**
- **No public developer API.** An API Evangelist profile says the same: https://providers.apievangelist.com/providers/bigbasket/
- **Partner login.** A partner login page exists at https://www.bigbasket.com/partner/login/; its scope is unknown.
- **Terms** (https://www.bigbasket.com/fp/web/terms-and-conditions/, checked directly):
  - **Clause 10.9:** "You shall not use any 'deep-link', 'page-scrape', 'robot', 'spider' or other automatic device … to access, acquire, copy or monitor any portion of the Platform".
  - **Clause 14.1:** "The content and software of the Platform may be used only as a shopping resource."
  - **Clause 14.2:** the licence "does not include any resale or commercial use of the Platform, … any collection and use of any product listings, descriptions, or prices; … any use of data mining, robots, or similar data gathering and extraction tools."
- **robots.txt.** https://www.bigbasket.com/robots.txt disallows `/p/`, `/product/`, `/pd/` and `/_next/data/`.
- **Affiliate programmes** are listed only on third-party networks, and their status conflicts:
  - listed by INRDeals, EarnKaro and Cuelinks;
  - FlexOffers says the programme is not offered.
  - These networks give tracking links, not a catalogue or price feed.

**Unknown**
- What the partner portal offers.
- Whether BigBasket participates in ONDC as a seller. One undated report says it joined ONDC as a buyer app, which would not expose its own catalogue.

## Next step

Only a written agreement with BigBasket could allow its prices to be shown. Until then the connector stays `SOURCE_NOT_CONFIGURED`.
