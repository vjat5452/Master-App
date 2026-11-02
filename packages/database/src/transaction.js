// Deadlock and serialization failures are safe to retry as a whole transaction.
const RETRYABLE_CODES = new Set(['40001', '40P01']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withTransaction(pool, fn, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      if (RETRYABLE_CODES.has(err.code) && attempt < retries) {
        await sleep(20 * 2 ** attempt + Math.random() * 20);
        continue;
      }
      throw err;
    } finally {
      client.release(broken);
    }
  }
}
