# Core packages reference

This page documents, function by function, the shared packages that the API and the worker build on:

- [`packages/database`](#packagesdatabase): PostgreSQL pool, transactions, migrations, and the domain operations for stock, orders, outbox events and payments.
- [`packages/payments`](#packagespayments): the Razorpay client and payment gateway logic.
- [`packages/allocation-engine`](#packagesallocation-engine): decides which warehouses fulfil a cart, and how it is delivered.
- [`packages/logger`](#packageslogger): structured JSON logging with redaction.
- [`packages/metrics`](#packagesmetrics): a small Prometheus metrics registry.

For table columns, see [DATA_DICTIONARY.md](../DATA_DICTIONARY.md). For the payment flow, see [PAYMENTS.md](../PAYMENTS.md).
For the worker that calls many of these functions, see [worker.md](worker.md).

### Key terms

- **Transaction.** A group of database statements that succeed or fail together. `BEGIN` starts one, `COMMIT`
  saves it, `ROLLBACK` undoes it.
- **Row lock (`SELECT ... FOR UPDATE`).** Locks the selected rows until the transaction ends. Another transaction
  that wants to lock or change the same rows waits. This is how the code stops two requests from changing the same stock or order at once.
- **Deadlock.** Two transactions each wait for a lock the other holds. PostgreSQL detects this and aborts one of
  them with error code `40P01`. Locking rows in a fixed order (for example, sorted by id) prevents it.
- **Serialization failure.** Error code `40001`. PostgreSQL aborts a transaction that conflicts with another. The
  safe fix is to run the whole transaction again.
- **Advisory lock.** A lock on an arbitrary number, not on a row. Used here so only one migration run happens at a time.
- **Transactional outbox.** Events are written to the `outbox_events` table in the same transaction as the business
  change, then published later by the worker. See [worker.md](worker.md#key-terms).
- **Minor units.** Money is stored as whole numbers of the smallest unit (paise for INR). 52.00 rupees is `5200`.
- **HMAC.** "Hash-based message authentication code". A fingerprint of some data made with a secret key
  (here SHA-256). Only someone with the key can produce the correct fingerprint, so it proves a message came from
  Razorpay and was not changed.
- **Prometheus.** A monitoring system that regularly fetches a plain-text `/metrics` page and stores the numbers over time.

---

# packages/database

Package name `@localstock/database`. It exports `./src/index.js` as the main entry and
`./test-support/isolated-database.js` as `@localstock/database/test-support`.

npm scripts (run with `-w @localstock/database`, or through the root scripts):

| Script | Command | Root shortcut |
|---|---|---|
| `migrate` | `node src/cli/migrate.js` | `npm run db:migrate` |
| `migrate:down` | `node src/cli/migrate.js down` | `npm run db:migrate:down -- <steps>` |
| `backfill:pack-size` | `node src/cli/backfill-pack-size.js` | part of `npm run db:seed` |
| `test` | `node --test` | part of `npm test` |
| `test:db` | `node --test --test-concurrency=1` | part of `npm run test:db` |

## packages/database/src/index.js

**Purpose.** The package's public API. It re-exports everything listed below and creates connection pools.

Top-level code: `pg.types.setTypeParser(INT8, Number)`. PostgreSQL `BIGINT` values (money in minor units, counts)
would otherwise arrive as strings. They are converted to JavaScript numbers. The comment notes these values stay
well within `Number.MAX_SAFE_INTEGER`.

Re-exports:

| Export | From |
|---|---|
| `migrate`, `rollback` | `migrate.js` |
| `extractPackSize`, `parsePackSize`, `packSizeFromAttributes`, `samePackSize` | `domain/pack-size.js` |
| `backfillPackSizes` | `domain/pack-size-backfill.js` |
| `normalizeText` | `domain/text.js` |
| `reserveInventory`, `releaseReservations`, `recordMovement`, `InsufficientStockError` | `domain/inventory.js` |
| `ORDER_TRANSITIONS`, `transitionOrder`, `IllegalTransitionError` | `domain/orders.js` |
| `enqueueEvent` | `domain/outbox.js` |
| `markRefunded`, `PaymentNotFoundError`, `settlePayment` | `domain/payments.js` |
| `withTransaction` | `transaction.js` |

### `export function createPool(connectionString, options = {})`

- **What it does.** Creates a `pg.Pool` (a set of reusable database connections).
- **Parameters.** `connectionString`: a `postgres://` URL. `options`: extra `pg.Pool` options; they override the default `max: 10`.
- **Returns.** The pool. No connection is opened until the first query.
- **Called by.** The API server, `apps/worker/src/start-worker.js` (`max: 5`), the CLI scripts (`max: 1`),
  `test-support/isolated-database.js`, and the API seed scripts.

## packages/database/src/transaction.js

**Purpose.** Runs a function inside a transaction and retries it on deadlock or serialization failure.

Constants: `RETRYABLE_CODES = {'40001', '40P01'}`. Internal helper `sleep(ms)` returns a promise that resolves after `ms`.

### `export async function withTransaction(pool, fn, { retries = 3 } = {})`

- **What it does.**
  1. Takes a client from the pool and runs `BEGIN`.
  2. Calls `await fn(client)`.
  3. Runs `COMMIT` and returns `fn`'s result.
  4. On any error: runs `ROLLBACK`. If the error code is `40001` or `40P01` and fewer than `retries` retries have
     happened, waits `20 * 2^attempt + random(0..20)` ms and runs the **whole** function again on a fresh client.
     Otherwise re-throws the error.
  5. Always releases the client. If `ROLLBACK` itself failed, the client is released as broken, so the pool destroys it instead of reusing it.
- **Parameters.** `pool`: a `pg.Pool`. `fn(client)`: async function that does the work with `client`.
  `retries`: how many extra tries are allowed (default 3; the seed scripts pass `0`).
- **Returns.** Whatever `fn` returns.
- **Errors.** Re-throws any error from `fn`, `BEGIN` or `COMMIT` once retries are used up or the error is not retryable.
- **Important.** Because `fn` may run more than once, it must not have side effects outside the database (such as HTTP calls).
- **Called by.** Almost every API module that writes data (orders, auth, offers, inventory, warehouses, organizations,
  admin, imports, catalog, mapping review, sources), the API seed scripts, `domain/payments.js`, the worker's consumers
  and jobs (`run-consumer.js`, `outbox-publisher.js`, `reservation-expiry.js`), and `@localstock/external-data`
  (`collector.js`, `health.js`).

## packages/database/src/migrate.js

**Purpose.** Applies and rolls back the SQL migration files in `packages/database/migrations/`.

Constants and helpers:

- `DEFAULT_DIR`: the `migrations` folder next to `src`.
- `MIGRATION_LOCK_ID = 727274`: the advisory lock number.
- `isDown(f)`: true if a file name ends in `.down.sql`.
- `downFileFor(name)`: turns `NNN_name.sql` into `NNN_name.down.sql`.

### `async function withMigrationLock(pool, fn)` (internal)

- **What it does.** Takes one client, runs `SELECT pg_advisory_lock(727274)` (waits if another migrator holds it, for
  example during two overlapping deploys), creates the `schema_migrations` table if missing (`name` primary key,
  `applied_at`), then runs `fn(client)`. Finally unlocks (`pg_advisory_unlock`, errors ignored) and releases the client.
- **Returns.** `fn`'s result.
- **Called by.** `migrate`, `rollback`.

### `async function runInTransaction(client, label, sql, after)` (internal)

- **What it does.** `BEGIN`, runs the whole `sql` text, runs `await after()`, `COMMIT`. On error: `ROLLBACK`, prefixes
  the error message with `<label> failed: `, and re-throws.
- **Called by.** `migrate` (`after` inserts into `schema_migrations`) and `rollback` (`after` deletes from it).

### `export async function migrate(pool, { dir = DEFAULT_DIR, log = () => {} } = {})`

- **What it does.** Under the advisory lock: lists `*.sql` files in `dir` that are not `.down.sql`, sorts them by name,
  reads the names already in `schema_migrations`, and applies each missing file in its own transaction, recording
  its name. Calls `log('applied <file>')` after each.
- **Parameters.** `pool`; `dir`: migrations folder; `log`: callback for progress messages.
- **Returns.** The array of file names applied (empty if the database was up to date).
- **Errors.** `migration <file> failed: <postgres message>`. Earlier files stay applied; the failing one is rolled back.
- **Called by.** `src/cli/migrate.js`, `test-support/isolated-database.js`, `packages/database/test/migrations.db.test.js`.

### `export async function rollback(pool, { dir = DEFAULT_DIR, steps = 1, log = () => {} } = {})`

- **What it does.** Under the advisory lock: takes the newest `steps` names from `schema_migrations` (by name,
  descending). First checks that every one has a `.down.sql` file; if any is missing it throws before changing
  anything. Then runs each down file in its own transaction, deleting its `schema_migrations` row, and logs `rolled back <name>`.
- **Parameters.** `pool`; `dir`; `steps` (positive integer); `log`.
- **Returns.** The array of names rolled back.
- **Errors.** `steps must be a positive integer`; `migration <name> has no <name>.down.sql; it cannot be rolled back`
  (this is the case for `001_init.sql`); `rollback of <name> failed: <message>`.
- **Called by.** `src/cli/migrate.js` (`down`), `packages/database/test/migrations.db.test.js`.

## packages/database/src/cli/migrate.js

**Purpose.** Command-line script for migrations. Usage: `node migrate.js` applies pending migrations;
`node migrate.js down [steps]` rolls back the newest `steps` (default 1).

Top-level code (no named functions):

1. Loads `.env` from the repository root.
2. If `DATABASE_URL` is missing, prints `DATABASE_URL is not set. Copy .env.example to .env first.` and exits with code 1.
3. If the first argument is present and is not `down`, prints usage and exits with code 1.
4. Creates a pool with `max: 1`. Runs `rollback(pool, { steps, log })` or `migrate(pool, { log })`, printing each step and a summary
   (`done: N migration(s) applied`, `database is up to date`, `done: N migration(s) rolled back`, `nothing to roll back`).
5. On error, prints the message and sets exit code 1. Always ends the pool.

Called by: `npm run db:migrate` / `db:migrate:down`, `apps/api/src/scripts/release.js` (as a child process), and the API
Docker image instructions.

## packages/database/src/cli/backfill-pack-size.js

**Purpose.** Command-line script that fills the parsed pack-size columns of `product_variants` from each row's `attributes`.

Top-level code (no named functions):

1. Loads `.env`; exits with code 1 if `DATABASE_URL` is missing.
2. `--all` on the command line recomputes every variant; without it, only variants with `pack_quantity IS NULL` are processed.
3. Calls `backfillPackSizes(pool, { all })` and prints `pack sizes: N variant(s) scanned, P parsed, U left unknown`.
4. On error, prints the message and sets exit code 1. Always ends the pool.

Called by: `npm run backfill:pack-size -w @localstock/database`, `npm run db:seed`, and `release.js` when `SEED_DEMO_DATA=true`.

## packages/database/src/domain/inventory.js

**Purpose.** Reserves and releases stock safely under concurrency. The invariant is `0 <= reserved <= on_hand` for every
`warehouse_inventory` row. It is enforced by the conditional updates below and by table `CHECK` constraints.

### `export class InsufficientStockError extends Error`

- **Constructor.** `new InsufficientStockError(shortfalls)`. Message `Insufficient stock for one or more inventory rows`.
- **Fields.** `name = 'InsufficientStockError'`, `domainCode = 'INSUFFICIENT_STOCK'`, `details = { shortfalls }`, where
  `shortfalls` is `[{ inventoryId, requested }]`.
- **Thrown by.** `reserveInventory`. Caught by `apps/api/src/modules/orders/orders.service.js`.

### `function sumByInventory(rows)` (internal)

- **What it does.** Adds up `quantity` per `inventoryId`.
- **Parameters.** `rows`: `[{ inventoryId, quantity }]`.
- **Returns.** `Map(inventoryId -> total quantity)`.
- **Called by.** `reserveInventory`, `releaseReservations`.

### `async function lockInventoryRows(client, ids)` (internal)

- **What it does.** `SELECT id FROM warehouse_inventory WHERE id = ANY($1) ORDER BY id FOR UPDATE`. Locking in id order
  means two transactions that touch the same rows always lock them in the same order, so they cannot deadlock each other.
- **Called by.** `reserveInventory`, `releaseReservations`.

### `export async function recordMovement(client, { inventoryId, onHandDelta = 0, reservedDelta = 0, reason, note = null, referenceType = null, referenceId = null, actorUserId = null })`

- **What it does.** Inserts one row into `inventory_movements`, the audit trail of every stock change.
- **Parameters.** `client`: a transaction client. The deltas are signed integers. `reason`: e.g. `RESERVATION`,
  `RELEASE`, `EXPIRY`, `RESTOCK`, `CORRECTION` (allowed values are constrained by the table). `referenceType` / `referenceId`:
  what caused it (e.g. `order` and the order id). `actorUserId`: who did it, if a user.
- **Returns.** Nothing.
- **Called by.** `reserveInventory`, `releaseReservations`, `apps/api/src/modules/inventory/inventory.routes.js`,
  `apps/api/src/modules/imports/catalogue-import.js`.

### `export async function reserveInventory(client, rows, { referenceType = null, referenceId = null } = {})`

- **What it does.** Increases `warehouse_inventory.reserved` for each inventory row, but only where enough stock is free.
  1. Sums the requested quantities per inventory row.
  2. Locks those rows in id order.
  3. For each row: `UPDATE ... SET reserved = reserved + q, version = version + 1 WHERE id = $2 AND on_hand - reserved >= q`.
     If no row was updated, records a shortfall.
  4. If there was any shortfall, throws `InsufficientStockError` (the caller must roll back, which undoes the successful updates).
  5. Otherwise writes one `RESERVATION` movement per row.
- **Parameters.** `client`: must be inside a transaction. `rows`: `[{ inventoryId, quantity }]`. `referenceType`, `referenceId`: stored on the movements.
- **Returns.** Nothing.
- **Note.** It does not create `inventory_reservations` rows; the caller (the order service) does that.
- **Errors.** `InsufficientStockError`.
- **Called by.** `apps/api/src/modules/orders/orders.service.js`; `packages/database/test/reservation.concurrency.test.js`.

### `export async function releaseReservations(client, { orderId, fromStatus = 'ACTIVE', toStatus, onlyExpired = false, actorUserId = null })`

- **What it does.** Releases an order's reservations at most once, even when expiry, cancellation and payment callbacks race.
  1. `UPDATE inventory_reservations SET status = toStatus WHERE order_id = orderId AND status = fromStatus`
     (plus `AND expires_at <= now()` when `onlyExpired`), returning the changed rows. Because the update is conditional
     on the current status, a second caller finds nothing to change.
  2. If no rows changed, returns `[]`.
  3. Locks the affected inventory rows in id order, subtracts the quantities from `reserved`, and writes a movement with
     reason `EXPIRY` (when `toStatus` is `EXPIRED`) or `RELEASE`, referencing the order.
- **Parameters.** `client`: inside a transaction. `orderId`. `fromStatus`: the status to release from (default `ACTIVE`;
  `settlePayment` uses `CONFIRMED` to give back partly confirmed stock). `toStatus`: e.g. `RELEASED`, `EXPIRED`.
  `onlyExpired`: only reservations past their deadline. `actorUserId`: stored on the movement.
- **Returns.** The released reservation rows `[{ id, inventory_id, quantity }]`.
- **Called by.** `apps/api/src/modules/orders/orders.service.js` (customer cancel), `domain/payments.js`,
  `apps/worker/src/jobs/reservation-expiry.js`; tests.

## packages/database/src/domain/orders.js

**Purpose.** The order state machine.

### `export const ORDER_TRANSITIONS`

A frozen map from each order status to the statuses it may move to:

| From | Allowed to |
|---|---|
| `CREATED` | `PENDING_PAYMENT`, `CANCELLED` |
| `PENDING_PAYMENT` | `CONFIRMED`, `PAYMENT_FAILED`, `CANCELLED`, `REFUND_PENDING` |
| `CONFIRMED` | `PARTIALLY_FULFILLED`, `FULFILLED`, `CANCELLED`, `PARTIALLY_CANCELLED`, `REFUND_PENDING` |
| `PARTIALLY_FULFILLED` | `FULFILLED`, `PARTIALLY_CANCELLED` |
| `FULFILLED` | `DELIVERED` |
| `CANCELLED` | `REFUND_PENDING` (a payment can succeed after cancellation; the money must go back) |
| `PAYMENT_FAILED` | `REFUND_PENDING` |
| `PARTIALLY_CANCELLED` | `REFUND_PENDING` |
| `REFUND_PENDING` | `REFUNDED` |
| `DELIVERED` | none |
| `REFUNDED` | none |

### `export class IllegalTransitionError extends Error`

- **Constructor.** `new IllegalTransitionError(from, to, reason = 'transition not allowed')`. Message
  `Illegal order transition <from> -> <to>: <reason>`.
- **Fields.** `name = 'IllegalTransitionError'`, `domainCode = 'ILLEGAL_TRANSITION'`, `details = { from, to }`.

### `export async function transitionOrder(client, { orderId, from, to, source, actorUserId = null })`

- **What it does.**
  1. If `to` is not allowed from `from` in `ORDER_TRANSITIONS`, throws `IllegalTransitionError(from, to)`.
  2. "Compare-and-set": `UPDATE orders SET status = to WHERE id = orderId AND status = from`. If no row matched, the
     status changed meanwhile, so it throws `IllegalTransitionError(from, to, 'order status changed concurrently')`.
  3. Inserts a row into `order_status_history` (`from_status`, `to_status`, `source`, `actor_user_id`).
- **Parameters.** `client`: inside a transaction. `source`: free text such as `customer`, `reservation-expiry`, `payment:razorpay`.
- **Returns.** Nothing.
- **Errors.** `IllegalTransitionError`.
- **Called by.** `orders.service.js` (API), `domain/payments.js`, `apps/worker/src/jobs/reservation-expiry.js`.

## packages/database/src/domain/outbox.js

**Purpose.** The writing half of the transactional outbox.

### `export async function enqueueEvent(client, { eventType, aggregateType, aggregateId, payload })`

- **What it does.** Inserts a row into `outbox_events` with the JSON-encoded `payload`. Because it uses the caller's
  transaction client, the event commits or rolls back together with the business change.
- **Parameters.** `client`: transaction client. `eventType`: e.g. `OrderConfirmed`. `aggregateType`: e.g. `order`, `offer`,
  `inventory`, `company`, `warehouse`, `external_price`. Together they form the RabbitMQ routing key
  `<aggregateType>.<eventType>`. `aggregateId`: id of the thing that changed. `payload`: any JSON-serializable object.
- **Returns.** The new event id (UUID).
- **Called by.** API modules (orders, offers, inventory, admin, catalogue import), `domain/payments.js`, the worker's
  reservation-expiry job, and `@localstock/external-data` (`collector.js`, `observations.js`).

## packages/database/src/domain/payments.js

**Purpose.** Applies a payment provider's outcome to a payment and its order, exactly once, and records refunds.

### `export class PaymentNotFoundError extends Error`

Message `Unknown payment`, `name = 'PaymentNotFoundError'`. The API maps it to a 404 `PAYMENT_NOT_FOUND`.

### `const cancelShipments = (client, orderId)` (internal)

Sets every shipment of the order that is `PENDING` or `INVENTORY_RESERVED` to `CANCELLED`.

### `const setPaymentStatus = (client, paymentId, status, chargeId = null)` (internal)

Updates `payments.status` and, if `chargeId` is given, `provider_charge_id` (otherwise keeps the existing value).

### `export function settlePayment(pool, { provider, eventId, providerPaymentId, status, chargeId = null, payload })`

- **What it does.** In one `withTransaction`:
  1. **Event dedup.** Inserts `(provider, eventId, payload)` into `webhook_events` with `ON CONFLICT DO NOTHING`. If the
     event id was seen before, returns `{ outcome: 'DUPLICATE_EVENT' }`.
  2. Finds the payment's `order_id` by `(provider, provider_payment_id)`. If none, throws `PaymentNotFoundError`
     (which also rolls back the `webhook_events` insert).
  3. **Locks the order row first** (`FOR UPDATE`), then the payment row. Cancellation and the expiry job lock in the
     same order, so confirmation and expiry cannot both win.
  4. If the payment is no longer `PENDING`, returns `{ outcome: 'ALREADY_SETTLED', paymentStatus, orderId }`.
  5. **`status === 'FAILED'`:** sets the payment to `FAILED`. If the order is `PENDING_PAYMENT`, releases its active
     reservations (`RELEASED`), moves the order to `PAYMENT_FAILED`, cancels shipments, and enqueues `OrderPaymentFailed`.
     Returns `{ outcome: 'PAYMENT_FAILED', orderId }`.
  6. **Any other status (success):**
     - releases reservations already past their deadline as `EXPIRED` (even if the expiry job has not run yet) and, if
       any, enqueues `OrderExpired`;
     - marks the remaining in-time `ACTIVE` reservations `CONFIRMED`;
     - if the order is `PENDING_PAYMENT` and **every** reservation of the order was just confirmed: sets the payment
       `SUCCEEDED` (with `chargeId`), moves the order to `CONFIRMED`, enqueues `OrderConfirmed`, and returns
       `{ outcome: 'CONFIRMED', orderId }`;
     - otherwise the payment came too late (a reservation expired, or the order was cancelled first): gives back any
       reservations just confirmed (`CONFIRMED` to `RELEASED`), sets the payment `REFUND_PENDING` (with `chargeId`),
       cancels shipments if the order was `PENDING_PAYMENT`, moves the order to `REFUND_PENDING`, enqueues
       `PaymentRefundRequested` with `{ orderId, paymentId }`, and returns `{ outcome: 'REFUND_PENDING', orderId }`.
- **Parameters.** `pool`. `provider`: e.g. `sandbox`, `razorpay`. `eventId`: the provider's event id, used for dedup.
  `providerPaymentId`: the provider's payment reference stored in `payments.provider_payment_id`. `status`: `'FAILED'`
  or a success value. `chargeId`: the provider's id of the captured payment, needed later to refund it. `payload`: stored in `webhook_events`.
- **Returns.** A promise of `{ outcome, orderId?, paymentStatus? }` as described.
- **Errors.** `PaymentNotFoundError`; `IllegalTransitionError` if the order's status does not allow the needed
  transition (the whole transaction then rolls back); database errors.
- **Side effects.** Tables `webhook_events`, `payments`, `orders`, `order_status_history`, `inventory_reservations`,
  `warehouse_inventory`, `inventory_movements`, `shipments`, `outbox_events`. Locks one order and one payment row.
- **Called by.** `apps/api/src/modules/payments/payments.service.js` (sandbox webhook and simulate endpoints) and
  `packages/payments/src/gateway.js` (`applyPaidOrder`).

### `export function markRefunded(pool, { paymentId, refundId, source })`

- **What it does.** In one transaction, records that the provider finished a refund:
  1. Reads the payment's order and order status, locking the **order** row (`FOR UPDATE OF o`). If the payment does not
     exist, throws `PaymentNotFoundError`.
  2. `UPDATE payments SET status = 'REFUNDED', provider_refund_id = coalesce(provider_refund_id, refundId) WHERE id = paymentId AND status = 'REFUND_PENDING'`.
     If nothing changed, returns `{ outcome: 'ALREADY_SETTLED' }`.
  3. If the order is `REFUND_PENDING`, moves it to `REFUNDED`.
  4. Enqueues `PaymentRefunded` with `{ orderId, paymentId }`.
- **Parameters.** `paymentId`: our payment UUID. `refundId`: the provider's refund id. `source`: recorded in order history.
- **Returns.** `{ outcome: 'REFUNDED', orderId }` or `{ outcome: 'ALREADY_SETTLED' }`.
- **Called by.** `packages/payments/src/gateway.js` (`refundSucceeded`).

## packages/database/src/domain/pack-size.js

**Purpose.** Turns free-text pack sizes such as `"1 kg"`, `"6 x 200 ml"` or `"pack of 4"` into a structured value
`{ quantity, unit, count }`:

- `unit` is one of `g`, `ml`, `pcs` (base units);
- `quantity` is the size of **one item** in that unit, rounded to 3 decimals;
- `count` is the number of items in the pack.

Examples: `"1 kg"` is `{ quantity: 1000, unit: 'g', count: 1 }`; `"6 x 200 ml"` is `{ 200, 'ml', 6 }`; `"6 pcs"` is
`{ 6, 'pcs', 1 }`; `"pack of 4"` is `{ 4, 'pcs', 1 }`. Anything not understood is `null`, never a guess.

Constants: `UNITS` maps accepted unit spellings to a base unit and factor (`mg` 0.001 g; `g`, `gm`, `gms`, `gram`... 1 g;
`kg`, `kilo`... 1000 g; `ml`... 1 ml; `cl` 10 ml; `l`, `ltr`, `litre`... 1000 ml; `pc`, `pcs`, `piece`, `unit`, `nos`, `count`, `ct`
1 pcs). Regexes `SINGLE` (`200 ml`), `COUNT_FIRST` (`6 x 200 ml`), `SIZE_FIRST` (`200 ml x 6`), `PACK_OF` (`pack of 4`).
`MAX_COUNT = 1000`. `round3(n)` rounds to 3 decimals.

### `function build(rawQuantity, rawUnit, count)` (internal)

Looks up the unit, multiplies the quantity by the unit factor and rounds to 3 decimals. Returns `null` if the unit is
unknown, the number is not finite, the count is not an integer, the base quantity is `<= 0`, or the count is outside 1 to 1000.
Otherwise returns `{ quantity, unit, count }`.

### `export function parsePackSize(text)`

- **What it does.** Normalises the text (lowercase; `×` and `*` become `x`; a decimal comma `1,5` becomes `1.5`;
  trailing dots removed; spaces collapsed; trimmed). Returns `null` for non-strings, empty text, or text over 40
  characters. Then tries the patterns in order: count-first, size-first, pack-of, single.
- **Returns.** `{ quantity, unit, count }` or `null`.
- **Called by.** `packSizeFromAttributes`, `extractPackSize`; API `local-vendor-source.js`; `@localstock/external-data` `quality.js`; tests.

### `export function packSizeFromAttributes(attributes)`

- **What it does.** Looks through a variant's `attributes` object for a pack size, trying the keys `pack_size`, `packSize`,
  `net_quantity`, `netQuantity`, `size`, `weight`, `volume`, `quantity`, `count` in that order, and returns the first that
  parses. A bare number has no unit, so it is ignored, except under `count`, where `6` is read as `6 pcs`.
- **Returns.** `{ quantity, unit, count }` or `null` (also `null` if `attributes` is not an object).
- **Called by.** `backfillPackSizes`; API `catalog.routes.js` and `mapping-review.routes.js`; `@localstock/external-data` `matcher.js`.

### `export function extractPackSize(text)`

- **What it does.** Finds a pack size **inside** longer text, such as a product title or search query. First looks for a
  number with a unit (optionally with `N x` before or `x N` after); only if that fails, looks for `pack of N`. The match
  is then checked with `parsePackSize`.
- **Returns.** `{ packSize, phrase }`, where `phrase` is the matched text (so callers can strip it from the title), or
  `{ packSize: null, phrase: null }`.
- **Called by.** API `local-vendor-source.js`; `@localstock/external-data` `quality.js` and `matcher.js`.

### `export function samePackSize(a, b)`

- **What it does.** True only if both sizes are known and have the same `unit`, the same `count`, and the same `quantity`
  (to 3 decimals). An unknown size is never equal to anything, so callers treat it as "needs review".
- **Returns.** Boolean.
- **Called by.** API `compare.service.js` and `mapping-review.routes.js`; `@localstock/external-data` `matcher.js`.

## packages/database/src/domain/pack-size-backfill.js

**Purpose.** Bulk-fills `product_variants.pack_quantity`, `pack_unit` and `pack_count`.

### `export async function backfillPackSizes(pool, { all = false } = {})`

- **What it does.** In one transaction:
  1. Selects `id, attributes` from `product_variants` (only rows with `pack_quantity IS NULL`, unless `all`), locking them `FOR UPDATE`.
  2. Runs `packSizeFromAttributes` on each. In default mode, rows that do not parse are skipped. With `all`, every row is
     written, and rows that no longer parse get `NULL`s.
  3. Updates all chosen rows in a single `UPDATE ... FROM unnest(...)` statement.
  4. Commits. On error rolls back and re-throws. Always releases the client.
- **Returns.** `{ scanned, parsed, unparsed }`: rows selected, rows with a parsed size, and the difference.
- **Side effects.** Row locks on and updates to `product_variants`.
- **Called by.** `src/cli/backfill-pack-size.js`.

## packages/database/src/domain/text.js

### `export function normalizeText(value = '')`

- **What it does.** Normalises text so that formatting differences do not matter when comparing product names:
  Unicode NFKC normalisation, lowercase, every run of characters that are not letters, digits or `.` becomes one
  space, a digit followed by a space and a lowercase letter is joined (`"400 g"` becomes `"400g"`), and the result is trimmed.
- **Returns.** A string.
- **Called by.** API `catalog/product-matching.js` (variant identity keys); `@localstock/external-data` `matching.js` and `matcher.js`.

## packages/database/test-support/isolated-database.js

**Purpose.** Gives database tests their own throw-away database, so they never touch development data. Imported as
`@localstock/database/test-support`.

Constant: `SAFE_NAME = /^[a-z0-9_]+_test$/`.

### `export function testDatabaseUrl(env = process.env)`

- **What it does.** Returns `TEST_DATABASE_URL` if set. Otherwise, if `DATABASE_URL` is set, returns it with `_test`
  appended to the database name (`.../localstock` becomes `.../localstock_test`). Otherwise `undefined`.
- **Called by.** `prepareTestDatabase`; `apps/api/test-support/db-app.js`; the database tests (to decide whether to run).

### `async function ensureDatabaseExists(url)` (internal)

Connects to the `postgres` maintenance database on the same server, checks `pg_database`, and runs
`CREATE DATABASE "<name>"` if it is missing. The name has already been checked against `SAFE_NAME`.

### `export async function prepareTestDatabase({ max = 20 } = {})`

- **What it does.**
  1. Gets the URL from `testDatabaseUrl()`. If the database name does not end in `_test`, throws
     `Refusing to run database tests against "<name>": the database name must end in "_test".`
  2. Creates the database if needed, creates a pool, and runs `migrate(pool)`.
  3. Empties every table in the `public` schema except `schema_migrations` and `spatial_ref_sys` with
     `TRUNCATE ... RESTART IDENTITY CASCADE`.
- **Parameters.** `max`: pool size.
- **Returns.** The pool, connected to a clean, migrated test database.
- **Side effects.** May create a database; deletes all data in the test database. This is why database test files must run one at a time.
- **Called by.** `apps/api/test-support/db-app.js` (`createTestApi`), `packages/database/test/*.db.test.js` and
  `reservation.concurrency.test.js`, `packages/external-data/test/*.db.test.js`.

## Migrations

Files live in `packages/database/migrations/`. They are applied in name order by `migrate()` and recorded in
`schema_migrations`. Every migration except `001` has a `.down.sql` file that reverses it. See
[DATA_DICTIONARY.md](../DATA_DICTIONARY.md) for column details.

| File | What it adds |
|---|---|
| `001_init.sql` | Extensions `pgcrypto`, `postgis`, `pg_trgm`, and the core schema: users and refresh tokens, companies and members, customer addresses, catalogue (categories, product groups, product variants, images), seller offers, warehouses and `warehouse_inventory` (with a trigger that refuses stock for an offer from another company), inventory movements, delivery providers, orders, items, shipments, allocations, reservations, payments, idempotency keys, order status history, `outbox_events`, `inbox_events`, `webhook_events`, audit logs. No down file: it cannot be rolled back. |
| `002_external_platforms.sql` | Tables for observations of other quick-commerce platforms: `external_platforms` (with reference rows for Blinkit, Zepto, Swiggy Instamart, BigBasket, all disabled), sources, fulfilment nodes, listings, product mappings, collection jobs and runs, source health, and serviceability, price, availability, offer observations and change events. |
| `003_vendor_extensions.sql` | Additive vendor fields: `seller_offers.mrp_minor` (price may not exceed MRP), company `vendor_type` and `contact_phone`, warehouse `contact_phone` and `opening_hours`, `audit_logs.source_of_change`, and the parsed pack-size columns `pack_quantity`, `pack_unit`, `pack_count` on `product_variants`. |
| `004_collection_jobs.sql` | Allows the `SEARCH` job type on `external_collection_jobs` and adds indexes for "when did this work last succeed" and for finding stuck `RUNNING` jobs. |
| `005_retention_indexes.sql` | Indexes only, so the retention job can find old rows by time and check quickly whether a row is still referenced. |
| `006_offer_price_history.sql` | `seller_offer_price_history` table and a trigger on `seller_offers` that records every change of price, MRP or status; backfills one row per existing offer. |
| `007_external_canonical_products.sql` | Lets products discovered only on other platforms exist in the catalogue: `product_variants.group_id` becomes nullable, new `origin` (`LOCALSTOCK` or `EXTERNAL`) and `created_from_listing_id` columns, a check that only external products may lack a group and that `ACTIVE` products always have one, and the `NEW_CANONICAL` match method. |
| `008_payment_gateway.sql` | Razorpay support: `payments.provider_payment_id` becomes nullable, new `provider_charge_id`, `provider_refund_id`, `refund_attempted_at`, `last_checked_at` columns, and an index on open gateway payments (`PENDING`, `REFUND_PENDING`). |

---

# packages/payments

Package name `@localstock/payments`. Depends on `@localstock/database`. Script: `test` (`node --test`).
It talks to Razorpay in **test mode only**: keys that do not start with `rzp_test_` are refused.

## packages/payments/src/index.js

**Purpose.** Public API. Re-exports `createRazorpayGateway` and `RAZORPAY` (the string `'razorpay'`) from `gateway.js`,
and `createRazorpayClient`, `RazorpayError`, `verifyCheckoutSignature`, `verifyWebhookSignature` from `razorpay.js`.

### `export function razorpaySettings(env)`

- **What it does.** Reads Razorpay settings from an environment-like object (values are trimmed).
- **Parameters.** `env`: an object with optional `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- **Returns.** `null` if neither key is set. Otherwise `{ keyId, keySecret, webhookSecret }` (`webhookSecret` is `null` when unset).
- **Errors.** `RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set together`;
  `Only Razorpay test keys (rzp_test_...) are supported`.
- **Called by.** `apps/api/src/config/env.js` and `apps/worker/src/config.js` (both wrap the error into their own config error).

## packages/payments/src/razorpay.js

**Purpose.** A minimal Razorpay REST client (base URL `https://api.razorpay.com/v1`) and signature checks.
Amounts are in paise. Errors carry only Razorpay's error code and description, never the request, keys or customer data.

### `export class RazorpayError extends Error`

- **Constructor.** `new RazorpayError(status, code, description)`. Message `Razorpay <status> <code>: <description>`.
- **Fields.** `name = 'RazorpayError'`, `status` (HTTP status), `code` (Razorpay error code).

### `const hmac = (secret, data)` (internal)

Returns the hex-encoded HMAC-SHA256 of `data` with key `secret`.

### `function safeEqual(a, b)` (internal)

Compares two values as strings using `crypto.timingSafeEqual`, which takes the same time however many characters
match. This stops an attacker guessing a signature one character at a time by measuring response times. Returns
`false` if the lengths differ (or a value is missing).

### `export const verifyCheckoutSignature = ({ orderId, paymentId, signature }, keySecret)`

- **What it does.** Checks the signature Razorpay Checkout returns to the browser after payment:
  HMAC-SHA256 of `"<orderId>|<paymentId>"` with the key secret.
- **Returns.** Boolean.
- **Called by.** `apps/api/src/modules/payments/razorpay.routes.js` (checkout callback).

### `export const verifyWebhookSignature = (rawBody, signature, webhookSecret)`

- **What it does.** Checks the `X-Razorpay-Signature` header: HMAC-SHA256 of the **exact raw request body** with the webhook secret.
- **Returns.** Boolean.
- **Called by.** `razorpay.routes.js` (webhook endpoint).

### `export function createRazorpayClient({ keyId, keySecret, fetchImpl = fetch, timeoutMs = 10_000 })`

- **What it does.** Builds a client that authenticates with HTTP Basic auth (`keyId:keySecret`). The internal
  `call(method, path, body)` sends JSON with a `timeoutMs` abort signal, parses the JSON response (or `{}`), and throws
  `RazorpayError(status, error.code ?? 'UNKNOWN', error.description ?? 'request failed')` for non-2xx responses.
  A timeout rejects with the abort signal's `TimeoutError`.
- **Parameters.** `keyId`, `keySecret`; `fetchImpl` (tests pass a fake); `timeoutMs`.
- **Returns.** An object:

| Member | HTTP call | Returns |
|---|---|---|
| `keyId` | none | the key id (the browser checkout needs it) |
| `createOrder({ amount, currency, receipt, notes })` | `POST /orders` | the Razorpay order |
| `fetchOrder(orderId)` | `GET /orders/{id}` | the Razorpay order |
| `fetchOrderPayments(orderId)` | `GET /orders/{id}/payments` | array of payments (`items`, or `[]`) |
| `refundPayment(paymentId, { receipt, notes })` | `POST /payments/{id}/refund` with `speed: 'normal'` | the refund |
| `fetchPaymentRefunds(paymentId)` | `GET /payments/{id}/refunds` | array of refunds |
| `fetchRefund(refundId)` | `GET /refunds/{id}` | the refund |

- **Side effects.** Outbound HTTPS calls to Razorpay.
- **Called by.** `razorpay.routes.js` (unless a test passes its own client) and `apps/worker/src/start-worker.js`.

## packages/payments/src/gateway.js

**Purpose.** Connects Razorpay to LocalStock orders. Every path that learns a payment succeeded (webhook, browser
checkout callback, sync job) ends in `settlePayment` with the **same event id** `order.paid:<razorpayOrderId>`, so an
order is confirmed or refunded once, however many paths report it.

Constants: `export const PROVIDER = 'razorpay'`; `paidEventId(razorpayOrderId)` returns `` `order.paid:${razorpayOrderId}` ``.

In LocalStock's `payments` table, for Razorpay: `provider_payment_id` holds the Razorpay **order** id (`order_...`),
`provider_charge_id` the captured **payment** id (`pay_...`), `provider_refund_id` the refund id (`rfnd_...`).

### `export function createRazorpayGateway({ pool, client, logger })`

Creates the gateway. `client` is a `createRazorpayClient` object. Returns `{ findPayment, applyPaidOrder, checkOrder, ensureOrder, refundProcessed, sync }`.
Internal functions are described too.

#### `findPayment(razorpayOrderId)`

Selects `id, order_id, amount_minor` and the order's `currency` for the Razorpay payment whose `provider_payment_id`
equals `razorpayOrderId`. Returns that row or `null`. Used by `applyPaidOrder`.

#### `applyPaidOrder({ order, payment }, payload)`

- **What it does.** Applies a Razorpay order and payment (from a verified webhook or fetched from the API):
  - no matching LocalStock payment: `{ outcome: 'UNKNOWN_ORDER' }`;
  - order not `paid` or payment not `captured`: `{ outcome: 'NOT_PAID', orderId }`;
  - `order.amount_paid`, `order.currency` or `payment.order_id` does not match what LocalStock set: logs an error and
    returns `{ outcome: 'AMOUNT_MISMATCH', orderId }`; nothing is confirmed (left for manual review);
  - otherwise calls `settlePayment(pool, { provider: 'razorpay', eventId: 'order.paid:<id>', providerPaymentId: order.id, status: 'SUCCEEDED', chargeId: payment.id, payload })` and returns its result.
- **Called by.** `checkOrder`; `razorpay.routes.js` (webhook event `order.paid`).

#### `checkOrder(razorpayOrderId, source)`

- **What it does.** Fetches the order from Razorpay. If not `paid`, returns `{ outcome: 'NOT_PAID' }`. Otherwise fetches
  its payments, picks the `captured` one, and calls `applyPaidOrder` with a payload `{ source, razorpayOrderId, razorpayPaymentId }`.
- **Errors.** `RazorpayError` or timeout from the HTTP calls.
- **Called by.** `razorpay.routes.js` (checkout callback, `source = 'checkout'`) and `checkPendingPayments` (`'sync'`).

#### `refundSucceeded(paymentId, refundId, source)` (internal)

Calls `markRefunded(pool, { paymentId, refundId, source: 'payment:razorpay:<source>' })`.

#### `submitRefunds(limit)` (internal)

- **What it does.** Sends each pending refund to Razorpay once.
  1. In one statement, claims up to `limit` Razorpay payments that are `REFUND_PENDING`, have a `provider_charge_id`,
     no `provider_refund_id`, and no `refund_attempted_at` in the last 5 minutes, using `FOR UPDATE SKIP LOCKED`, and sets
     `refund_attempted_at = now()`. This "lease" keeps two workers from handling the same payment.
  2. For each: first asks Razorpay for existing refunds of the charge and reuses one that has not `failed` (so a retry
     after a crash never refunds twice); otherwise creates a refund (`receipt` = our payment id, `notes.orderId`).
  3. Stores `provider_refund_id` and `last_checked_at`. If the refund is already `processed`, calls `refundSucceeded`.
  4. Errors per payment are logged (`razorpay refund not sent, will retry`) with only the error code.
- **Returns.** Number of refunds sent or found.

#### `confirmRefunds(limit)` (internal)

- **What it does.** For up to `limit` `REFUND_PENDING` Razorpay payments with a `provider_refund_id`, not checked in the
  last minute: sets `last_checked_at`, fetches the refund, and
  - if `processed`: `refundSucceeded`;
  - if `failed`: logs an error and clears `provider_refund_id` and `refund_attempted_at` so `submitRefunds` tries again.
  Errors are logged as warnings.
- **Returns.** Nothing.

#### `checkPendingPayments(limit)` (internal)

- **What it does.** Finds payments neither the browser nor the webhook reported: Razorpay payments `PENDING` with a
  Razorpay order id, last updated over a minute ago, created in the last two days, and not checked in the last minute.
  For each, sets `last_checked_at` and calls `checkOrder(..., 'sync')`.
- **Returns.** How many ended `CONFIRMED` or `REFUND_PENDING`.

#### `ensureOrder({ paymentId, orderId, amountMinor, currency })`

- **What it does.** Returns the payment's Razorpay order id, creating it on the first Pay click. If `provider_payment_id`
  is already set, returns it. Otherwise calls `client.createOrder({ amount: amountMinor, currency, receipt: orderId, notes: { orderId } })`
  and stores the id with `coalesce(provider_payment_id, $2)`, so if two clicks race, the first stored id wins and is
  returned to both; the other Razorpay order is never shown or paid.
- **Errors.** `RazorpayError` / timeout.
- **Called by.** `razorpay.routes.js`.

#### `refundProcessed(refund)`

- **What it does.** For a Razorpay `refund.processed` webhook: finds our payment by `provider_charge_id = refund.payment_id`.
  If none, returns `{ outcome: 'UNKNOWN_PAYMENT' }`; otherwise calls `refundSucceeded(id, refund.id, 'webhook')`.
- **Called by.** `razorpay.routes.js`.

#### `sync({ limit = 20 } = {})`

- **What it does.** Runs `checkPendingPayments(limit)`, then `submitRefunds(limit)`, then `confirmRefunds(limit)`.
- **Returns.** `{ settled, refunds }`.
- **Called by.** The worker's `razorpay-sync` job.

---

# packages/allocation-engine

Package name `@localstock/allocation-engine`. Pure functions with no database or network access. Scripts: `test`,
`bench` (`node bench/allocate.bench.js`).

## How the allocator works, step by step

The allocator answers: "Given a cart, and the warehouses near the customer that stock these products, which
warehouses should send what, and with which delivery provider?" It is a **staged heuristic**: it tries simple plans
first and only moves to more complicated ones if needed. It does not search every possible combination, so it does
not promise the mathematically best plan.

1. **Merge the cart.** Lines with the same product are added together. Quantities must be positive integers.
2. **Index the warehouses.** Candidates for products not in the cart, or with no available stock, are ignored. For each
   warehouse, keep the **cheapest** candidate per product. Warehouses are sorted by id so results are repeatable.
3. **Stage A: one warehouse.** Every warehouse that has enough stock for every line becomes a plan (`SINGLE_WAREHOUSE`).
4. **Stage B: one warehouse per line.** Only if every line can be fully covered by at least one warehouse. It builds three plans (`WAREHOUSE_PER_LINE`):
   - a "consolidated" plan: repeatedly pick the warehouse that covers the most remaining lines (ties: lower cost, then
     nearer), to keep the number of shipments low (a greedy "set cover");
   - a "cheapest" plan: each line from the warehouse with the lowest line cost;
   - a "nearest" plan: each line from the nearest warehouse.
5. **Stage C: split quantities.** Only if splitting is allowed. Lines that one warehouse can cover go to one warehouse;
   other lines are filled piece by piece from several. It prefers warehouses already used in the plan (fewer shipments),
   then lower price, then shorter distance. If total stock is still not enough, there is no stage C plan.
6. **Skip duplicates.** Two plans with the same `(inventory row, quantity)` pairs are the same; only the first is kept.
7. **Attach delivery.** The plan is grouped into one shipment per warehouse. For each shipment, every delivery provider is
   quoted; ineligible providers are skipped. If any shipment has no eligible provider, the plan is dropped. Otherwise the
   plan gets totals: item cost, delivery fee, total landed cost, slowest ETA, shipment count, and risk.
8. **Stop early.** With `preferSingleWarehouse` (the default), the allocator stops after the first stage that produced at
   least one deliverable plan. So a single-warehouse plan always beats a split plan, even if the split is cheaper.
9. **Nothing worked?** If some plan had enough stock but no delivery, the answer is `NO_DELIVERY_PROVIDER`. Otherwise it
   is `INSUFFICIENT_STOCK` with a list of shortages.
10. **Rank.** The remaining plans are scored and sorted according to the chosen sort (`best_value`, `lowest_price`, `fastest`).
    The first one is `best`.

## packages/allocation-engine/src/index.js

**Purpose.** Public API: re-exports `allocate`, `SORTS` (from `allocate.js`), `DEFAULT_WEIGHTS` (from `scoring.js`) and `quoteProvider` (from `delivery.js`).

## packages/allocation-engine/src/util.js

### `export const compareIds = (a, b)`

Returns -1, 0 or 1 by plain `<` / `>` comparison. Used as the last tie-breaker everywhere so results are deterministic.

## packages/allocation-engine/src/allocate.js

`export const SORTS = ['best_value', 'lowest_price', 'fastest']` (frozen).

### `export function allocate({ items, candidates, providers = [], preferences = {}, weights = {}, options = {} })`

- **What it does.** Runs the algorithm described above.
- **Parameters.**
  - `items`: `[{ variantId, quantity }]`, non-empty.
  - `candidates`: `[{ inventoryId, warehouseId, companyId, offerId, variantId, unitPriceMinor, available, distanceMeters }]`.
    The caller must already have filtered these to active, in-service-area, in-radius warehouse and offer pairs.
  - `providers`: delivery providers `[{ id, type, companyId, baseFeeMinor, perKmFeeMinor, speedKmph, pickupMinutes?, reliability?, maxDistanceMeters?, maxUnits? }]`.
  - `preferences`: `{ allowSplit = true, preferSingleWarehouse = true, sort = 'best_value' }`.
  - `weights`: overrides for `DEFAULT_WEIGHTS`.
  - `options`: passed to `quoteProvider` (e.g. `roadFactor`).
- **Returns.**
  - Success: `{ status: 'OK', best, plans }`. Each plan has `key`, `strategy`, `shipments`, `itemsCostMinor`,
    `deliveryFeeMinor`, `totalLandedCostMinor`, `maxEtaMinutes`, `shipmentCount`, `risk`, `score`.
  - Failure: `{ status: 'UNAVAILABLE', reason: 'NO_DELIVERY_PROVIDER' | 'INSUFFICIENT_STOCK', shortages, plans: [] }`.
- **Errors.** `TypeError('Unknown sort: ...')`; `TypeError('items must be a non-empty array')`; `TypeError('Invalid quantity for <variantId>')`.
- **Called by.** API `checkout.routes.js` (quote) and `orders.service.js` (order placement; stock is re-checked under lock by `reserveInventory`); the benchmark; tests.

Internal functions:

| Function | What it does |
|---|---|
| `mergeLines(items)` | Validates items and sums quantities per `variantId`. Returns `[{ variantId, quantity }]`. |
| `indexWarehouses(candidates, lines)` | Builds `{ warehouseId, companyId, distanceMeters, stock: Map(variantId -> cheapest candidate) }` per warehouse, skipping unwanted products and `available <= 0`. Sorted by warehouse id. |
| `stockOf(wh, variantId)` | Available stock of that product in that warehouse (0 if none). |
| `covers(wh, line)` | True if the warehouse alone has enough for the line. |
| `lineCost(wh, line)` | `unitPriceMinor * quantity` at that warehouse. |
| `toAllocation(wh, variantId, quantity)` | Builds an allocation `{ warehouseId, companyId, distanceMeters, inventoryId, offerId, variantId, unitPriceMinor, quantity }`. |
| `planKey(allocations)` | Sorted `inventoryId:quantity` pairs joined with `|`; identifies duplicate plans and breaks ranking ties. |
| `singleWarehousePlans(lines, warehouses)` | Stage A. |
| `warehousePerLinePlans(lines, warehouses)` | Stage B; returns `[]` if any line has no covering warehouse, else the consolidated, cheapest and nearest plans. |
| `consolidatedPlan(lines, warehouses)` | Greedy set cover used by stage B. |
| `splitQuantitiesPlan(lines, warehouses)` | Stage C; returns `null` if stock runs out. |
| `findShortages(lines, warehouses, prefs)` | For each line: `INSUFFICIENT_STOCK` if total stock across warehouses is below the request; `SPLIT_NOT_ALLOWED` if splitting is off and no single warehouse has enough. Each entry is `{ variantId, requested, available, reason }`. |

## packages/allocation-engine/src/delivery.js

`DEFAULT_ROAD_FACTOR = 1.3`: road distance is estimated as straight-line distance times 1.3 until real routing exists.

### `export function quoteProvider(provider, shipment, { roadFactor = DEFAULT_ROAD_FACTOR } = {})`

- **What it does.** Prices one shipment with one provider. The provider is ineligible (returns `null`) if the
  shipment is farther than `maxDistanceMeters`, if the provider is a `SELLER_FLEET` of a different company, or if the
  shipment has more units than `maxUnits`.
- **Formula.** `roadKm = distanceMeters / 1000 * roadFactor`; `feeMinor = baseFeeMinor + round(perKmFeeMinor * roadKm)`;
  `etaMinutes = (pickupMinutes ?? 0) + ceil(roadKm / speedKmph * 60)`; `reliability` defaults to 1.
- **Returns.** `{ providerId, providerType, feeMinor, etaMinutes, reliability }` or `null`.
- **Called by.** `attachDelivery`; exported for other callers.

Internal helpers: `byFee` (fee, then ETA, then higher reliability, then id) and `byEta` (ETA, then fee, then reliability, then id).

### `function chooseQuote(quotes, sort, weights)` (internal)

Picks one quote: cheapest for `lowest_price`, fastest for `fastest`; for `best_value`, the lowest of
`cost * fee/maxFee + eta * eta/maxEta + risk * (1 - reliability)`, ties broken by `byFee`.

### `export function attachDelivery(draft, providers, sort, weights, options)`

- **What it does.** Groups the draft's allocations into one shipment per warehouse (`units`, `itemsCostMinor`, `lines`),
  quotes every provider for each shipment, and chooses one quote per shipment. Shipments are processed in warehouse id order.
- **Returns.** `null` if any shipment has no eligible provider. Otherwise a plan `{ key, strategy, shipments, itemsCostMinor, deliveryFeeMinor, totalLandedCostMinor, maxEtaMinutes, shipmentCount, risk }`,
  where `maxEtaMinutes` is the slowest shipment's ETA and `risk = 1 - (product of all shipments' reliabilities)`, rounded to 4 decimals.
- **Called by.** `allocate`.

## packages/allocation-engine/src/scoring.js

`export const DEFAULT_WEIGHTS = { cost: 0.45, eta: 0.3, shipments: 0.15, risk: 0.1 }` (frozen). These are tunable product
defaults. A lower score is better.

### `function normalizer(values)` (internal)

Returns a function that scales a value to 0..1 using the min and max of `values` ("min-max normalisation"). If all values are equal, it returns 0.

### `export function rankPlans(plans, sort, weights)`

- **What it does.** Gives each plan a `score` = weighted sum of its normalised total landed cost, max ETA, shipment
  count and risk (rounded to 4 decimals), then sorts:
  - `lowest_price`: total landed cost (items plus delivery), then ETA, then score, then key;
  - `fastest`: ETA, then total landed cost, then score, then key;
  - `best_value`: score, then total landed cost, then key.
- **Returns.** A new sorted array of plans with `score` added.
- **Called by.** `allocate`.

## packages/allocation-engine/bench/allocate.bench.js

**Purpose.** A micro-benchmark on synthetic data. Run with `npm run bench -w @localstock/allocation-engine`.

- Settings from environment variables: `WAREHOUSES` (default 50), `VARIANTS` (200), `CART_LINES` (8), `RUNS` (2000).
- A fixed-seed random generator (`rand`, a linear congruential generator with seed 42) makes the data the same every run.
- Builds candidates: each warehouse gets a random distance up to 15 km; each product appears with 60% probability, with a
  price of 2000 to 10000 paise and 0 to 6 units. Two providers: a platform fleet and a third party.
- For each run, builds a random cart and times `allocate`.
- Prints the dataset shape, the share of runs with status `OK`, p50/p95/p99 latency in ms, and the Node version. The
  file's comment asks that published numbers always mention the dataset shape.

---

# packages/logger

Package name `@localstock/logger`. A minimal structured JSON logger: one JSON object per line, so tools can parse the logs.

## packages/logger/src/index.js

Constants: `LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }`; `export const REDACTED = '[REDACTED]'`;
`SECRET_PARTS` (`password`, `passwd`, `secret`, `token`, `authorization`, `cookie`, `apikey`, `privatekey`, `signature`, `credential`);
`PERSONAL_KEYS` (`email`, `phone`, `contactphone`, `lat`, `lng`, `latitude`, `longitude`, `location`, `address`, `line1`, `line2`);
`MAX_DEPTH = 6`. Internal `normalizeKey(key)` lowercases and removes `_` and `-`.

### `export function isSensitiveKey(key)`

True if the normalised key is exactly one of `PERSONAL_KEYS`, or **contains** any of `SECRET_PARTS`. So `accessToken` and
`x-api-key` are hidden, while a key such as `customerId` is not.

### `export function redact(value, depth = 0)`

- **What it does.** Returns a copy of `value` where every property with a sensitive key is replaced by `[REDACTED]`, at any
  nesting depth. Arrays are processed element by element. Below depth 6, objects become `'[TRUNCATED]'`. Non-objects are returned unchanged. The input is not modified.
- **Called by.** `serialize` and `createLogger`; tests.

### `function serialize(fields = {})` (internal)

Copies `fields`; if `fields.err` is an `Error`, replaces it with `{ name, message, code, stack }` (errors do not
JSON-serialise on their own). Then redacts the result.

### `export function createLogger({ level = 'info', base = {} } = {})`

- **What it does.** Creates a logger. Entries below `level` are dropped (an unknown level falls back to `info`). Each entry
  is `{ time, level, msg, ...redacted base fields, ...serialized fields }`, written as one JSON line to **stderr** for
  `warn` and `error`, and to **stdout** for `debug` and `info`.
- **Returns.** `{ debug(msg, fields), info(msg, fields), warn(msg, fields), error(msg, fields), child(extra) }`.
  `child(extra)` returns a new logger with the same level and `base` merged with `extra` (e.g. `{ component: 'razorpay' }`).
- **Called by.** `apps/api/src/server.js`, `apps/worker/src/worker.js`, `deploy/all-in-one.mjs`, test helpers.

---

# packages/metrics

Package name `@localstock/metrics`. A dependency-free Prometheus metrics registry (text exposition format 0.0.4).
Label values must come from small fixed sets, never from user input, so the number of time series stays bounded.

## packages/metrics/src/index.js

Internal helpers:

| Helper | What it does |
|---|---|
| `escapeLabel(v)` | Escapes `\`, newline and `"` in a label value. |
| `labelText(labels)` | Renders `{k="v",...}`, or an empty string when there are no labels. |
| `canonical(labels)` | Returns the labels sorted by name, so one series always renders the same way. |
| `keyOf(labels)` | A string key for a label set (JSON of the sorted entries), used to find a series. |

`export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]` (seconds).

### `export function createRegistry({ prefix = 'localstock_' } = {})`

- **What it does.** Creates a registry. Every metric name is prefixed with `prefix`. It registers three built-in gauges:
  `process_uptime_seconds`, `process_heap_used_bytes`, `process_rss_bytes`.
- **Returns.** `{ counter, histogram, gauge, contentType, render }`:
  - `counter(name, help)` returns `{ inc(labels = {}, by = 1), render() }`. A counter only goes up.
  - `histogram(name, help, buckets = DEFAULT_BUCKETS)` returns `{ observe(labels, value), render() }`. Each observation
    increments every bucket whose upper bound is `>= value` (Prometheus buckets are cumulative), plus `sum` and `count`.
    Rendering adds the `+Inf` bucket, `_sum` and `_count`.
  - `gauge(name, help, collect)` returns `{ render() }`. `collect()` runs **at scrape time** and returns a number or
    `[{ labels, value }]`. If `collect` throws, the gauge renders only its `HELP`/`TYPE` lines, so one failing gauge does not break the whole scrape.
  - `contentType`: `text/plain; version=0.0.4; charset=utf-8`.
  - `render()`: renders every metric (in parallel) and joins the lines with newlines, ending in a newline.
- **Called by.** `apps/api/src/infrastructure/metrics.js`, `apps/worker/src/metrics.js`; tests.

### `export function metricsAccess({ token, production })`

- **What it does.** Returns `(authorizationHeader) => boolean`. If a `token` is configured, access needs exactly
  `Bearer <token>`. Without a token, metrics are readable only outside production.
- **Called by.** `apps/api/src/infrastructure/metrics.js`, `apps/worker/src/metrics.js`; tests.
