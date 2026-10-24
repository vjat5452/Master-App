// k6 run scripts/k6/search.js   (publish dataset shape and hardware with any results)
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:5000';
const QUERIES = ['bread', 'whole wheat bread', 'milk', 'multigrain'];

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300'],
  },
};

export default function () {
  const q = encodeURIComponent(QUERIES[Math.floor(Math.random() * QUERIES.length)]);
  const res = http.get(`${BASE}/api/v1/catalog/search?q=${q}&lat=28.6129&lng=77.2295&radiusKm=20&page=1&limit=20`);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response has items': (r) => {
      try {
        return Array.isArray(r.json('items'));
      } catch (_) {
        return false;
      }
    },
  });
  sleep(1);
}
