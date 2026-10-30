# Unified live comparison: inspection and gap analysis

Milestone 1 of the "Unified Live Commerce Price Comparison" brief (2026-10-29). It compares the brief with what already exists on branch `feature/unified-external-platform-discovery`, audits the two reference repositories, records how Amazon India can be accessed, and proposes the remaining milestones. No code or schema was changed in this milestone.

## 1. What already exists

The earlier master-prompt work (Milestones 1–11, see `LOCALSTOCK_IMPLEMENTATION_PLAN.md`) built most of the foundation. The brief's concepts map onto it like this:

| Brief concept | Existing implementation |
|---|---|
| Canonical product catalogue | `product_variants`, with GTIN, brand, name, attributes and parsed `pack_quantity/unit/count` |
| Local vendor listings | `seller_offers` + `warehouse_inventory` (unchanged and authoritative) |
| External platform listings | `external_listings`, `external_product_mappings` |
| Price / availability observations | `external_price_observations`, `external_availability_observations`, with `source_observed_at` / `collected_at` / `stored_at` |
| Fulfillment locations, serviceability | `external_fulfillment_nodes` (coordinates only if the source supplied them), `external_serviceability_observations` |
| Connector framework | `packages/connectors`: contract, capabilities, resilience, disabled Blinkit/Zepto/Instamart/BigBasket adapters, licensed-provider adapter, development-only demo source |
| Unified search | `POST /discovery/compare` (non-streaming) |
| Matching, never merging sizes | `packages/external-data` matcher: GTIN, then brand + pack size + name, with fuzzy matching only proposing; admin review queue |
| Real-time | `GET /discovery/stream`: server-sent events of detected changes (not of search results) |
| Dashboard | Admin → External sources: per-source status, health, runs, test connection, integration status |
| Background refresh | demand-driven scheduler, collector, health checks, retention, metrics |

Verified by 158 unit tests, 125 database tests, 84 endpoint smoke checks, and green CI.

## 2. Gaps against the brief

| § | Requirement | State | Gap |
|---|---|---|---|
| 2 | Product discoverable when no LocalStock vendor stocks it | Partial | `/discovery/compare` returns unmatched external listings, but the storefront search and product pages only know LocalStock catalogue products. An external-only product has no canonical identity and no page. |
| 2, 8 | Create or reuse a canonical identity for products found externally | Missing | The matcher links listings to existing variants only. Nothing creates a canonical product from an external listing. `product_variants.group_id` is NOT NULL and there is no "origin" field. |
| 8 | Admin can review and enrich product metadata | Partial | Admins can change a variant's status only; there is no metadata edit endpoint. |
| 3 | Amazon India connector | Missing | The other four platforms exist as disabled adapters. Amazon India has an official API (§4), so it is the candidate for the first genuine connector. |
| 3, 7 | Admin enable/disable control | Missing | Sources are enabled only through environment variables. |
| 4 | `POST /discovery/search` with `platforms` including `localstock`, and `refresh` | Partial | Equivalent behaviour exists as `/discovery/compare` (`includeLocalVendors`, `refreshPolicy`). Needs the brief's contract, as a thin layer over the same service. |
| 5 | Progressive per-source results | Missing | Compare waits for all sources (bounded by a 5 s deadline). Results are not streamed as each source answers. |
| 6 | Unit-price comparison | Missing | Pack sizes are parsed; ₹ per 100 g / 100 ml / piece is not computed. |
| 6 | Explanation when an offer cannot be compared | Partial | `sizeMatch` and notices exist; there is no per-result "why not comparable" text. |
| 6 | Last successful availability check | Partial | Stored per observation; not surfaced per listing. |
| 7 | "Platform Comparison" section with Live / Degraded / Disabled / Authorization required / Not configured | Partial | The data exists (integration status, health, configured state, listing counts); the brief's status vocabulary, the section name, and the enable control are missing. |
| 7 | Comparison in the customer-facing search interface | Partial | Product page only; not in search results. |
| 9 | Prioritise recently viewed and stale listings | Partial | Demand from comparisons drives refresh; product views and staleness do not. |
| 10 | Basket comparison data model and API (no ordering) | Missing | |
| 11 | Scenarios A–H | See §6 | A, C, D, E, F and H pass today. B and G are partial. A and B can only be shown with demo data until a real source is connected. |

## 3. Reference repositories

Both were read on 2026-10-29 from their public GitHub pages (README and file listing). I did not audit their dependency trees in depth.

### CartRadar ([github.com/Harsh-Gopal/CartRadar](https://github.com/Harsh-Gopal/CartRadar))

- **Facts:**
  - MIT License; 11 stars, 64 commits.
  - Stack: Python (FastAPI, Uvicorn, SQLite, `httpx`, Playwright); React + TypeScript + Vite + Leaflet frontend.
  - It streams results with server-sent events and covers Zepto, Instamart, BigBasket, Blinkit, Flipkart Minutes and BB Now.
- **How it gets data:**
  - It "accesses publicly available product and availability data through the same API endpoints that the platforms' own websites use", which are internal, undocumented endpoints.
  - It uses Playwright "for platforms with aggressive WAFs".
  - It uses "cookie-based location spoofing" for BigBasket, and an optional `PROXY_URL`.
- **Its own disclaimer:** it is "for educational and personal learning purposes only"; "using automated tools to access platform APIs may be against the Terms of Service"; it is "not intended for commercial use, data scraping at scale".
- **Assessment:**
  - Its platform access code cannot be used. It relies on unofficial endpoints and on working around web application firewalls, which the brief forbids. Its MIT licence covers its code, not access to the platforms.
  - It is also a different language and stack.
- **Ideas worth adopting** (architecture only, re-implemented):
  - stream results to the UI as each source answers;
  - cache where stores serve, but never cache stock;
  - per-platform client modules;
  - an area sweep around the customer.

### QuickCom ([github.com/KshKnsl/QuickCom](https://github.com/KshKnsl/QuickCom))

- **Facts:**
  - MIT License; 10 stars, 13 commits.
  - Stack: Node, Express, Puppeteer ("Web automation and scraping"), WebSocket; React + TypeScript + Tailwind + shadcn/ui frontend.
  - Per-platform folders (`blinkit/`, `zepto/`, `instamart/`), each with `searchHelpers.js` and `set-location.js`.
  - Results arrive "as they're found thanks to WebSocket integration".
- **How it gets data:** browser automation of the consumer websites. It has no terms-of-service disclaimer ("Happy shopping and happy scraping!").
- **Assessment:**
  - Not reusable for data access, for the same reason.
  - The per-platform module layout and the progressive delivery already match LocalStock's design.
  - LocalStock will use server-sent events, not WebSockets: SSE is already in the stack, and results only flow one way.

**Conclusion:** neither repository provides a permitted way to get platform data, and I will not copy their access code. LocalStock already has the parts they do well (per-platform modules, location handling, streaming). The streaming of search results is the one piece to add (§5).

## 4. Amazon India: an official route exists

Amazon's Product Advertising API 5.0 is deprecated; calls to it now return 403. It is replaced by the **Creators API**, a REST API "that provides programmatic access to Amazon's product catalog data for publishers, influencers, and affiliate partners".
- Deprecation notice: <https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation>
- **India is a supported locale** (`https://www.amazon.in`): <https://affiliate-program.amazon.com/creatorsapi/docs/en-us/locale-reference>
- Access needs "a valid Partner Tag for the target marketplace and Creators API access approved in that region": <https://affiliate-program.amazon.com/creatorsapi/docs/en-us/frequently-asked-questions>
- `GetItems` accepts up to 10 item ids.

**Not yet verified** (must be read before implementation, and needs the account holder's access):
- the exact operations and fields (search, offers, price, availability);
- rate limits;
- the Associates Operating Agreement and Program Policies on caching, storing and displaying prices, and on whether a price-comparison display is allowed.

Amazon's documents are the source of truth for these points; I will not assume them.

**What it would and would not give:**
- It gives the Amazon India catalogue with prices and availability, as an affiliate.
- It does not give quick-commerce dark-store data (Amazon Fresh or Now delivery slots). Coverage will differ from Blinkit, Zepto and Instamart.
- **Requirement:** the project owner needs an Amazon Associates India account with Creators API access and a Partner Tag.

The status of the other platforms is unchanged from `docs/platforms/`: no authorized access. Swiggy's Builders Club API is user-delegated and restricts benchmarking. BigBasket's terms prohibit collecting listings and prices.

## 5. Proposed milestones

The brief's milestones, adjusted to what exists. Each ends with the same report: files, schema changes, tests, limitations, next step.

| # | Milestone | Main changes |
|---|---|---|
| 1 | Inspection and gap analysis | This document **(done)** |
| 2 | Canonical catalogue extension | **Done** (migration 007; 006 went to the price history). See §8. |
| 3 | Connector framework additions | Amazon India Creators API adapter, built from its documentation and disabled until credentials exist. Admin enable/disable stored in `external_sources` (it can switch off any source, and can switch on only one that is configured). Status vocabulary: Live / Degraded / Disabled / Authorization required / Not configured. |
| 4 | First verified live connector | **Blocked** on Amazon Associates India access. Acceptance follows the existing Milestone 5 steps: sandbox test, redacted fixture, field validation, persistence, status ACTIVE with evidence. |
| 5 | Unified search API | `POST /discovery/search` with the brief's request shape, over the existing compare service. It adds external-only products, ₹ per 100 g / 100 ml / unit when units are compatible, per-result comparability explanations, and the last successful availability check. |
| 6 | Real-time streaming | The same endpoint streams server-sent events with `Accept: text/event-stream`: one event per source as it answers or times out, then a final ranked event. The frontend shows each source's state. |
| 7 | Platform dashboard and customer UI | The "Platform Comparison" admin section: all platforms including Amazon, status vocabulary, capabilities, coverage (listings and matches), last success and last error, enable control. Text badges instead of trademark logos unless you hold rights to them. Comparison in the customer search results, including external-only products. |
| 8 | Background refresh additions | Recently viewed products and stale listings added to the refresh priority. |
| 9 | Basket comparison | Migration for saved baskets. `POST /discovery/basket/compare`: per-platform totals, unavailable items, known fees, minimum order where known, split-basket suggestion. No ordering. |
| 10 | Scenario tests and readiness | Database-backed tests for scenarios A–H, the endpoint smoke test extended, docs and runbook updated. |

## 6. Scenarios today

| Scenario | Today | Notes |
|---|---|---|
| A: in LocalStock and on 3 platforms | Partial | Works with one demo source; needs 3 sources (demo or real) to show fully |
| B: only on Blinkit and Zepto | Partial | Compare returns them; search and product pages do not (Milestones 2, 5, 7) |
| C: one platform down | Pass | Per-source timeout and failure isolation, tested |
| D: different pack sizes | Pass | Never merged; tested |
| E: location changes | Pass | Per-cell serviceability and cache; tested |
| F: stale cached price | Pass | Freshness per source and field; tested |
| G: platform needs authorization | Partial | Shown as "Not configured / Research required"; needs the brief's "Authorization required" label (Milestone 3) |
| H: admin sees all platforms and health | Pass | Admin → External sources |

## 8. Done since this analysis

**Price graph and platform links** (requested 2026-10-29)
- Migration `006_offer_price_history.sql`: a trigger records every seller price, MRP and status change.
- `GET /catalog/variants/:id/price-history`: daily LocalStock lowest price, plus one line per authorized source; days without data stay empty.
- `GET /catalog/variants/:id/platform-links`: each platform's own public search page, opened in the shopper's browser. Nothing is fetched from the platforms.
- Amazon India and Flipkart are added as disabled platforms, each with a research record.

**Milestone 2: canonical catalogue extension**
- **Migration** `007_external_canonical_products.sql` (reversible):
  - `product_variants.origin` (`LOCALSTOCK` / `EXTERNAL`) and `created_from_listing_id`;
  - `group_id` may be NULL only for EXTERNAL products, and an ACTIVE product always has a group;
  - new mapping method `NEW_CANONICAL`.
  - Used instead of a system "Unclassified" group, because that group would have shown in the storefront category list.
- **Creating products:** an external listing that matches no product, and whose pack size is known, creates a canonical product: EXTERNAL, `PENDING_REVIEW`, no group.
  - Later listings of the same product, from any platform, match it instead of creating another.
  - The identity key is built from the matcher's identifying words and the pack size, so two platforms answering at the same moment create one product, not two.
- **Behaviour:**
  - These products appear in `/catalog/search` with `origin: EXTERNAL` and no offers.
  - Their product page shows the comparison, price history and platform links.
  - No seller, warehouse or stock row is ever created for them.
  - Sellers cannot list them (offers need ACTIVE). Approving needs a group (`422 GROUP_REQUIRED`).
- **Admin:**
  - `PATCH /catalog/variants/:id` enriches a product (name, brand, attributes, barcode, group; audited). Its identity key is recomputed so later seller proposals match it.
  - The review queue lists discovered products with the platform they were found on (`?origin=EXTERNAL`), and the moderation tab has a **Classify** dialog.
- **Tests:** scenarios B and D (two test sources, failing third source), duplicate prevention, the approve flow; the smoke test now has 89 checks over 58 routes.

## 7. Decisions needed before Milestone 2

Taken with the recommended defaults on 2026-10-29: (1) yes, as built in §8; (2) Amazon and Flipkart stay disabled until accounts exist; (3) no extra demo sources, since tests use their own test sources; (4) text badges.

1. **Canonical products from external listings.** Approve creating them as `product_variants` with `origin = EXTERNAL`, status `PENDING_REVIEW`, in an "Unclassified" group: discoverable and comparable, never sellable until an admin approves and classifies them.
2. **Amazon India.** Will you apply for (or do you have) Amazon Associates India with Creators API access? Without it, the Amazon connector stays disabled and Milestone 4 stays blocked.
3. **Demo sources for scenarios A and B.** Approve two more fictional, development-only demo sources, so the scenarios can be demonstrated and tested before any real access exists. They would be clearly labelled demo data and refused in production, like the current one.
4. **Logos.** Use text badges (name or initial) for platforms rather than their trademark logos, unless you confirm you have the right to show the logos.
