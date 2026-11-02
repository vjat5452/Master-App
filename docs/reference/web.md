# Web app reference (`apps/web`)

This is a file-by-file reference for the LocalStock frontend. It is written for a developer who is new to the codebase. Read sections 1 and 2 first. They explain how the pieces fit together. Use section 3 as a lookup when you open a specific file.

The app is a single-page application (SPA). It uses:

- **React 18** for the UI.
- **Vite 5** as the dev server and bundler.
- **react-router-dom 6** for URLs and pages.
- **Tailwind CSS 3** for styling, with **shadcn/ui-style** primitives built on **Radix UI** (unstyled, accessible building blocks such as dialogs and menus).
- **MUI** (`@mui/material`, `@mui/x-charts`) for charts, a stepper and a slider. MUI is always lazy-loaded (see section 5).
- **framer-motion** for animation, **sonner** for toast notifications, **lucide-react** for icons.

For the system around it, see `README.md` and `docs/ARCHITECTURE.md`.

**Two terms used throughout:**

- A **hook** is a React function whose name starts with `use` (for example `useState`, or this app's `useAuth`). Hooks let a component keep state or read shared data. They can only be called at the top level of a component.
- A **context provider** is a component that makes a value available to every component below it in the tree, without passing props by hand. Components read the value with a hook (for example `useCart()`).

---

## 1. How the app works

### 1.1 Boot sequence

1. The browser loads `apps/web/index.html`. A small inline script there reads the saved theme from `localStorage` (key `localstock.theme`) and adds the `dark` class to `<html>` before anything paints. This prevents a light/dark flash.
2. `index.html` loads `/src/main.jsx` as an ES module.
3. `main.jsx` renders this tree into `<div id="root">`:

```text
<React.StrictMode>
  <ThemeProvider>                     lib/theme.jsx  light / dark / system
    <BrowserRouter>                   react-router
      <TooltipProvider>               Radix tooltips (200 ms delay)
        <AuthProvider>                lib/store.jsx  signed-in user
          <LocationProvider>          lib/store.jsx  delivery point
            <CartProvider>            lib/store.jsx  cart lines
              <App />                 App.jsx        layout + routes
    <ThemedToaster />                 sonner toasts, follows the theme
```

4. `App.jsx` renders the page frame (demo banner, top bar, `<Routes>`, footer, floating cart bar) and picks the page for the current URL.

The order of providers matters. `CartProvider` sits inside `AuthProvider`, so cart code could read the user if needed. `ThemedToaster` sits inside `ThemeProvider` so toasts match the theme.

### 1.2 Routes

All routes are declared in `apps/web/src/App.jsx`. There is no platform "seller" or "customer" role. Any signed-in user can be a customer. A user is a seller when they are a member of a company (`user.memberships`). Inside a company, the company role (`OWNER`, `ADMIN`, `STAFF`) decides what they can change. A platform admin has `user.platformRole === 'ADMIN'`.

| URL path | Page component | Who can see it | Notes |
|---|---|---|---|
| `/` | `pages/Shop.jsx` | Everyone (guest included) | Home page. An old-style `/?q=...` link redirects to `/search?q=...`. |
| `/search` | `pages/Browse.jsx` | Everyone | Search results. Query params: `q`, `category`, `sort`, `anywhere=1`. |
| `/c/:slug` | `pages/Browse.jsx` | Everyone | One category, by slug. |
| `/login` | `pages/Login.jsx` | Everyone | Sign in / register. Honours `?next=`. Footer is hidden on this page. |
| `/product/:variantId` | `pages/Product.jsx` | Everyone | Product detail. |
| `/cart` | `pages/Cart.jsx` | Everyone | Guests see the cart but must sign in to get a quote and check out. |
| `/orders` | `pages/Orders.jsx` (lazy) | Signed-in users | Wrapped in `RequireAuth`. |
| `/orders/:orderId` | `pages/OrderDetail.jsx` (lazy) | Signed-in users | Wrapped in `RequireAuth`. |
| `/seller` | `pages/Seller.jsx` (lazy) | Signed-in users | Company picker, or redirect to the only company. |
| `/seller/:companyId` | `pages/Seller.jsx` (lazy) | Signed-in members of that company | Not a member: redirects to `/seller`. Tabs via `?tab=`. |
| `/admin` | `pages/Admin.jsx` (lazy) | Platform admins | `RequireAuth admin`. Non-admins are sent to `/`. Tabs via `?tab=`. |
| `/account` | `pages/Account.jsx` (lazy) | Signed-in users | Profile, memberships, token session. |
| `/explorer` | `pages/Explorer.jsx` (lazy) | Everyone | API explorer. Signed-in users can call protected endpoints. |
| `*` | `<Navigate to="/">` | Everyone | Any unknown path goes home. |

`RequireAuth` (in `App.jsx`) shows a spinner while the user is loading, sends guests to `/login?next=<current path>`, and with the `admin` prop sends non-admins to `/`. This check is a convenience for the UI only. The API is what actually enforces permissions.

**Lazy loading** means the code for a page is downloaded only the first time someone visits it. `App.jsx` does this with `React.lazy(() => import('./pages/X.jsx'))`. The shopper pages (Shop, Browse, Login, Product, Cart) are imported normally, so they are in the main bundle. The back-office pages are lazy. A lazy page must be rendered inside `<Suspense>`; the `Contained` wrapper in `App.jsx` provides that.

### 1.3 Talking to the API (`lib/api.js`)

**Base URL.** All API calls go to the relative path `/api/v1` (constant `API_BASE`). There is **no** `VITE_` environment variable for the API URL. The browser always calls its own origin:

- **Development:** `vite.config.js` proxies `/api` and `/health` to `process.env.API_URL`, or `http://localhost:5000` if that is not set. `API_URL` is read by the Vite dev server (Node), not by the browser code. The comment explains why: the API has no CORS, so the browser must talk to the same origin.
- **Production (Vercel):** `apps/web/vercel.json` rewrites `/api/*` and `/health/*` to `https://localstock-api.onrender.com`, and every other path to `/index.html` (so client-side routes work on reload).

The only `VITE_` variable the code reads is `VITE_DEMO_NOTICE` (see `DemoNotice` in `App.jsx`).

**Health check.** Health endpoints live at the root (`/health/ready`), not under `/api/v1`. `App.jsx` calls `rawRequest('GET', '/health/ready', { auth: false })` directly.

**Token storage.** After login or register, the API returns `{ accessToken, refreshToken }`. `setTokens()` keeps them in a module variable and in `localStorage` under `localstock.tokens`. If storage is unavailable (for example in a locked-down browser), tokens live only in memory for that tab. Every request with `auth: true` (the default) adds `Authorization: Bearer <accessToken>`.

**Refresh.** When a request returns **401**, `rawRequest` calls `refreshTokens()` and retries the request once. It does not do this for URLs containing `/auth/`, or when `auth: false`. Refresh tokens rotate on every use, and reusing an old one revokes every session. So refreshing is **single-flight**: if several requests get 401 at the same time, they all wait on one shared `POST /auth/refresh`. If refresh fails, the code re-reads `localStorage`. If another tab already rotated the token and saved a new pair, that pair is adopted. Otherwise tokens are cleared, which signs the user out.

**Cross-tab sync.** `api.js` listens to the browser `storage` event. When another tab changes `localstock.tokens`, this tab reloads its tokens and notifies listeners (`onTokensChange`). `AuthProvider` uses that to clear the user when tokens disappear.

**Error handling.**

- `rawRequest(method, url, opts)` never throws on HTTP errors. It returns `{ status, ok, ms, headers, data }`. The API explorer and the health badge use it.
- `api(method, path, opts)` (and the shortcuts `get`, `post`, `patch`) prefix the path with `/api/v1` and **throw an `ApiError`** when the response is not 2xx. `ApiError` has `message`, `status`, `code` (default `HTTP_ERROR`), `details` (for example validation issues) and `requestId`, taken from the API's `{ error: {...} }` body.
- On success `api()` returns a shallow copy of the JSON body, with the response headers attached as a hidden (non-enumerable) `__headers` property. `Cart.jsx` uses `order.__headers['idempotent-replayed']`.
- Pages show errors with the `ErrorBox` component (`components/kit.jsx`), which knows how to print `code`, validation `details` and `requestId`.
- Network failures (the fetch itself rejecting) are normal JavaScript errors, not `ApiError`.

**Request bodies.** Objects are sent as JSON. A string body is sent as-is; pass your own `Content-Type` header (the CSV import does this with `text/csv`).

**Idempotency.** `newIdempotencyKey()` returns `web-<uuid>`. Checkout sends it as `Idempotency-Key` so a retried order is never created twice.

### 1.4 Live updates (SSE)

**SSE** (Server-Sent Events) is a simple way for a server to keep an HTTP response open and push text events down it. Browsers have a built-in `EventSource` class for this, but `EventSource` cannot send an `Authorization` header. So `lib/compare.js` (`useChangeStream`) reads the stream with `fetch` and parses the `id:` / `data:` lines by hand. It reconnects after 5 seconds when the connection drops and sends `Last-Event-ID` so the server can resume. It is only enabled for signed-in users, on the product page's comparison section.

### 1.5 Browser storage keys

| Key | Storage | Written by | Holds |
|---|---|---|---|
| `localstock.tokens` | localStorage | `lib/api.js` | Access and refresh token |
| `localstock.cart` | localStorage | `CartProvider` | Cart lines |
| `localstock.location` | localStorage | `LocationProvider` | Delivery point |
| `localstock.theme` | localStorage | `ThemeProvider`, read by `index.html` | `light`, `dark` or `system` |
| `localstock.checkoutKey` | localStorage | `pages/Cart.jsx` | Idempotency key for the current cart |
| `localstock.knownGroups` | localStorage | `lib/catalog.js` | Product groups created in this browser |
| `localstock.reviewQueue` | localStorage | `lib/catalog.js` | Variant ids proposed here that await review |
| `localstock.demoNoticeDismissed` | sessionStorage | `DemoNotice` in `App.jsx` | Demo banner hidden for this session |

Every read and write is wrapped in `try/catch`, so the app still works when storage is blocked.

---

## 2. State management and theming

The app has no Redux or similar library. Shared state lives in three React contexts in `lib/store.jsx` and one in `lib/theme.jsx`. Everything else is local component state (`useState`) plus data fetched per page with `useAsync`.

### 2.1 `lib/store.jsx`

| Context | Hook | Value | Persisted |
|---|---|---|---|
| Auth | `useAuth()` | `{ user, loading, reload, isAdmin, login, register, logout }` | Tokens only (via `api.js`) |
| Location | `useDeliveryLocation()` | `{ location, setLocation }` where `location = { label, lat, lng }` | `localstock.location` |
| Cart | `useCart()` | `{ items, count, add, setQuantity, clear }` | `localstock.cart` |

Plus two helper hooks that are not contexts: `useToast()` and `useAsync()`.

How components use them:

- **Auth.** `TopBar`, `RequireAuth`, `UserMenu`, `Login`, `Account`, `Cart`, `CompareSection`, `Members`, `Explorer` and `CreateCompany` call `useAuth()`. On start-up, if tokens exist, `AuthProvider` calls `GET /users/me` to load the user; `loading` is `true` until that finishes.
- **Location.** The header (`DeliveryEta`, `LocationModal`), `Shop`, `Browse`, `Product`, `Cart` and `Explorer` read it. Every catalog search, offer list, price history and quote is scoped to it. The default is the first of `PLACES` (India Gate).
- **Cart.** The cart is **client-side only**. It is a list of `{ variantId, name, brand, group, attributes, imageUrl, priceHintMinor, quantity }`. `priceHintMinor` is just the cheapest price seen at add time; the real price comes from the checkout quote. `AddButton`, `QtyStepper`, `CartButton`, `CartBar` and `Cart` use it.

### 2.2 `lib/theme.jsx`

`ThemeProvider` holds the chosen theme (`light`, `dark` or `system`) and the OS preference. It computes `resolved` (`light` or `dark`), toggles the `dark` class on `<html>`, and saves the choice to `localstock.theme`. `useTheme()` returns `{ theme, setTheme, resolved }`. It is used by `ThemeToggle` (header), `ThemedToaster` (`main.jsx`) and `MuiScope` (so charts follow the theme).

---

## 3. File-by-file reference

All paths are from the repo root. Imports starting with `@/` mean `apps/web/src/` (alias set in `vite.config.js`).

### 3.1 Config and entry files

#### `apps/web/package.json`

Package `@localstock/web`, ES modules. Scripts: `dev` (`vite`), `build` (`vite build`), `preview` (`vite preview`). There is no test or lint script. Dependencies are listed in the intro. `@radix-ui/react-popover` is installed but no component uses it yet.

#### `apps/web/vite.config.js`

- Plugin: `@vitejs/plugin-react`.
- Alias `@` → `./src`.
- Dev server on port **5173**, proxying `/api` and `/health` to `API_URL` (default `http://localhost:5000`) with `changeOrigin`.
- Build: `manualChunks` puts `@mui/material`, `@mui/x-charts`, `@emotion/react` and `@emotion/styled` into a separate `mui` chunk, so the first page load does not include MUI.

#### `apps/web/tailwind.config.js`

Class-based dark mode, content scan of `index.html` and `src/**/*.{js,jsx}`, centred container (padding `1.25rem`, max `1280px`), and the design tokens described in section 5. Plugin: `tailwindcss-animate` (provides `animate-in`, `fade-in-0`, `zoom-in-95` used by Radix popups).

#### `apps/web/postcss.config.js`

Runs `tailwindcss` then `autoprefixer`. Nothing else.

#### `apps/web/index.html`

Page title and description, `theme-color` `#0b5d45`, an inline SVG favicon, Google Fonts (Plus Jakarta Sans, Instrument Serif, JetBrains Mono), the pre-paint theme script, `<div id="root">`, and the module script `/src/main.jsx`.

#### `apps/web/vercel.json` (deployment, related)

Vercel build settings and the rewrites described in 1.3.

#### `apps/web/src/index.css` (related)

Tailwind layers. Defines the colour tokens as HSL CSS variables for `:root` (light) and `.dark`, base styles (`body` uses the background and font tokens), and helper classes: `.bg-aurora`, `.bg-grid`, `.glass`, `.text-gradient`, `.num` (tabular numbers), `.scrollbar-thin`, `.scrollbar-none`.

#### `apps/web/src/main.jsx`

Entry point. Builds the provider tree from 1.1 and imports `index.css`.

- `ThemedToaster()` (internal): renders sonner's `<Toaster>` at bottom-right with rich colours and a close button, using `useTheme().resolved` as its theme.

#### `apps/web/src/App.jsx`

The page frame and the router. Default export `App`.

| Name | Kind | What it does |
|---|---|---|
| `App()` | default export | Scrolls to top on every path change. Renders `DemoNotice`, `TopBar`, `<Routes>` (table in 1.2), `Footer` (not on `/login`) and `CartBar`. |
| `Contained({ children })` | internal | Wraps a page in `.container` padding and `<Suspense>` with a `Spinner` fallback. Used for every route except `/`, `/search`, `/c/:slug`, `/login` (those pages handle their own layout). |
| `DemoNotice()` | internal | Yellow "Demo environment" banner. Shown when `VITE_DEMO_NOTICE === 'on'`, or when it is not `'off'` and `import.meta.env.MODE !== 'production'`. Dismissal is saved in sessionStorage. |
| `CartBar()` | internal | Floating "View cart" bar (framer-motion spring) on shopper paths (`/`, `/search`, `/c/...`, `/product/...`) when the cart is not empty. Total uses `priceHintMinor`. |
| `RequireAuth({ children, admin })` | internal | Route guard, see 1.2. |
| `useNavItems()` | internal hook | Nav list: Shop; Orders and Seller hub when signed in; Admin when `isAdmin`; API (`/explorer`). |
| `TopBar()` | internal | Sticky header: `MobileNav`, `Logo`, `DeliveryEta`, `SearchBar`, `Health`, icon nav (wide screens), `ThemeToggle`, `UserMenu` or Login link, `CartButton`. |
| `CartButton()` | internal | Cart link showing item count and animated total (`NumberTicker`). |
| `useFastestEta(location)` | internal hook | Calls `searchCatalog({ limit: 30, location, sort: 'fastest' })` (**GET `/catalog/search`**) and returns the smallest `estimatedDeliveryMinutes`. Cached per lat/lng in a module `Map`. Returns `undefined` while loading and `null` when nothing delivers. |
| `DeliveryEta()` | internal | "Delivery in N minutes" plus the location label. Click opens `LocationModal`. |
| `SearchBar({ className })` | internal | Search form. Typing 2+ characters navigates to `/search?q=` after 350 ms (debounce). Shows a rotating placeholder (`RotatingText`) when empty. Uses `replace` navigation while already on `/search` so history is not flooded. |
| `Logo({ light })` | internal | Brand mark linking to `/`. |
| `MobileNav({ items })` | internal | Dropdown menu with the nav items, hidden on large screens. |
| `Health()` | internal | Polls **GET `/health/ready`** every 15 s with `rawRequest` (no auth). Shows a Live/Offline dot with Postgres/Redis latency in a tooltip. Links to `/explorer`. |
| `ThemeToggle()` | internal | Light/Dark/System radio menu bound to `useTheme`. |
| `LocationModal({ onClose })` | internal | Choose one of `PLACES`, use browser geolocation, or type lat/lng. Calls `setLocation` and shows a toast. |
| `UserMenu()` | internal | Avatar menu: name, email, admin badge, links to Account, Orders, Seller hub, and Sign out (`logout()`, toast, go to `/`). |
| `Footer()` | internal | Static link columns and attribution (product images from Open Food Facts, CC BY-SA). |

### 3.2 `lib/`

#### `apps/web/src/lib/api.js`

HTTP client. Behaviour is described in 1.3.

| Export | Signature | Notes |
|---|---|---|
| `API_BASE` | `'/api/v1'` | Used by `compare.js` and `Explorer.jsx` too. |
| `ApiError` | `class extends Error`; `new ApiError(status, error)` | Fields `status`, `code`, `details`, `requestId`. |
| `getTokens()` | `() => { accessToken, refreshToken } \| null` | |
| `onTokensChange(fn)` | returns an unsubscribe function | Fires on `setTokens` and on cross-tab changes. |
| `setTokens(next)` | `next` is a token pair or `null` | Saves to memory and localStorage, notifies listeners. |
| `rawRequest(method, url, opts)` | `opts: { body, headers, auth = true }` | Full URL (no prefix). Never throws on HTTP errors. Retries once after refresh on 401. |
| `api(method, path, opts)` | path without `/api/v1` | Throws `ApiError` on non-2xx. |
| `get(path, opts)`, `post(path, body, opts)`, `patch(path, body, opts)` | shortcuts for `api` | There is no `put` or `del` helper. |
| `qs(params)` | object → `'?a=1&b=2'` or `''` | Skips `undefined`, `null` and `''`. |
| `newIdempotencyKey()` | `() => 'web-<uuid>'` | Uses `crypto.randomUUID()`. |

Internal helpers: `readTokens()`, `refreshTokens()` (single-flight **POST `/auth/refresh`**), `send()` (the actual `fetch`, measures `ms`, parses JSON or keeps text).

#### `apps/web/src/lib/store.jsx`

Shared state (section 2.1).

| Export | Signature | What it does |
|---|---|---|
| `AuthProvider({ children })` | provider | Loads the user with **GET `/users/me`** when tokens exist. `login(email, password)` → **POST `/auth/login`** (no auth), saves tokens, reloads user, returns it. `register(name, email, password)` → **POST `/auth/register`**, same. `logout()` → **POST `/auth/logout`** with the refresh token (errors ignored), then clears tokens. `reload()` re-fetches `/users/me`. `isAdmin` is `user.platformRole === 'ADMIN'`. |
| `useAuth()` | hook | Reads the auth context. |
| `PLACES` | array of `{ label, lat, lng }` | Five demo delivery points in Delhi and Noida. Also used by `LocationModal` and the warehouse form's "Quick fill". |
| `LocationProvider({ children })` | provider | `location` persisted under `localstock.location`, default `PLACES[0]`. |
| `useDeliveryLocation()` | hook | `{ location, setLocation }`. |
| `CartProvider({ children })` | provider | `items` persisted under `localstock.cart`. `add(product, quantity = 1)` merges by `variantId`. `setQuantity(variantId, q)` removes the line when `q <= 0`. Quantities are capped at 100. `clear()` empties it. `count` is the sum of quantities. |
| `useCart()` | hook | Reads the cart context. |
| `useToast()` | hook → `(message, kind = 'good') => void` | `kind` is `good`, `bad`, `warn` or `info` (maps to sonner `success`, `error`, `warning`, `info`). |
| `useAsync(loader, deps)` | hook → `{ data, error, loading, reload, setData }` | Runs `loader()` on mount and whenever `deps` change. A sequence counter ignores results from older runs (so a slow old request never overwrites a newer one). Keeps the previous `data` while reloading. `setData` replaces data locally without fetching. This is the standard way pages load data. |

Internal helper: `usePersisted(key, initial)`, a `useState` that is mirrored to localStorage.

#### `apps/web/src/lib/theme.jsx`

| Export | What it does |
|---|---|
| `ThemeProvider({ children })` | Holds `theme`, follows OS dark-mode changes through `matchMedia`, toggles the `dark` class, saves to `localstock.theme`. |
| `useTheme()` | `{ theme, setTheme, resolved }`. |

#### `apps/web/src/lib/utils.js`

| Export | What it does |
|---|---|
| `cn(...inputs)` | Joins class names with `clsx` (accepts strings, arrays, `{ cls: condition }` objects, falsy values) and then resolves Tailwind conflicts with `tailwind-merge`, so `cn('p-4', 'p-2')` gives `'p-2'`. Used by almost every component. |

#### `apps/web/src/lib/format.js`

Display helpers. **Money is always in minor units (paise)** in the API and in this app; format it, never divide by hand.

| Export | Signature | Output |
|---|---|---|
| `money(minor)` / `price(minor)` | number → string | INR, e.g. `₹54` or `₹54.50`; `'—'` for null. `price` is an alias. |
| `toMinor(rupees)` | string or number → integer | `Math.round(Number(rupees) * 100)`. Used by forms. |
| `distance(m)` | metres → `'850 m'` or `'2.3 km'` | |
| `minutes(n)` | → `'12 min'` or `'1 h 5 min'` | |
| `dateTime(iso)` | → `en-IN` medium date, short time | |
| `ago(iso, now?)` | → `'just now'`, `'4 min ago'`, `'2 h ago'`, `'3 d ago'` | |
| `attrs(a)` | `{ weight: '400 g' }` → `['weight: 400 g']` | |
| `shortId(id)` | first 8 characters | Currently unused. |
| `title(s)` | `'PENDING_PAYMENT'` → `'Pending payment'` | |
| `tone(status)` | status → `good`, `info`, `warn`, `muted` or `bad` | Picks a badge colour; unknown statuses are `info`. |

#### `apps/web/src/lib/categories.js`

| Export | Signature | What it does |
|---|---|---|
| `CATEGORY_STYLE` | `{ [slug]: { short, tint } }` | Storefront short name and gradient classes per known category slug. |
| `styleFor(slug)` | → style or a neutral tint | |
| `loadCategories()` | → `Promise<category[]>` | **GET `/catalog/categories`** (no auth). Keeps only leaf categories (those with no children), sorted in `CATEGORY_STYLE` order then by name. Memoised for the session; the cache is cleared on error so a retry works. |
| `searchCatalog({ q, category, sort, radiusKm = 20, page = 1, limit = 20, location, anywhere })` | → search page | **GET `/catalog/search`** (no auth). Adds `lat`/`lng` from `location` unless `anywhere` is true or no location is given. |

Used by `App.jsx` (`useFastestEta`), `Shop`, `Browse`, `Product`.

#### `apps/web/src/lib/catalog.js`

Helpers for seller and admin catalog screens.

| Export | What it does |
|---|---|
| `rememberGroup(group)` | Saves `{ id, name, categoryId }` to `localstock.knownGroups`. The API has no "list groups" endpoint, so groups created in this browser are remembered here. Called after creating a group in `Admin.jsx`. |
| `loadKnownGroups()` | Pages through **GET `/catalog/search?q=&page=N&limit=50`** (up to 5 pages), takes one variant per group, calls **GET `/catalog/variants/:id`** to learn each `groupId`/`groupName`, merges with remembered groups, sorts by name. Used by `ProposeVariantModal`, `CatalogAdmin`, `ClassifyModal`. |
| `reviewQueue()` / `setReviewQueue(ids)` | Read/write `localstock.reviewQueue` (variant ids proposed from this browser that need review). |
| `searchVariants(q)` | **GET `/catalog/search?q=&limit=20`** (no auth), dropping items with `origin === 'EXTERNAL'` (products found only on other platforms). Used by `VariantPicker` and admin `Moderation`. |

#### `apps/web/src/lib/compare.js`

Cross-platform comparison and the live change stream.

| Export | What it does |
|---|---|
| `RANKING_POLICIES` | `best_value`, `lowest_price`, `fastest`, `nearest` with labels. |
| `compareOffers({ query, location, rankingPolicy = 'best_value', refreshPolicy = 'prefer_fresh', radiusKm = 20 })` | **POST `/discovery/compare`** (no auth) with `{ query, location: { latitude, longitude }, radiusKm, rankingPolicy, refreshPolicy, limit: 20 }`. |
| `useChangeStream({ enabled, variantIds = [], cell, onEvent })` | Hook. Opens **GET `/discovery/stream?variantIds=...&cell=...`** with `fetch` and the bearer token (see 1.4). Calls `onEvent(parsedJson)` per event. Returns `'off'`, `'connecting'` or `'live'`. A 401 or 403 turns it `'off'`; other failures retry after 5 s. Aborts on unmount or when the inputs change. |

Used by `components/compare.jsx`.

#### `apps/web/src/lib/razorpay.js`

| Export | What it does |
|---|---|
| `payWithRazorpay(order, { onAttemptFailed })` | Loads `https://checkout.razorpay.com/v1/checkout.js` once (internal `loadCheckout()`, retried if it failed) and at the same time calls **POST `/orders/:id/payment/razorpay`** to get `{ keyId, razorpayOrderId, amountMinor, currency, timeoutSeconds }`. Opens the Razorpay window. When the shopper pays, it calls **POST `/orders/:id/payment/razorpay/verify`** with the three signed ids and resolves with the server's answer (has an `outcome`). If the window is closed, resolves `{ outcome: 'DISMISSED' }`. A failed attempt calls `onAttemptFailed(message)` but does not end the flow, because Razorpay lets the shopper retry in the same window. |

Used by `OrderDetail.jsx`.

### 3.3 `components/` (app components)

#### `apps/web/src/components/kit.jsx`

The app's own component kit, built on the `ui/` primitives. Pages import from here first.

| Export | Props / signature | What it renders or does |
|---|---|---|
| `Button` | `variant = 'primary'`, `size`, `busy`, `block`, `asChild`, plus button props; forwards `ref` | Wraps `ui/button`. Maps variant names: `primary`→`default`, **`secondary`→`outline`**, `ghost`, `danger`→`destructive`, `gold`, `link`, `soft`→`secondary`, `glass`. `busy` shows a spinner and disables. `block` makes it full width. With `asChild` it renders its single child (for example a `<Link>`) styled as a button, and no spinner. |
| `Badge` | `status`, `kind`, `children`, `dot`, `className` | Pill. Colour is `kind`, or `tone(status)`. Text defaults to `title(status)`. |
| `Panel` | `title`, `description`, `icon`, `actions`, `children`, `pad = true`, `className`, `bodyClassName` | Card with an optional header row (icon, title, description, actions). Most dashboard sections use it. |
| `PageHeader` | `eyebrow`, `title`, `description`, `actions` | Big page title block. |
| `Field` | `label`, `hint`, `children` | `<label>` wrapping a form control with a label and hint. |
| `Spinner` | `label = 'Loading…'`, `className` | Centred spinner. |
| `SkeletonRows` | `rows = 4` | Grey loading bars. |
| `Empty` | `icon`, `title`, `children`, `action` | Empty-state block. |
| `Alert` | `tone = 'info'` (`good`, `warn`, `bad`, `info`), `title`, `children` | Coloured message box with `role="alert"`. |
| `ErrorBox` | `error`, `onRetry` | Renders nothing when `error` is falsy. Shows message, `code`, validation issues (`details` as `[{ path, message }]`) or raw `details` as JSON, HTTP status, request id, and a "Try again" button when `onRetry` is given. |
| `Json` | `value`, `small` | Dark, scrollable pretty-printed JSON. |
| `Tabs` | `tabs: [{ id, label, icon?, count? }]`, `value`, `onChange` | Controlled tab strip only (no panels). Pages render the active section themselves. |
| `Segmented` | `value`, `onChange`, `options: [{ id, label, icon? }]` | Single-choice toggle group that never becomes empty. |
| `Modal` | `title`, `description`, `onClose`, `children`, `footer`, `className` | Always-open Radix dialog. Mount it conditionally (`{open && <Modal ... />}`); closing calls `onClose`. If there is no `description`, a screen-reader-only one is added for accessibility. |
| `Stat` | `label`, `value`, `sub`, `icon`, `tone` (`emerald`, `gold`, `blue`, `rose`), `index` | Animated KPI card. `index` staggers the entrance. |
| `Stepper` | `value`, `onChange`, `min = 0`, `max = 100`, `size` | Minus/plus number stepper. Currently unused (cart uses `QtyStepper`). |
| `CopyId` | `id` | Shows the first 8 characters; click copies the full id. |
| `KV` | `rows: [[key, value, strong?], ...]` | Key/value list; `strong` adds a total-style row. Falsy rows are skipped. |
| `useSubmit(fn)` | hook → `{ run, busy, error, setError }` | Wraps an async action. `run(...args)` sets `busy`, catches errors into `error` (it never throws), and returns `fn`'s result or `undefined`. Standard way to handle form submits and buttons. |
| `Reveal` | `children`, `delay`, `className` | Fade-and-rise on mount. |

#### `apps/web/src/components/fx.jsx`

Visual effects adapted from Magic UI, React Bits and Aceternity UI (MIT). Pure presentation; no API calls.

| Export | Props | What it does | Used in |
|---|---|---|---|
| `Marquee` | `children`, `repeat = 4`, `duration = 40`, `pauseOnHover`, `reverse` | Endless horizontal scroll (copies children `repeat` times). | Shop brand strip |
| `NumberTicker` | `value`, `format`, `className` | Number that springs to its new value (writes `textContent` directly for smoothness). | Cart button, cart bar, Shop hero |
| `BorderBeam` | `size`, `duration`, `delay`, `from`, `to` | Light travelling around a rounded border. Parent must be `relative` and rounded. | Shop hero, seller CTA |
| `ShimmerButton` | `background`, `as = 'button'`, plus props; forwards `ref` | Pill button with a moving shine. `as={Link}` makes it a link. | Shop |
| `BlurFade` | `delay`, `y`, `as = 'div'` | Fades in from blur when scrolled into view (once). | Shop, Browse, Product |
| `RotatingText` | `words`, `interval = 2200` | Cycles through words with a slide animation. | Search placeholder |
| `ShinyText` | `children` | Text with a moving highlight. | Shop hero |
| `SpotlightCard` | `color`, plus div props | Radial glow that follows the mouse. | Shop promo cards |

#### `apps/web/src/components/product.jsx`

Product display pieces shared by shop pages.

| Export | Props / signature | What it does | Used in |
|---|---|---|---|
| `artFor(...names)` | names → `[regex, Icon, gradient]` | Picks an icon and gradient by matching words like "milk" or "bread". Fallback is a package icon. | `ProductArt` |
| `ProductArt` | `names`, `src`, `size` (`sm`, `md`, `lg`, `tile`, `square`), `label`, `className` | Product image (lazy-loaded `<img>`). If there is no `src` or it fails to load, shows the category icon art instead. | Many pages |
| `primaryAttr(attributes)` | → first attribute value | e.g. the pack size. | QuickCard, Product, Cart |
| `Attrs` | `attributes`, `className` | Attribute chips. | Admin, VariantPicker |
| `OfferLine` | `offer`, `best` | One seller offer row. Currently unused. | — |
| `summarize(item)` | search item → `{ from, stock, eta }` | Cheapest price, total units, fastest ETA across `item.offers`. | `AddButton`, `QuickCard` |
| `AddButton` | `item`, `size = 'sm'` or `'lg'` | "Add" button that turns into a `QtyStepper` once the item is in the cart. Adds `{ variantId, name, brand, group, attributes, imageUrl, priceHintMinor: from }`. Disabled when there are no offers. Max quantity is the nearby stock, capped 1–100. | QuickCard, Product |
| `QtyStepper` | `value`, `onChange`, `max = 100`, `big` | Green minus/plus control. Going below 1 calls `onChange(0)`, which the cart treats as "remove". | AddButton, Cart |
| `QuickCard` | `item`, `className` | Product tile: image, seller count, ETA chip, name, pack, price, Add. Items with `origin === 'EXTERNAL'` show "Found on other apps" and a "Compare" link instead of Add. | Shop, Browse, Product (similar shelf) |
| `QuickCardSkeleton` | — | Loading placeholder for a tile. | Shop, Browse |
| `ProductTitle` | `variantId`, `brand`, `name`, `group` | Brand/name/group block. Currently unused. | — |

#### `apps/web/src/components/compare.jsx`

The "Compare across platforms" panel on the product page. Every uncertain fact (demo data, unknown distance, partial totals, unconfirmed matches, stale prices) is labelled, as the file's top comment says.

- **`CompareSection({ variant, location, query })`** (export). Local state: ranking `policy`, `refresh` policy (`prefer_fresh` until the user clicks Refresh, then `refresh_supported`), `showAll`, `lastLive`.
  - Loads `compareOffers(...)` (**POST `/discovery/compare`**) with `useAsync`.
  - For signed-in users, opens `useChangeStream` (**GET `/discovery/stream`**) for this variant and the returned `location.cell`. Each event schedules a reload 800 ms later (debounced) and updates the "Live" pill.
  - Shows results that are either external platform listings or LocalStock listings for this exact variant. Shows 6, then "Show all".
  - Footer: notices from the API, a status chip per source, and an explanation of the ranking order. Guests get a "Sign in for live updates" link.
- Internal: `Freshness({ r })` (demo, live stock, or "Updated / May be out of date / Old data"), `PriceBlock({ r })` (price, MRP discount, total or "fees unknown"), `ResultRow({ r })` (one listing with source, size match, match status, ETA, distance, availability, reason chips, deep link). Lookup tables `POSITIVE_REASONS`, `SOURCE_STATUS`, `AVAILABILITY`, and `discount(p)`.

#### `apps/web/src/components/price-history.jsx`

| Export | Props | What it does |
|---|---|---|
| `PriceHistory` | `variantId`, `location` | Range buttons 7/30/90 days. **GET `/catalog/variants/:id/price-history?days=&lat=&lng=`** (no auth). Draws a step line per source with `PriceLines` (lazy MUI). Shows lowest and highest with date and source, a demo warning when any series is demo data, and the API's `notes`. |
| `PlatformLinks` | `variantId`, `className` | "Check on other apps" dropdown. **GET `/catalog/variants/:id/platform-links`** (no auth). Each link opens in a new tab; `kind === 'LISTING'` links get a "Listing" badge, others are searches. |

Both are used in `pages/Product.jsx`.

#### `apps/web/src/components/VariantPicker.jsx`

| Export | Props | What it does |
|---|---|---|
| `VariantPicker` | `value`, `onChange` | Search box (250 ms debounce) over `searchVariants` (**GET `/catalog/search`**). Click a row to select it; with a `value` it shows the chosen product and an X to clear. Includes a "Propose a new product variant" link that opens `ProposeVariantModal`; if the proposal is `ACTIVE`, it is selected. Used by `seller/Offers.jsx` (`CreateOffer`) and `admin/MappingReview.jsx` (`ManualLinkModal`). |
| `ProposeVariantModal` | `onClose`, `onDone(variant)` | Form: group (from `loadKnownGroups`), brand, name, barcode (8–14 digits), key/value attributes. Submits **POST `/catalog/variants`**. The API's matching rules decide if this is an existing product (shows how it matched), a new active one, or `PENDING_REVIEW` (then its id is added to the local review queue). Lists possible duplicates with a similarity score. Used by `VariantPicker` and `Admin.jsx` (`CatalogAdmin`). |

### 3.4 `components/mui/`

MUI is heavy, so it is kept out of the first download. The rule: **pages import from `components/mui/lazy.jsx` only.**

#### `apps/web/src/components/mui/lazy.jsx`

Each export is a `React.lazy` version of a widget from `widgets.jsx`, wrapped in `<Suspense>` with a `Skeleton` of the right height as the placeholder.

| Export | Placeholder height | Used in |
|---|---|---|
| `StackedBars` | 260 | Seller overview |
| `Donut` | 230 | Orders, Seller overview |
| `AreaLine` | 220 | Orders |
| `PriceLines` | 240 | `PriceHistory` |
| `ProgressStepper` | 72 | OrderDetail |
| `RangeSlider` | 40 | Not used yet |

#### `apps/web/src/components/mui/MuiScope.jsx`

Only imported by lazily loaded modules.

- `CHART_COLORS`: emerald, amber, indigo, teal, pink, lime. Neighbouring series must look different at a glance.
- `MuiScope({ children })`: creates an MUI theme from `useTheme().resolved` (brand colours, 12 px radius, Plus Jakarta Sans) and wraps children in `StyledEngineProvider injectFirst` (MUI CSS goes first, so Tailwind classes can override it) and MUI's `ThemeProvider`.

#### `apps/web/src/components/mui/widgets.jsx`

Each widget wraps itself in `MuiScope`.

| Export | Props | Renders |
|---|---|---|
| `StackedBars` | `categories`, `series: [{ label, data }]`, `height = 260` | Stacked `BarChart`. |
| `Donut` | `data: [{ label, value }]`, `height = 230`, `centerLabel` | `PieChart` ring with the total in the middle. No padding gaps when any slice is zero. |
| `AreaLine` | `labels`, `values`, `label`, `height = 220`, `format` | Single-series area `LineChart`, legend hidden. |
| `PriceLines` | `dates`, `series: [{ label, values }]`, `height = 240`, `format` | Step `LineChart`. `null` values stay as gaps (never joined). Marks only where the price changes. |
| `ProgressStepper` | `steps: [{ label, caption?, done?, error? }]`, `active` | MUI `Stepper` with labels under the icons. |
| `RangeSlider` | `value`, `onChange`, `onCommit`, `min`, `max`, `step`, `marks`, `format` | MUI `Slider`. `onChange` fires while dragging; `onCommit` once released (use that one to fetch). |

### 3.5 `components/ui/` (primitives)

These are shadcn/ui-style wrappers: thin components that add Tailwind classes to Radix primitives or plain HTML. Most forward `ref` and accept `className`, which is merged with `cn()`. Prefer the `kit.jsx` versions of `Button` and `Badge` in pages.

| File | Exports | Built on | Variants / notes |
|---|---|---|---|
| `button.jsx` | `Button`, `buttonVariants` | `@radix-ui/react-slot` (for `asChild`), `cva` | variant: `default`, `gold`, `destructive`, `outline`, `secondary`, `ghost`, `link`, `glass`. size: `default`, `sm`, `lg`, `icon`, `icon-sm`. |
| `badge.jsx` | `Badge`, `badgeVariants` | `<span>`, `cva` | variant: `default`, `good`, `warn`, `bad`, `info`, `muted`, `gold`, `outline`. |
| `card.jsx` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | `<div>`, `<h3>`, `<p>` | Only `Card` is used in pages. |
| `input.jsx` | `Input`, `Textarea`, `NativeSelect` | native `<input>`, `<textarea>`, `<select>` | `NativeSelect` is a styled native select, used where long lists must stay keyboard-searchable. |
| `label.jsx` | `Label` | `@radix-ui/react-label` | Used by `kit` `Field`. |
| `dialog.jsx` | `Dialog`, `DialogTrigger`, `DialogClose`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription` | `@radix-ui/react-dialog` | `DialogContent` includes a portal, blurred overlay and close X. Used through `kit` `Modal`. |
| `dropdown-menu.jsx` | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuGroup`, `DropdownMenuRadioGroup`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuRadioItem`, `DropdownMenuLabel`, `DropdownMenuSeparator` | `@radix-ui/react-dropdown-menu` | Used in `App.jsx` menus and `PlatformLinks`. |
| `select.jsx` | `Select`, `SelectValue`, `SelectGroup`, `SelectTrigger`, `SelectContent`, `SelectItem` | `@radix-ui/react-select` | Popper positioning by default. Used for the company switcher and inventory warehouse filter. |
| `tabs.jsx` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `@radix-ui/react-tabs` | Used through `kit` `Tabs` (no `TabsContent`). |
| `tooltip.jsx` | `TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipContent` | `@radix-ui/react-tooltip` | Provider is mounted once in `main.jsx`. |
| `table.jsx` | `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | native table elements | `Table` wraps the table in a horizontally scrollable div. |
| `misc.jsx` | `Switch`, `Checkbox`, `Separator`, `Avatar`, `AvatarFallback`, `Skeleton`, `ToggleGroup`, `ToggleGroupItem`, `ScrollArea` | `@radix-ui/react-switch`, `-checkbox`, `-separator`, `-avatar`, `-toggle-group`, `-scroll-area`; `Skeleton` is a plain div | `ScrollArea` is currently unused. |

### 3.6 `pages/` (shopper and account)

#### `apps/web/src/pages/Shop.jsx`

Home page (`/`).

- **`Shop()`** (default). Uses `useShelves(location)` (internal hook built on `useAsync`) which calls `loadCategories()` and then, in parallel, `searchCatalog` (all **GET `/catalog/search`**): one call with `limit: 1` for the product total, one per entry in `HERO_QUERIES` for hero images, and one per category with `limit: 14`. Empty categories are dropped. Derives sellers count, fastest ETA and brand list from the shelf items. Renders hero, 3 promo cards, category tiles, brand marquee, one `Shelf` per category, feature list and seller call-to-action. Redirects `/?q=` to `/search`.
- **`SORTS`** (export): `best_value`, `lowest_price`, `fastest`, `nearest`. Also used by `Browse` and `Product`.
- **`Shelf({ shelf })`** (export): horizontal, scroll-snapping row of `QuickCard`s with arrow buttons and "See all N" links to `/c/:slug`. `shelf` is `{ name, slug, total, items }`. Also used by `Product` for "Similar products".
- Internal: `SectionTitle`, `Hero`, `HeroStat`, `PromoCard`, `CategoryTile`, `ArrowButton`, `SellerCta`; constants `FEATURES`, `PROMOS`, `HERO_QUERIES`.

#### `apps/web/src/pages/Browse.jsx`

Search results (`/search`) and category listing (`/c/:slug`).

- **`Browse()`** (default). Reads `slug` from the route and `q`, `category`, `sort`, `anywhere` from the query string. All filters live in the URL, so results can be bookmarked; the internal `set(patch)` helper updates the URL with `replace`. Loads `loadCategories()` for the sidebar. Results come from `searchCatalog` (**GET `/catalog/search`**, 30 per page). Local state `{ key, items, total, page, loading, error }`, where `key` is a JSON string of every input; a change of `key` resets to page 1, and "Show more" appends the next page. A sequence ref drops stale responses. The "Any location" switch sets `anywhere=1` (no lat/lng filter).
- Internal: `SideLink({ to, active, label, tint })`: sidebar link that scrolls itself into view when active (for the horizontal mobile row).

#### `apps/web/src/pages/Login.jsx`

- **`Login()`** (default). Tabs switch between sign in and register. Calls `useAuth().login` or `register` through `useSubmit`, toasts "Welcome", and navigates to `?next=` or `/`. Register requires a password of at least 10 characters (browser validation). Four demo accounts (customer, two sellers, admin) sign in with `DEMO_PASSWORD` (`localstock-dev-password`) and land on their natural page; they are created by `npm run db:seed`.
- Constants: `DEMO_USERS`, `POINTS`.

#### `apps/web/src/pages/Product.jsx`

Product detail (`/product/:variantId`).

- **`Product()`** (default). Data:
  - **GET `/catalog/variants/:variantId`** (no auth), then **GET `/catalog/groups/:groupId`** if the variant has a group (failure ignored).
  - **GET `/catalog/variants/:variantId/offers?lat=&lng=&radiusKm=&sort=`** (no auth), reloaded when sort or radius (5/10/20/30/50 km) changes.
  - `loadCategories()` to find the category for the breadcrumb, then `searchCatalog` in that category (`limit: 16`) for "Similar products".
- Renders image, breadcrumb, ETA chip, price summary with `AddButton` (`size="lg"`) and `PlatformLinks`, the nearby sellers list (first row marked best when there is more than one), `CompareSection`, `PriceHistory`, promises, product details and the variant id.
- For `origin === 'EXTERNAL'` (found only on other platforms) it hides price, Add and sellers, and shows an explanation plus `PlatformLinks`. The shopper never picks a seller: checkout plans that.

#### `apps/web/src/pages/Cart.jsx`

Cart and checkout (`/cart`).

- **`Cart()`** (default). Local state: `prefs` (`{ sort, allowSplit, preferSingleWarehouse }`) and `quote`.
  - Builds `body = { location, items: [{ variantId, quantity }], preferences }`.
  - **Quote:** for signed-in users, 400 ms after the cart or preferences change, **POST `/checkout/quote`**. Responses for an older cart are ignored (`latest` ref). A quote reserves nothing.
  - **Idempotency key:** one key per distinct cart body, stored in `localstock.checkoutKey`, so reloading after a lost response still sends the same key.
  - **Place order:** **POST `/orders`** with header `Idempotency-Key`. If the response header `idempotent-replayed` is `true`, the toast says the cart was already ordered. Clears the key and the cart, then navigates to `/orders/:id`.
  - Guests see "Sign in to check out" linking to `/login?next=/cart`. The bill uses the quote when `status === 'OK'`, otherwise the `priceHintMinor` estimate.
- Internal: `readCheckoutKey()`, `writeCheckoutKey(value)`, `BillRow`, `PrefRow` (switch row), `QuoteResult({ quote, names })` (shortage warning, or the chosen plan and alternatives with shipments, couriers, fees and lines). Constants `STRATEGY`, `PROVIDER`, `OPTIMISE`.

#### `apps/web/src/pages/Orders.jsx`

My orders (`/orders`, signed in).

- **`Orders()`** (default). **GET `/orders`**. Shows stats (count, awaiting payment, confirmed spend), a daily confirmed-spend `AreaLine`, a `Donut` by status, and a clickable table linking to `/orders/:id`.
- Internal: `dayKey(iso)`, `dayLabel(key)`.

#### `apps/web/src/pages/OrderDetail.jsx`

One order (`/orders/:orderId`, signed in).

- **`OrderDetail()`** (default). **GET `/orders/:orderId`**. Shows a `ProgressStepper`, item table, shipments, and a payment card with subtotal, delivery and total.
  - While `PENDING_PAYMENT`, a countdown to `reservationExpiresAt` shows how long stock is held.
  - When `order.payment.provider === 'razorpay'`: "Pay" runs `payWithRazorpay`. If the outcome is `PROCESSING`, it re-fetches the order up to 5 times, 3 s apart, until it leaves `PENDING_PAYMENT`.
  - Otherwise (sandbox): "Pay" and "Simulate failure" call **POST `/payments/sandbox/:providerPaymentId/simulate`** with `{ status: 'SUCCEEDED' | 'FAILED' }`, then reload. The returned event is shown as JSON under "Last sandbox webhook".
  - "Cancel" calls **POST `/orders/:orderId/cancel`**.
- Internal: `useCountdown(iso)` (returns `'m:ss'`, `'expired'` or `null`), `progress(order)` (builds the stepper steps), `OUTCOME` (outcome → toast text and kind).

#### `apps/web/src/pages/Account.jsx`

Account (`/account`, signed in).

- **`Account()`** (default). Shows profile, company memberships (links to `/seller/:companyId`), and the session: decodes the access token's JWT payload in the browser (internal `decode(jwt)`) to show time left, expiry and issuer, ticking every second. Subscribes to `onTokensChange` so it updates after automatic refreshes. "Rotate tokens now" calls **POST `/auth/refresh`** directly and reloads the user. "Sign out" calls `logout()`.

#### `apps/web/src/pages/Explorer.jsx`

API explorer (`/explorer`, public).

- **`Explorer()`** (default). Left: a filterable list of endpoints from `ENDPOINTS`. Right: editable path, query string and JSON body, optional `Idempotency-Key`, optional webhook secret, and a checkbox to send the bearer token. "Send request" uses `rawRequest` and shows status, time, headers and body. Requests go through the same origin, so the dev proxy or Vercel rewrite applies.
- `ENDPOINTS`: `{ g: group, m: method, p: path, auth, d: description, body?, query?, idem?, webhook?, root? }`. `auth` is `none`, `user`, `company`, `company-manager` or `admin`. The comment says "every route the API exposes", but some newer routes used elsewhere in the app are not listed (for example `/discovery/compare`, price history, platform links, `/admin/...` external sources, mapping review and variant review queue, catalogue imports, `PATCH /catalog/variants/:id`). Check `docs/openapi.yaml` for the full list.
- `discoverIds(user, location)` (internal): fills placeholders with real ids. **GET `/catalog/search?limit=5`**, **GET `/catalog/variants/:id`**; when signed in **GET `/orders`** and **GET `/orders/:id`**; for the first company **GET `/companies/:id/warehouses`** and **GET `/companies/:id/offers`**.
- `fill(str, ids)` replaces `:name` placeholders; `fillBody(body, ids)` does the same in JSON (`:lat`/`:lng` become numbers).
- `hmacHex(secret, message)`: signs the sandbox webhook body with HMAC-SHA256 in the browser (Web Crypto) and sends it as `X-Sandbox-Signature`. The secret is typed by the developer and never stored.
- `SmokeTest({ ids, discovering, user })` (internal): calls every GET endpoint in order and shows status, time and a short summary; skips ones that need a missing id or sign-in.
- `Method({ m })` (internal): coloured method label.

### 3.7 `pages/` (admin)

#### `apps/web/src/pages/Admin.jsx`

Admin console (`/admin`, platform admins). Tabs in `?tab=`: `catalog` (default), `moderation`, `sources`, `matching`, `delivery`.

- **`Admin()`** (default): header plus `kit` `Tabs`; renders the active section.
- **`CatalogAdmin()`**: category tree from **GET `/catalog/categories`**; "New category" form → **POST `/catalog/categories`** (slug auto-filled from the name until edited). Product groups from `loadKnownGroups()`; click a group or paste an id to view it with **GET `/catalog/groups/:id`**; "Add a variant" opens `ProposeVariantModal`. "New group" form → **POST `/catalog/groups`**, then `rememberGroup`.
- **`Moderation()`**: review queue from **GET `/admin/catalog/variants/review-queue?limit=50`**; look up by id with **GET `/catalog/variants/:id`**; active catalog from `searchVariants('')`. Approve or Archive → **PATCH `/catalog/variants/:id/status`** `{ status }`. External products without a group must be classified first.
- **`ClassifyModal({ variant, onClose, onDone })`**: set group, brand, name, barcode → **PATCH `/catalog/variants/:id`**; "Save and approve" also sends **PATCH `/catalog/variants/:id/status`** `{ status: 'ACTIVE' }`.
- **`PlatformDelivery()`**: **GET `/delivery/providers`** shown with `ProviderTable`; "Add courier" opens `ProviderModal` (with type) → **POST `/admin/delivery-providers`**.

#### `apps/web/src/pages/admin/Sources.jsx`

"External sources" tab. The top comment states the rule: `ACTIVE` is a recorded human decision with evidence; the page never infers it.

- **`Sources()`** (default): **GET `/admin/external-platforms`**. Summary cards (platforms, sources configured, listings awaiting review), then each platform with its sources. Demo platforms are marked. "Access research" links to a doc on GitHub (`GITHUB_DOCS`, branch `feature/unified-external-platform-discovery`).
- `Summary` (internal): small stat card.
- `SourceRow({ s, onRuns, onStatus })`: access type, integration status, health, last success, error rate, latency, runs in 24 h. "Test" → **POST `/admin/external-sources/:code/test-connection`** (disabled when not in this deployment).
- `RunsModal({ source, onClose })`: **GET `/admin/external-sources/:code/runs?limit=30`**.
- `StatusModal({ source, onClose, onDone })`: **PATCH `/admin/external-sources/:code/status`** `{ integrationStatus, note? }`. A note of at least 10 characters is required for `ACTIVE`.
- Constants: `STATUSES`, `HEALTH_TONE`, `INTEGRATION_TONE`.

#### `apps/web/src/pages/admin/MappingReview.jsx`

"Match review" tab: external listings the matcher could not link with certainty.

- **`MappingReview()`** (default): **GET `/admin/product-mapping/review-queue?limit=20`**.
- `ReviewItem({ item, onChanged, onLink })`: the listing and its candidate products, pack sizes side by side. "Same product" / "Not this" → **POST `/admin/product-mapping/:mappingId/decision`** `{ decision: 'CONFIRM' | 'REJECT' }`. "Same product" is disabled when both pack sizes are known and differ (the API refuses that link).
- `ManualLinkModal({ listing, onClose, onDone })`: pick any product with `VariantPicker` → **POST `/admin/product-mapping/listings/:listingId/manual`** `{ variantId, note }`.
- Helpers: `sizeText(packSize)`, `sameSize(a, b)`.

### 3.8 `pages/` (seller hub)

#### `apps/web/src/pages/Seller.jsx`

Seller hub (`/seller`, `/seller/:companyId`, signed in).

- **`Seller()`** (default): **GET `/companies`** (companies you belong to, with your `role`). Without `companyId`: one company → redirect to it; otherwise `CompanyPicker`. With `companyId` not in the list → redirect to `/seller`.
- `CompanyPicker({ companies, onCreated })`: company cards and `CreateCompany`.
- `CreateCompany({ onCreated })`: **POST `/companies`** `{ name, registrationNumber? }`, reloads companies and the user, then opens `/seller/:id?tab=warehouses`.
- `Dashboard({ company, companies })`: header, company switcher (`Select`) when you have several, and tabs in `?tab=`: `overview`, `inventory`, `offers`, `warehouses`, `delivery`, `members`, `import`. Each tab component receives `ctx = { companyId, canManage, role }`, where `canManage` is `role === 'OWNER' || role === 'ADMIN'`.
- `Overview({ companyId, go })`: in parallel **GET `/companies/:id/warehouses`**, **`/offers`**, **`/inventory`**, **`/delivery-providers`**. Stats, a "Get selling" checklist (until all 4 steps are done), `StackedBars` of available vs reserved per warehouse, a `Donut`, low stock (5 or fewer available), and a warehouse list. `go(tab)` switches tabs.

#### `apps/web/src/pages/seller/Warehouses.jsx`

- **`Warehouses({ companyId, canManage })`** (default): **GET `/companies/:id/warehouses`**. Table with an OpenStreetMap link per location. Add/Edit only for managers.
- `CreateWarehouse`: name, address, lat, lng, radius (with "Quick fill" from `PLACES`) → **POST `/companies/:id/warehouses`**.
- `EditWarehouse`: sends only changed fields (name, radius, status `ACTIVE`/`INACTIVE`) → **PATCH `/companies/:id/warehouses/:warehouseId`**. Closes without a request when nothing changed.

#### `apps/web/src/pages/seller/Offers.jsx`

- **`Offers({ companyId, canManage })`** (default): **GET `/companies/:id/offers`**. An offer is the seller's price for a shared catalog product.
- `CreateOffer`: `VariantPicker`, SKU, price, optional MRP → **POST `/companies/:id/offers`** `{ variantId, sellerSku, priceMinor, mrpMinor? }`.
- `EditOffer`: sends only changed fields; an empty MRP sends `mrpMinor: null` (clears it); status `ACTIVE`/`PAUSED`/`ARCHIVED` → **PATCH `/companies/:id/offers/:offerId`**.

#### `apps/web/src/pages/seller/Inventory.jsx`

- **`Inventory({ companyId })`** (default). Loads warehouses and offers (**GET** both) for the selectors, and **GET `/companies/:id/inventory?warehouseId=`** (filter by warehouse or all). Table of on hand, reserved and available with a coloured bar. Staff can adjust stock too (no `canManage` check here).
- `AdjustModal({ companyId, initial, refs, onClose, onDone })`: warehouse, offer, delta (positive adds, negative removes), reason (`RESTOCK`, `CORRECTION`, `DAMAGE`, `RETURN`), optional note → **POST `/companies/:id/inventory/adjustments`**. Stock can never go below what is reserved.

#### `apps/web/src/pages/seller/Delivery.jsx`

- **`Delivery({ companyId, canManage })`** (default): **GET `/companies/:id/delivery-providers`** (own fleet) and **GET `/delivery/providers`** (platform couriers). "Register fleet" (managers) → **POST `/companies/:id/delivery-providers`**.
- **`ProviderTable({ items })`** (export): cards with fees, speed, pickup time, reliability bar and max distance. Also used by `Admin.jsx`.
- **`ProviderModal({ title, onClose, onSubmit, onDone, withType })`** (export): form for name, (type), base fee, per-km fee, speed, pickup minutes, reliability %, max distance. Converts rupees with `toMinor` and reliability to 0–1, then calls the `onSubmit(body)` it was given. Also used by `Admin.jsx` with `withType`.
- `Metric` (internal): small label/value tile.

#### `apps/web/src/pages/seller/Members.jsx`

- **`Members({ companyId, canManage })`** (default): **GET `/companies/:id/members`**; managers can add an existing user by email as `STAFF` or `ADMIN` → **POST `/companies/:id/members`** `{ email, role }`. `ROLE` describes what each role can do.

#### `apps/web/src/pages/seller/Import.jsx`

CSV import of offers and stock. All or nothing: any error means nothing is saved.

- **`Import({ companyId, canManage })`** (default). Managers only. Load a CSV by file picker, drag and drop, or pasting. "Check file" → **POST `/companies/:id/catalogue-imports?dryRun=true`** with the raw CSV as `text/csv`. "Import" (enabled only after a valid check) → same with `dryRun=false`. Offers a template download (`TEMPLATE`, a `data:` URL) and lists your warehouse names from **GET `/companies/:id/warehouses`**. Columns: `sku`, `barcode` or `variant_id`, `price`, `mrp`, `warehouse`, `quantity`.
- `sendCsv(companyId, csv, dryRun)` (internal).
- `Preview({ preview })` (internal): error table (line, column, problem) or the row-by-row plan (offer create/update/unchanged, price, stock from → to).

---

## 4. How to add a new page

The steps below follow how the existing pages are wired.

1. **Create the file.** Add `apps/web/src/pages/MyPage.jsx` with a default-exported component. Import shared code with the `@/` alias (`@/components/kit`, `@/lib/api`, ...).

2. **Load data with `useAsync`.**

   ```jsx
   import { get } from '@/lib/api';
   import { useAsync } from '@/lib/store';
   import { Empty, ErrorBox, PageHeader, Panel, SkeletonRows } from '@/components/kit';

   export default function MyPage() {
     const { data, error, loading, reload } = useAsync(() => get('/things'), []);
     return (
       <>
         <PageHeader eyebrow="Section" title="My page" description="What this page is for." />
         <Panel title="Things" pad={false}>
           <ErrorBox error={error} onRetry={reload} />
           {loading && !data && <SkeletonRows />}
           {data?.items.length === 0 && <Empty title="Nothing yet" />}
           {/* render data.items */}
         </Panel>
       </>
     );
   }
   ```

   Put every value the loader uses in the deps array, as the existing pages do (for example `[companyId, warehouseId]`). Pass `{ auth: false }` for public endpoints.

3. **Handle actions with `useSubmit`.** Wrap the call, show `busy` on the button, show `error` with `ErrorBox`, toast on success with `useToast()`, then `reload()`:

   ```jsx
   const toast = useToast();
   const save = useSubmit(async (e) => {
     e.preventDefault();
     await post('/things', form);
     toast('Saved');
     reload();
   });
   // <form onSubmit={save.run}> ... <Button type="submit" busy={save.busy}>Save</Button> <ErrorBox error={save.error} />
   ```

   For a form inside a dialog, render `<Modal>` conditionally, give the `<form>` an `id`, and put the submit button in `footer` with `form="that-id"` (see `seller/Warehouses.jsx`).

4. **Register the route in `App.jsx`.**
   - Shopper pages that should load instantly: import normally.
   - Back-office pages: `const MyPage = lazy(() => import('./pages/MyPage.jsx'));`.
   - Add `<Route path="/my-page" element={<Contained><MyPage /></Contained>} />` above the `*` route. `Contained` gives the standard padding and the `Suspense` that lazy pages need.
   - Signed-in only: wrap in `<RequireAuth>`. Platform admins only: `<RequireAuth admin>`.

5. **Add navigation if needed.** Add an entry to `useNavItems()` (top bar and mobile menu), and optionally to `UserMenu` or the `Footer` columns.

6. **A tab instead of a page?** For the seller hub, add `{ id, label, icon }` to `TABS` in `pages/Seller.jsx` and a line like `{tab === 'mytab' && <MyTab {...ctx} />}`. Your component receives `{ companyId, canManage, role }`; hide write actions when `canManage` is false. For the admin console, do the same with `TABS` in `pages/Admin.jsx`. Tabs live in `?tab=` so they can be linked.

7. **Charts or MUI widgets.** Import them from `@/components/mui/lazy`, never from `@mui/*` directly in a page. If you need a new MUI widget, add it to `components/mui/widgets.jsx` (wrapped in `MuiScope`) and export a lazy version from `lazy.jsx`.

8. **New API endpoint?** Optionally add it to `ENDPOINTS` in `pages/Explorer.jsx` so it can be tried by hand.

9. **Check it.** Run `npm run dev` in `apps/web` (with the API running) and open `http://localhost:5173`. Check light and dark themes and a phone-width window. Run `npm run build` to make sure it bundles. There are no frontend unit tests.

---

## 5. Design conventions

### 5.1 Tokens (`tailwind.config.js` + `src/index.css`)

Colours are **semantic tokens**, not raw colours. Each is an HSL CSS variable defined twice in `index.css` (`:root` for light, `.dark` for dark) and exposed to Tailwind as `hsl(var(--name))`. So `bg-primary` automatically switches in dark mode. Opacity modifiers work too (`bg-primary/10`).

| Token | Typical use |
|---|---|
| `background`, `foreground` | Page background and text |
| `card`, `popover` (+ `-foreground`) | Surfaces |
| `primary` (+ `-foreground`) | Main green actions |
| `secondary`, `muted`, `accent` (+ `-foreground`) | Quiet backgrounds, secondary text (`text-muted-foreground`) |
| `destructive` (+ `-foreground`) | Errors, delete |
| `gold` (+ `-foreground`) | Highlights, "best" markers, demo notices |
| `success`, `warning`, `info` | Status colours (no foreground pair) |
| `border`, `input`, `ring` | Borders, inputs, focus ring |

Other tokens:

- **Radius:** `--radius` is `0.85rem`; `rounded-lg` equals it, `md`/`sm` are smaller, `xl`/`2xl` larger.
- **Shadows:** `shadow-soft` (cards), `shadow-lift` (hover, popups), `shadow-glow` (primary emphasis). They use `--shadow` so they adapt to dark mode.
- **Fonts:** `font-sans` Plus Jakarta Sans (default), `font-display` Instrument Serif, `font-mono` JetBrains Mono.
- **Container:** `.container` is centred with `1.25rem` padding and a 1280 px max width.
- **Animations:** `animate-float`, `animate-marquee`, `animate-shine`, `animate-border-beam`, `animate-shimmer-slide`, `animate-spin-around` (used by `fx.jsx`), plus `tailwindcss-animate` utilities for Radix popups.
- **Helper classes** (`index.css`): `.num` for tabular numbers (use on prices and counts), `.bg-aurora` and `.bg-grid` for dark hero panels, `.glass`, `.text-gradient`, `.scrollbar-thin`, `.scrollbar-none`.

Do not hard-code hex colours in components. The exceptions in the code are deliberate: hero/promo gradients, `CHART_COLORS`, and the MUI theme in `MuiScope`.

### 5.2 `cn()` and variants

- Combine classes with `cn()` from `@/lib/utils`. It handles conditions (`cn('p-3', active && 'bg-accent')`) and lets a `className` prop override defaults, because `tailwind-merge` removes the conflicting earlier class.
- Component variants use **`cva`** (class-variance-authority) in `ui/button.jsx` and `ui/badge.jsx`. Add a new variant there, not with ad-hoc classes in pages.
- Remember the `kit` `Button` name mapping: `variant="secondary"` gives the **outline** style; use `variant="soft"` for the filled secondary style.
- Status badges should use `<Badge status={...} />` so colours come from `tone()` in `lib/format.js`. Add new statuses to `TONES` there.

### 5.3 Lazy-loaded MUI

MUI and its CSS-in-JS engine (Emotion) are large. Three things keep them off the first page load:

1. `vite.config.js` puts them in a separate `mui` chunk.
2. Pages import only from `components/mui/lazy.jsx`, which uses `React.lazy` and shows a `Skeleton` of the right height while the chunk downloads.
3. `MuiScope` is imported only from `widgets.jsx`, and uses `injectFirst` so Tailwind classes still win over MUI styles.

### 5.4 Other patterns you will see

- **Money** is integer paise everywhere. Display with `money()`; convert form input with `toMinor()`.
- **Loading, empty, error**: each data section shows a `Spinner` or `SkeletonRows` while `loading && !data`, `Empty` when the list is empty, and `ErrorBox` with `onRetry={reload}` on error. While reloading with old data, lists fade (`opacity-60`) instead of disappearing.
- **Toasts** go through `useToast()` with `good`, `bad`, `warn` or `info`.
- **URL state**: filters and tabs live in the query string (`useSearchParams`) so they survive reloads and can be shared.
- **Honest labels**: demo data, unknown values and unconfirmed matches are always labelled (`DemoNotice`, `compare.jsx`, `price-history.jsx`, `Sources.jsx`).
- **Accessibility**: icon-only buttons have `aria-label`; dialogs always have a description (screen-reader-only when not shown); Radix primitives provide keyboard support.
- **Icons** come from `lucide-react`. Inside `Button`, `Badge`, menu items and tabs, the primitive's classes size the SVG automatically (`[&_svg]:size-4`), so you can drop an icon in without a size class.
- **Motion** uses `framer-motion` (`motion.div`, `AnimatePresence`) and the `fx.jsx` helpers. Keep it subtle and short.
