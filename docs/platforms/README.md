# External platform access: research records

One file per platform records how LocalStock could get **authorized** access to its product, price, availability and serviceability data. The research follows the master prompt (Phase 3).
- Only facts with a source are recorded; anything not verified stays **unknown**.
- Public pages only were read; no platform API was called.

Last verified: **2026-10-29**. Every platform below is `RESEARCH_REQUIRED`: LocalStock holds no authorized access to any of them. Their connectors are switched off and return `SOURCE_NOT_CONFIGURED` (see `packages/connectors/src/platforms.js`).

| Platform | Record |
|---|---|
| Blinkit | [blinkit.md](blinkit.md) |
| Zepto | [zepto.md](zepto.md) |
| Swiggy Instamart | [swiggy-instamart.md](swiggy-instamart.md) |
| BigBasket | [bigbasket.md](bigbasket.md) |
| Licensed data providers and ONDC | [providers-and-ondc.md](providers-and-ondc.md) |

## Comparison

| | Blinkit | Zepto | Swiggy Instamart | BigBasket |
|---|---|---|---|---|
| Public developer API | None found | None found | Yes: Swiggy Builders Club (MCP), approval required | None found |
| Channel that exists | Seller Hub (sellers, own listings) | Brand Portal / Zepto Atom (brands, own data) | User-delegated MCP tools: search, cart, checkout, tracking | Affiliate links via third-party networks |
| Location-specific price/stock | Unknown | Brand's own PIN-level data only | Yes, per address or coordinates at query time | Unknown |
| Dark store id / coordinates | Unknown | Unknown | Not exposed in the docs | Unknown |
| ETA / fees | Unknown | Unknown | ETA per placed order; fees in the cart bill | Unknown |
| Third-party comparison display permitted | Not granted; Bistro terms prohibit collecting listings and prices; main terms not fetched | Unknown; terms not fetched | Restricted: "competitive intelligence or benchmarking" is not allowed | No: terms cl. 10.9 and 14.2 |
| `integration_status` | RESEARCH_REQUIRED | RESEARCH_REQUIRED | RESEARCH_REQUIRED (candidate for ACCESS_REQUESTED) | RESEARCH_REQUIRED |

## What this means for LocalStock

1. **No live platform data can be shown today.** Building a scraper would break the stated terms of at least BigBasket, and would break the master prompt's rules. The connectors therefore stay disabled.
2. **Swiggy Instamart is the only platform with a documented API.**
   - Its guidelines restrict "Using the APIs for competitive intelligence or benchmarking" and "Building aggregation layers that hide Swiggy's brand or confuse users".
   - A comparison feature needs Swiggy's explicit written agreement first. Apply via https://mcp.swiggy.com/builders/access/, describe the comparison use case honestly, and record the decision here.
3. **For Blinkit, Zepto and BigBasket the realistic route is a business partnership.** The alternative is a licensed data provider that can show **upstream authorization from the platform and display rights**. No provider found so far shows that (see [providers-and-ondc.md](providers-and-ondc.md)).
4. **ONDC** is a legitimate route to price and availability data, but only for sellers on ONDC. None of the four platforms was found to list its own catalogue there.

## Updating a record

When access status changes, update `integration_status` and `last_verified_at` in that platform's file. Add the agreement reference (not the credentials). Only then implement an adapter, following the Milestone 5 acceptance steps in `docs/LOCALSTOCK_IMPLEMENTATION_PLAN.md`.

Status values: `RESEARCH_REQUIRED`, `ACCESS_REQUESTED`, `SANDBOX`, `APPROVED`, `ACTIVE`, `DISABLED`.
