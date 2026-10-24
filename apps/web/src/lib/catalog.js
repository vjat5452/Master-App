import { get, qs } from './api.js';

const GROUPS_KEY = 'localstock.knownGroups';

// The API has no "list groups" endpoint. Groups are discovered from catalog variants
// (each variant carries its groupId) plus any groups this browser created.
export function rememberGroup(group) {
  try {
    const list = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]').filter((g) => g.id !== group.id);
    localStorage.setItem(GROUPS_KEY, JSON.stringify([...list, { id: group.id, name: group.name, categoryId: group.categoryId }]));
  } catch {
    // convenience cache only
  }
}

function rememberedGroups() {
  try {
    return JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export async function loadKnownGroups() {
  const byName = new Map();
  for (let page = 1; page <= 5; page++) {
    const res = await get(`/catalog/search${qs({ q: '', page, limit: 50 })}`, { auth: false });
    for (const item of res.items) if (!byName.has(item.group)) byName.set(item.group, item.variantId);
    if (page * res.limit >= res.total) break;
  }
  const fromCatalog = await Promise.all(
    [...byName.values()].map(async (variantId) => {
      const v = await get(`/catalog/variants/${variantId}`, { auth: false });
      return { id: v.groupId, name: v.groupName };
    }),
  );
  const all = new Map([...rememberedGroups(), ...fromCatalog].map((g) => [g.id, g]));
  return [...all.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Variants awaiting review aren't searchable, so remember the ones proposed from this browser.
const REVIEW_KEY = 'localstock.reviewQueue';
export function reviewQueue() {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_KEY) ?? '[]');
  } catch {
    return [];
  }
}
export function setReviewQueue(ids) {
  try {
    localStorage.setItem(REVIEW_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // convenience cache only
  }
}

export const searchVariants = (q) => get(`/catalog/search${qs({ q, limit: 20 })}`, { auth: false }).then((r) => r.items);
