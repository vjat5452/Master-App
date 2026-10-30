# Amazon India

| Field | Value |
|---|---|
| platform | Amazon India (amazon.in) |
| access_method | Amazon Creators API, the successor of the Product Advertising API 5.0 (now deprecated; calls return HTTP 403) |
| official_documentation_url | https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction |
| authorization_status | No access held or requested |
| credentials_required | An Amazon Associates account, "a valid Partner Tag for the target marketplace and Creators API access approved in that region" (Creators API FAQ) |
| available_operations | Product catalogue access; `GetItems` takes up to 10 item ids per call. Search, offers, price and availability operations: to be read from the API reference once access exists |
| returned_fields | Not yet verified |
| geographic_coverage | India is a supported locale (`https://www.amazon.in`) |
| rate_limits | Not yet verified |
| permitted_storage_and_display | Governed by the Associates Operating Agreement and Program Policies; must be read before storing or displaying prices |
| known_limitations | Amazon's marketplace catalogue, not quick-commerce dark-store data (Amazon Fresh/Now slots); affiliate approval required |
| last_verified_at | 2026-10-29 |
| integration_status | RESEARCH_REQUIRED (candidate for the first live connector) |

## Sources (read 2026-10-29)

- Deprecation of PA-API 5 and replacement by the Creators API: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation
- Locale reference (India listed): https://affiliate-program.amazon.com/creatorsapi/docs/en-us/locale-reference
- FAQ (Partner Tag, regional approval, `GetItems` batch of 10): https://affiliate-program.amazon.com/creatorsapi/docs/en-us/frequently-asked-questions
- Operating Agreement: https://affiliate-program.amazon.com/help/operating/agreement/
- Program Policies: https://affiliate-program.amazon.com/help/operating/policies

## Next step

The account holder registers for the Creators API with an Associates India account. The adapter is then written from the API reference and accepted following the Milestone 5 steps. Until then, LocalStock only shows a "Search on Amazon India" link (`https://www.amazon.in/s?k=…`) that the shopper opens in their own browser.
