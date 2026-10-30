# Swiggy Instamart

| Field | Value |
|---|---|
| platform | Swiggy Instamart |
| access_method | Swiggy Builders Club: MCP servers (Food, Instamart, Dineout) with OAuth 2.1 + PKCE, delegated by the end user |
| official_documentation_url | https://mcp.swiggy.com/builders, Instamart reference https://mcp.swiggy.com/builders/docs/reference/instamart/ |
| authorization_status | Not applied. Production access needs an application, a security and use-case review, and redirect-URI allowlisting |
| credentials_required | An approved OAuth client (allowlisted redirect URIs) plus a per-user OAuth token: the shopper signs in with phone and OTP |
| available_operations | 20 Instamart tools: product search, cart, coupons, payment, checkout, order tracking, address management, support |
| returned_fields | `search_products` returns `products[]` with `displayName`, `brand`, `inStock`, `isAvail`, `productId`, `parentProductId`, and `variations[]` with `spinId`, `skuId`, `quantityDescription`, `price{mrp, offerPrice}`, `isInStockAndAvailable` |
| geographic_coverage | Wherever the user's address or coordinates are serviceable (no list published) |
| rate_limits | Caps not published; over the limit returns HTTP 429 with `Retry-After`; do not poll `track_*` more than once every 10 s |
| permitted_storage_and_display | Data only "to serve the user's immediate task", session-scoped; "competitive intelligence or benchmarking" restricted |
| known_limitations | Needs each end user to sign in; no store id or coordinates; ETA only for a placed order; fees only in the cart bill; comparison use needs Swiggy's explicit agreement |
| last_verified_at | 2026-10-29 |
| integration_status | RESEARCH_REQUIRED (candidate for ACCESS_REQUESTED) |

## Findings

All verified on 2026-10-29.

**The programme**
- Builders Club is open to individual developers, startups and enterprises. Prototyping on localhost needs no approval: https://mcp.swiggy.com/builders
- **Production access** (https://mcp.swiggy.com/builders/access/):
  - choose a track;
  - apply with company details, the use case, an architecture overview, redirect URIs, static IP ranges, a security contact, a data-handling and privacy declaration, and acknowledgement of the Swiggy MCP terms;
  - Swiggy then reviews security, compliance and use-case fit, and rolls access out gradually.
  - Contact: builders@swiggy.in.
- **Instamart is included.** Its tools (https://mcp.swiggy.com/builders/docs/reference/instamart/):
  - `search_products`, `your_go_to_items`, `get_addresses`, `create_address`, `delete_address`
  - `update_cart`, `get_cart`, `clear_cart`, `apply_coupon`, `list_coupons`
  - `get_payment_options`, `check_payment_status`, `confirm_order`, `checkout`
  - `get_orders`, `get_order_details`, `track_order`, `get_delivery_status`
  - `recommend_address`, `report_error`

**Search**

`search_products` (https://mcp.swiggy.com/builders/docs/reference/instamart/search_products.md):
- **Inputs:** `query`; `addressId`, or `latitude`/`longitude` in guest mode; `offset`.
- **Outputs:** the fields in the table above.
- **Not documented:** store id, ETA and fees.

**Authentication**

From https://mcp.swiggy.com/builders/docs/start/authenticate.md:
- OAuth 2.1 with PKCE and Dynamic Client Registration.
- Access token lasts 5 days; refresh token lasts 30 days and rotates on each refresh; authorization code lasts 120 s.

**Rate limits**

From https://mcp.swiggy.com/builders/docs/operate/rate-limits.md:
- Exact caps are not published.
- Over the limit returns HTTP 429 with `Retry-After`.
- Background jobs must be disclosed during onboarding.

**Data and compliance**

From https://mcp.swiggy.com/builders/docs/operate/data-and-compliance.md:
- Swiggy is the Data Fiduciary and the builder is a Data Processor.
- Data may be used only to serve the user's immediate task.
- There is no analytics, ads or training use without separate consent.
- Personal data must not persist beyond the session.

**Guidelines**

From https://mcp.swiggy.com/builders/access/, checked directly.
- **Restricted:**
  - "Building aggregation layers that hide Swiggy's brand or confuse users"
  - "Misrepresenting prices, availability, or delivery times"
  - "Scraping or extracting data beyond what the APIs provide"
  - "Using the APIs for competitive intelligence or benchmarking"
  - "Bypassing rate limits, logging, or any platform safeguards"
- **Zero tolerance:**
  - "Harvesting data beyond your agreed scope"
  - "misattributing where data comes from"
- **Encouraged:** "Commercial partnerships where both sides win".

## Assessment for LocalStock

This is a genuine, documented API, but it was designed for a user's own ordering. It does not fit a background price-comparison feed:
- **No background collection.** It cannot support scheduled catalogue or price refresh: data is user-delegated and session-scoped, and harvesting beyond the agreed scope is prohibited.
- **Cross-platform comparison** is likely to fall under "competitive intelligence or benchmarking" unless Swiggy explicitly agrees.
- **If Swiggy agrees,** the only shape is a customer-triggered lookup:
  - the signed-in customer asks, and LocalStock calls `search_products` for that customer's location;
  - results are shown with Swiggy Instamart branding and attribution;
  - results are not stored beyond what the agreement allows.

## Next step

If the product owner wants this, apply at https://mcp.swiggy.com/builders/access/ and describe the comparison use case plainly. Set this record to `ACCESS_REQUESTED` and keep Swiggy's written answer as the agreement reference. Build the adapter only after approval.
