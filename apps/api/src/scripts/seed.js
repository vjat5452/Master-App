// Demo data around Delhi/Noida: two sellers, four warehouses, a small catalog and three
// delivery providers (platform fleet, third party, one seller fleet). Safe to re-run.
import '../config/load-env.js';
import { createPool, withTransaction } from '@localstock/database';
import { variantKey } from '../modules/catalog/product-matching.js';
import { hashPassword } from '../modules/auth/passwords.js';

const PASSWORD = process.env.SEED_PASSWORD ?? 'localstock-dev-password';
const point = (lat, lng) => `SRID=4326;POINT(${lng} ${lat})`;

const pool = createPool(process.env.DATABASE_URL, { max: 1 });

try {
  const { rows: existing } = await pool.query(`SELECT 1 FROM users WHERE email = 'admin@localstock.dev'`);
  if (existing.length) {
    console.log('seed data already present; nothing to do');
  } else {
    await withTransaction(pool, seed, { retries: 0 });
    // The password is printed only when it is the public development default.
    console.log(`seeded. Users (password ${process.env.SEED_PASSWORD ? 'from SEED_PASSWORD' : `"${PASSWORD}"`}):`);
    console.log('  admin@localstock.dev    platform admin');
    console.log('  seller.a@localstock.dev owner of FreshMart Noida');
    console.log('  seller.b@localstock.dev owner of Daily Needs Delhi');
    console.log('  customer@localstock.dev customer');
  }
} catch (err) {
  console.error('seed failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

async function seed(client) {
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];
  const passwordHash = await hashPassword(PASSWORD);

  const user = (name, email, role = 'USER') =>
    one('INSERT INTO users (name, email, password_hash, platform_role) VALUES ($1, $2, $3, $4) RETURNING id', [name, email, passwordHash, role]);
  await user('Platform Admin', 'admin@localstock.dev', 'ADMIN');
  const sellerA = await user('Asha (FreshMart)', 'seller.a@localstock.dev');
  const sellerB = await user('Bilal (Daily Needs)', 'seller.b@localstock.dev');
  await user('Chitra Customer', 'customer@localstock.dev');

  const company = async (name, ownerId) => {
    const c = await one('INSERT INTO companies (name) VALUES ($1) RETURNING id', [name]);
    await client.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [c.id, ownerId]);
    return c.id;
  };
  const freshMart = await company('FreshMart Noida', sellerA.id);
  const dailyNeeds = await company('Daily Needs Delhi', sellerB.id);

  const warehouse = async (companyId, name, lat, lng, radiusKm) =>
    (await one(
      `INSERT INTO warehouses (company_id, name, location, service_radius_m) VALUES ($1, $2, $3::geography, $4) RETURNING id`,
      [companyId, name, point(lat, lng), radiusKm * 1000],
    )).id;
  const noida18 = await warehouse(freshMart, 'Noida Sector 18', 28.5708, 77.3261, 15);
  const noida62 = await warehouse(freshMart, 'Noida Sector 62', 28.627, 77.3727, 15);
  const cp = await warehouse(dailyNeeds, 'Connaught Place', 28.6315, 77.2167, 12);
  const lajpat = await warehouse(dailyNeeds, 'Lajpat Nagar', 28.5677, 77.2433, 12);

  const grocery = await one(`INSERT INTO categories (name, slug) VALUES ('Grocery', 'grocery') RETURNING id`);
  const bakery = await one(`INSERT INTO categories (name, slug, parent_id) VALUES ('Bakery', 'bakery', $1) RETURNING id`, [grocery.id]);
  const dairy = await one(`INSERT INTO categories (name, slug, parent_id) VALUES ('Dairy', 'dairy', $1) RETURNING id`, [grocery.id]);
  const bread = await one(`INSERT INTO product_groups (category_id, name) VALUES ($1, 'Bread') RETURNING id`, [bakery.id]);
  const milk = await one(`INSERT INTO product_groups (category_id, name) VALUES ($1, 'Milk') RETURNING id`, [dairy.id]);

  const variant = async (groupId, brand, name, attributes, barcode) =>
    (await one(
      `INSERT INTO product_variants (group_id, brand, name, attributes, barcode, normalized_key) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [groupId, brand, name, JSON.stringify(attributes), barcode, variantKey({ brand, name, attributes })],
    )).id;
  const wheat400 = await variant(bread.id, 'Brand X', 'Whole Wheat Bread', { weight: '400 g' }, '8900000000011');
  const wheat700 = await variant(bread.id, 'Brand X', 'Whole Wheat Bread', { weight: '700 g' }, '8900000000028');
  const multigrain = await variant(bread.id, 'Brand Y', 'Multigrain Bread', { weight: '400 g' }, '8900000000035');
  const tonedMilk = await variant(milk.id, 'Brand M', 'Toned Milk', { volume: '1 l' }, '8900000000042');

  const offer = async (companyId, variantId, sku, priceMinor) =>
    (await one('INSERT INTO seller_offers (company_id, variant_id, seller_sku, price_minor) VALUES ($1, $2, $3, $4) RETURNING id', [companyId, variantId, sku, priceMinor])).id;
  const stock = async (warehouseId, offerId, onHand) => {
    const inv = await one('INSERT INTO warehouse_inventory (warehouse_id, offer_id, on_hand) VALUES ($1, $2, $3) RETURNING id', [warehouseId, offerId, onHand]);
    await client.query(`INSERT INTO inventory_movements (inventory_id, on_hand_delta, reason, note) VALUES ($1, $2, 'RESTOCK', 'seed')`, [inv.id, onHand]);
  };

  const fmWheat400 = await offer(freshMart, wheat400, 'FM-WW400', 5500);
  const fmWheat700 = await offer(freshMart, wheat700, 'FM-WW700', 8500);
  const fmMilk = await offer(freshMart, tonedMilk, 'FM-MILK1L', 6600);
  const dnWheat400 = await offer(dailyNeeds, wheat400, 'DN-0001', 5200);
  const dnMulti = await offer(dailyNeeds, multigrain, 'DN-0002', 6000);
  const dnMilk = await offer(dailyNeeds, tonedMilk, 'DN-0003', 6800);

  await stock(noida18, fmWheat400, 18);
  await stock(noida18, fmMilk, 40);
  await stock(noida62, fmWheat400, 6);
  await stock(noida62, fmWheat700, 12);
  await stock(cp, dnWheat400, 3);
  await stock(cp, dnMilk, 25);
  await stock(lajpat, dnWheat400, 10);
  await stock(lajpat, dnMulti, 8);

  const provider = (companyId, name, type, base, perKm, speed, pickup, reliability, maxKm) =>
    client.query(
      `INSERT INTO delivery_providers
         (company_id, name, type, base_fee_minor, per_km_fee_minor, speed_kmph, pickup_minutes, reliability, max_distance_m)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [companyId, name, type, base, perKm, speed, pickup, reliability, maxKm * 1000],
    );
  await provider(null, 'LocalStock Fleet', 'PLATFORM_FLEET', 2500, 800, 25, 10, 0.95, 20);
  await provider(null, 'QuickDrop', 'THIRD_PARTY', 3000, 600, 30, 15, 0.9, 30);
  await provider(freshMart, 'FreshMart Riders', 'SELLER_FLEET', 1500, 500, 20, 20, 0.85, 10);
}
