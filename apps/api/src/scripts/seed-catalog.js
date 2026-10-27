// Adds a realistic demo catalog on top of the base seed: ~70 real Indian grocery products with
// photos (from Open Food Facts), five more sellers across Delhi NCR, their warehouses, offers,
// stock and delivery fleets. Idempotent: existing rows are reused, never duplicated.
// Run after `npm run db:seed`:  npm run seed:catalog -w @localstock/api
import '../config/load-env.js';
import { readFile } from 'node:fs/promises';
import { Redis } from 'ioredis';
import { createPool, withTransaction } from '@localstock/database';
import { hashPassword } from '../modules/auth/passwords.js';
import { variantKey } from '../modules/catalog/product-matching.js';

const PASSWORD = process.env.SEED_PASSWORD ?? 'localstock-dev-password';
const dataset = JSON.parse(await readFile(new URL('./data/demo-catalog.json', import.meta.url), 'utf8'));

// priceFactor: share of the reference shelf price this seller charges (never above it, like MRP).
// coverage: share of the catalog the seller lists.
const SELLERS = [
  { company: 'FreshMart Noida', existing: true, prefix: 'FM', priceFactor: 0.96, coverage: 0.55 },
  { company: 'Daily Needs Delhi', existing: true, prefix: 'DN', priceFactor: 0.93, coverage: 0.6 },
  {
    company: 'Gurgaon Fresh Bazaar', prefix: 'GFB', priceFactor: 0.95, coverage: 0.75,
    owner: ['Chetan (Gurgaon Fresh)', 'seller.c@localstock.dev'],
    warehouses: [['Cyber City', 28.495, 77.089, 25], ['Sohna Road', 28.4231, 77.043, 20]],
    fleet: ['Gurgaon Fresh Riders', 1800, 600, 22, 15, 0.88, 15],
  },
  {
    company: 'Dwarka Kirana Co.', prefix: 'DKC', priceFactor: 0.92, coverage: 0.6,
    owner: ['Divya (Dwarka Kirana)', 'seller.d@localstock.dev'],
    warehouses: [['Dwarka Sector 10', 28.5815, 77.059, 18], ['Janakpuri', 28.6219, 77.0878, 15]],
  },
  {
    company: 'Rohini SuperMart', prefix: 'RSM', priceFactor: 0.97, coverage: 0.7,
    owner: ['Ehsaan (Rohini SuperMart)', 'seller.e@localstock.dev'],
    warehouses: [['Rohini Sector 9', 28.716, 77.11, 18], ['Pitampura', 28.699, 77.138, 15]],
    fleet: ['Rohini Express', 1500, 550, 24, 12, 0.9, 12],
  },
  {
    company: 'East Delhi Grocers', prefix: 'EDG', priceFactor: 0.94, coverage: 0.65,
    owner: ['Farah (East Delhi Grocers)', 'seller.f@localstock.dev'],
    warehouses: [['Laxmi Nagar', 28.6304, 77.2772, 15], ['Mayur Vihar', 28.6045, 77.295, 12]],
  },
  {
    company: 'Saket Gourmet Pantry', prefix: 'SGP', priceFactor: 1.0, coverage: 0.9,
    owner: ['Gauri (Saket Gourmet)', 'seller.g@localstock.dev'],
    warehouses: [['Saket', 28.5245, 77.2066, 14]],
    fleet: ['Gourmet Pantry Couriers', 2500, 700, 30, 8, 0.97, 14],
  },
];

// Small deterministic PRNG so every run produces the same prices and stock.
function rng(seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const point = (lat, lng) => `SRID=4326;POINT(${lng} ${lat})`;
const stats = { categories: 0, groups: 0, variants: 0, images: 0, companies: 0, warehouses: 0, offers: 0, stockRows: 0, fleets: 0 };

async function seed(client) {
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];
  const passwordHash = await hashPassword(PASSWORD);

  // Taxonomy: every category hangs under "Grocery".
  const grocery =
    (await one(`SELECT id FROM categories WHERE slug = 'grocery'`)) ??
    (await one(`INSERT INTO categories (name, slug) VALUES ('Grocery', 'grocery') RETURNING id`));
  const categoryIds = {};
  for (const [slug, name] of Object.entries(dataset.categories)) {
    const found = await one('SELECT id FROM categories WHERE slug = $1', [slug]);
    if (found) categoryIds[slug] = found.id;
    else {
      categoryIds[slug] = (await one('INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING id', [name, slug, grocery.id])).id;
      stats.categories++;
    }
  }
  const groupIds = {};
  for (const [name, slug] of Object.entries(dataset.groups)) {
    const found = await one('SELECT id FROM product_groups WHERE category_id = $1 AND lower(name) = lower($2)', [categoryIds[slug], name]);
    if (found) groupIds[name] = found.id;
    else {
      groupIds[name] = (await one('INSERT INTO product_groups (category_id, name) VALUES ($1, $2) RETURNING id', [categoryIds[slug], name])).id;
      stats.groups++;
    }
  }

  // Variants (matched by barcode, like the catalog API) and their images.
  const products = [];
  for (const p of dataset.products) {
    let variant = await one('SELECT id FROM product_variants WHERE barcode = $1', [p.barcode]);
    if (!variant) {
      const key = variantKey({ brand: p.brand, name: p.name, attributes: p.attributes });
      variant =
        (await one('SELECT id FROM product_variants WHERE normalized_key = $1', [key])) ??
        (await one(
          `INSERT INTO product_variants (group_id, brand, name, attributes, barcode, normalized_key)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [groupIds[p.group], p.brand, p.name, JSON.stringify(p.attributes), p.barcode, key],
        ));
      stats.variants++;
    }
    const { rowCount } = await client.query('SELECT 1 FROM product_images WHERE variant_id = $1', [variant.id]);
    if (!rowCount) {
      await client.query('INSERT INTO product_images (variant_id, image_url) VALUES ($1, $2)', [variant.id, p.image]);
      stats.images++;
    }
    products.push({ ...p, variantId: variant.id });
  }

  // Sellers, warehouses, fleets, offers and stock.
  for (const s of SELLERS) {
    let company = await one('SELECT id FROM companies WHERE name = $1', [s.company]);
    if (!company && s.existing) {
      console.warn(`skipping ${s.company}: run the base seed first`);
      continue;
    }
    if (!company) {
      const [ownerName, email] = s.owner;
      const user =
        (await one('SELECT id FROM users WHERE lower(email) = lower($1)', [email])) ??
        (await one('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id', [ownerName, email, passwordHash]));
      company = await one('INSERT INTO companies (name) VALUES ($1) RETURNING id', [s.company]);
      await client.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'OWNER') ON CONFLICT DO NOTHING`, [company.id, user.id]);
      stats.companies++;
    }

    for (const [name, lat, lng, radiusKm] of s.warehouses ?? []) {
      const { rowCount } = await client.query('SELECT 1 FROM warehouses WHERE company_id = $1 AND name = $2', [company.id, name]);
      if (!rowCount) {
        await client.query('INSERT INTO warehouses (company_id, name, location, service_radius_m) VALUES ($1, $2, $3::geography, $4)', [
          company.id,
          name,
          point(lat, lng),
          radiusKm * 1000,
        ]);
        stats.warehouses++;
      }
    }
    if (s.fleet) {
      const [name, base, perKm, speed, pickup, reliability, maxKm] = s.fleet;
      const { rowCount } = await client.query('SELECT 1 FROM delivery_providers WHERE company_id = $1 AND name = $2', [company.id, name]);
      if (!rowCount) {
        await client.query(
          `INSERT INTO delivery_providers
             (company_id, name, type, base_fee_minor, per_km_fee_minor, speed_kmph, pickup_minutes, reliability, max_distance_m)
           VALUES ($1, $2, 'SELLER_FLEET', $3, $4, $5, $6, $7, $8)`,
          [company.id, name, base, perKm, speed, pickup, reliability, maxKm * 1000],
        );
        stats.fleets++;
      }
    }

    const { rows: warehouses } = await client.query(`SELECT id, name FROM warehouses WHERE company_id = $1 AND status = 'ACTIVE' ORDER BY name`, [company.id]);
    for (const p of products) {
      // One stream per seller+product, so each decision is the same on every run
      // regardless of what earlier runs already inserted.
      const rand = rng(`${s.company}|${p.barcode}`);
      if (rand() > s.coverage) continue;
      // Price: the seller's level ±4%, rounded to the rupee, never above the reference price.
      const rupees = Math.min(p.priceMinor / 100, Math.max(1, Math.round((p.priceMinor / 100) * s.priceFactor * (0.96 + rand() * 0.08))));
      const offer = await one(
        `INSERT INTO seller_offers (company_id, variant_id, seller_sku, price_minor) VALUES ($1, $2, $3, $4)
         ON CONFLICT (company_id, variant_id) DO NOTHING RETURNING id`,
        [company.id, p.variantId, `${s.prefix}-${p.barcode}`, rupees * 100],
      );
      if (!offer) continue; // already listed by an earlier run
      stats.offers++;

      for (const w of warehouses) {
        if (rand() < 0.2) continue; // not every warehouse stocks every product
        const roll = rand();
        const onHand = roll < 0.12 ? 1 + Math.floor(rand() * 5) : 8 + Math.floor(rand() * 72); // ~12% low stock
        const inv = await one(
          `INSERT INTO warehouse_inventory (warehouse_id, offer_id, on_hand) VALUES ($1, $2, $3)
           ON CONFLICT (warehouse_id, offer_id) DO NOTHING RETURNING id`,
          [w.id, offer.id, onHand],
        );
        if (inv) {
          await client.query(`INSERT INTO inventory_movements (inventory_id, on_hand_delta, reason, note) VALUES ($1, $2, 'RESTOCK', 'demo catalog seed')`, [inv.id, onHand]);
          stats.stockRows++;
        }
      }
    }
  }
}

const pool = createPool(process.env.DATABASE_URL, { max: 1 });
try {
  await withTransaction(pool, seed, { retries: 0 });
  console.log('demo catalog seeded:', stats);
  console.log(`new seller logins (password "${PASSWORD}"): seller.c … seller.g @localstock.dev`);
  // Search results are cached in Redis; bump the version so the new catalog shows immediately.
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await redis.connect().then(() => redis.incr('search:version')).catch(() => console.warn('redis unavailable; search cache expires within 30 s'));
  redis.disconnect();
} catch (err) {
  console.error('demo catalog seed failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
