# Blinkit

| Field | Value |
|---|---|
| platform | Blinkit (Blink Commerce Pvt Ltd) |
| access_method | None available. Candidates: a business partnership with Blinkit; a licensed provider with proven upstream authorization |
| official_documentation_url | None found (no public developer portal or API documentation) |
| authorization_status | No access held or requested |
| credentials_required | Unknown |
| available_operations | None known |
| returned_fields | None documented |
| geographic_coverage | Unknown |
| rate_limits | Unknown |
| permitted_storage_and_display | None granted. Blinkit's Bistro terms prohibit collecting listings and prices (see below); the main terms could not be read |
| known_limitations | No public API; Seller Hub covers only the seller's own listings; main terms and robots.txt not retrievable |
| last_verified_at | 2026-10-29 |
| integration_status | RESEARCH_REQUIRED |

## Findings

**Verified**
- **No public developer API.** Searches found only third-party scrapers and integrators. One integrator's help page describes sellers mapping their own fulfilment facilities to Blinkit warehouses: https://support.unicommerce.com/index.php/knowledge-base/integration-with-blinkit/
- **Seller Hub.** A self-serve Seller Hub for brands was launched in October 2024, with more than 200 brands given access after regulatory verification: https://inc42.com/?p=483404
  - The report mentions no API.
  - It is a tool for sellers to manage their own listings, not a data feed for third parties.
- **Terms.** https://blinkit.com/terms and https://blinkit.com/robots.txt returned HTTP 403 when fetched.
  - An archived copy (captured 2026-02-22) of the terms for Blinkit's Bistro service prohibits "any use of data mining, robots, or similar data gathering and extraction tools" and "any collection, use or derivative use of… any product listings, descriptions, or prices": https://tostracker.app/document/grofers
  - That copy covers Bistro only.

**Unknown**
- Any partner or affiliate API.
- Whether Blinkit participates in ONDC.
- Any authorized channel for dark-store identity, ETA or fees.
- The automated-access clauses of the main Blinkit terms.

## Next step

Contact Blinkit about a data partnership for price comparison, and record the request here as `ACCESS_REQUESTED`.
