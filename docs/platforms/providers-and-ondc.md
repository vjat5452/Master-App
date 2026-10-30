# Licensed data providers and ONDC

Last verified: 2026-10-29.

## Licensed data providers

A licensed provider is acceptable only if **all** of the following hold:

1. It collects data with the platform's authorization: a partnership or API agreement. Collection that breaks the platform's terms, or that bypasses anti-bot protections, does not qualify.
2. Its licence lets LocalStock **display** the data to customers. "Internal use only" is not enough.
3. It states where each value came from and when it was observed.

Providers found advertising Indian quick-commerce price and availability datasets. None currently meets the criteria above.

| Provider | What it says | Assessment |
|---|---|---|
| Actowiz Solutions ([dataset](https://www.actowizsolutions.com/datasets/details/swiggy-instamart-india-twice-a-day-q-commerce-dataset), [method](https://www.actowizsolutions.com/dark-store-pricing-availability.php)) | Fields include PIN code, store id, MRP, price and stock, refreshed twice a day. Says it collects public pages and respects robots.txt and platform terms. Licence is for internal use; redistribution or embedding needs a separate licence | Collection is scraping of platform pages, which BigBasket's terms prohibit. No upstream authorization shown. Display rights not included. **Not acceptable as is** |
| 42Signals ([blog](https://42signals.com/blog/data-scraping-for-indian-quick-commerce-brands)) | Describes scraping quick-commerce platforms | Method and redistribution rights not stated. **Not acceptable as is** |
| ScrapeHero ([guide](https://www.scrapehero.com/scrape-zepto-data/)), Spider.cloud | Recommend proxy rotation and "anti-bot handling" or "protection bypass" | Bypassing protections. **Not acceptable** |
| productdatascrape.com (reviewed earlier in this project) | Says it uses bots that bypass app blockers | Bypassing protections. **Not acceptable** |

The connector for a provider that does qualify already exists:
- **Code:** `LicensedProviderConnector` in `packages/connectors/src/licensed-provider.js`.
- **Off by default.** It runs only when the provider's base URL, API key and a mapping file are configured.
- **Mapping file:** written from the provider's own documentation, with an `agreementReference` that names the contract.

## ONDC

**Verified**
- Buyer network participants can search across the network and receive sellers' catalogues, prices and availability for a location under the ONDC Retail specification. Participation needs registration, registry whitelisting and certification against the reference apps. Sources:
  - https://ondc.org/pages/buyer-network-participants.html
  - https://github.com/ONDC-Official
- This is a legitimate, protocol-sanctioned route to price and availability data, but only for **sellers that are on ONDC**.
- No source shows Blinkit, Zepto or Instamart listing their own catalogues on ONDC. A news report says they stayed away from it: https://inc42.com/features/ondc-grocery-delivery-can-it-outpace-blinkit-zepto-dunzo

**Unknown**
- Whether ONDC policy allows a buyer app to use catalogue data for comparison without transacting. The governance chapter at https://resources.ondc.org/governance-and-policies was not retrieved.

**Assessment.** ONDC could add many more local sellers to LocalStock's comparison through a future "ONDC" source. It does not give access to the four platforms above.
