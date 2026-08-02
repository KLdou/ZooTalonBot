const axios = require("axios");
const { log } = require("../utils/helpers");

const API_BASE = "https://server-eu-1.petapps.org/091d334e2bc5";
const API_TOKEN = process.env.API_COOKIE;
const TOKEN_CACHE_TTL = 3 * 60 * 1000;
let tokenCache = { value: null, timestamp: 0 };

// Глобальный кеш для справочников
let refListCache = {
  types: { data: null, timestamp: null },
  clinics: { data: null, timestamp: null },
  goals: { data: null, timestamp: null }
};

// TTL кеша - 24 часа (справочники обновляются редко)
const CACHE_TTL = 24 * 60 * 60 * 1000;

async function fetchToken() {
  const now = Date.now();
  if (tokenCache.value && now - tokenCache.timestamp < TOKEN_CACHE_TTL) {
    return tokenCache.value;
  }

  const { data } = await axios.get(`${API_BASE}/user/v1/token`, {
    headers: { Cookie: API_TOKEN },
  });
  tokenCache = { value: data.access_token, timestamp: now };
  return data.access_token;
}

async function getDocuments(animalName, token) {
  const res = await axios.get(`${API_BASE}/document-secured/v1/document`, {
    params: {
      offset: 0,
      limit: 20,
      type: "ADMISSION_APPLICATION",
      text: animalName,
    },
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.items.map((i) => ({
    name: i.name,
    date: i.effectiveDate,
    documentId: i._id,
  }));
}

async function getDocumentsWithSearch(animalName, token) {
  const res = await axios.get(`${API_BASE}/document-secured/v1/search`, {
    params: {
      text: animalName,
    },
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.map((i) => ({
    name: i.name,
    date: i.date,
    documentId: i._id,
  }));
}

async function getRefList(endpoint, token) {
  const res = await axios.get(`${API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

/**
 * Получение справочника с кешированием
 * @param {string} endpoint - Эндпоинт API
 * @param {string} token - Токен авторизации
 * @param {string} cacheKey - Ключ для кеша (types, clinics, goals)
 * @returns {Promise<Array>} - Массив элементов справочника
 */
async function getRefListCached(endpoint, token, cacheKey) {
  const now = Date.now();
  const cached = refListCache[cacheKey];
  
  // Проверяем, есть ли валидный кеш
  if (cached && cached.data && (now - cached.timestamp) < CACHE_TTL) {
    log(`Cache HIT for ${cacheKey}`);
    return cached.data;
  }
  
  // Запрашиваем свежие данные
  log(`Cache MISS for ${cacheKey} - fetching fresh data`);
  const data = await getRefList(endpoint, token);
  
  // Сохраняем в кеш
  refListCache[cacheKey] = {
    data: data,
    timestamp: now
  };
  
  return data;
}

async function getCouponRefListsCached(token) {
  const [types, clinics, goals] = await Promise.all([
    getRefListCached("/coupon-secured/v1/type", token, "types"),
    getRefListCached("/coupon-secured/v1/vet", token, "clinics"),
    getRefListCached("/coupon-secured/v1/goal?type=", token, "goals"),
  ]);

  return { types, clinics, goals };
}

/**
 * Очистка кеша справочников (для ручного сброса админами)
 */
function clearRefListCache() {
  refListCache = {
    types: { data: null, timestamp: null },
    clinics: { data: null, timestamp: null },
    goals: { data: null, timestamp: null }
  };
  log('Reference list cache cleared');
}

async function createCoupon(payload, token) {
  const res = await axios.put(`${API_BASE}/coupon-secured/v1/coupon`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { name: res.data.name, couponId: res.data._id };
}

// TTL кеша для списка талонов - 10 минут
const COUPONS_CACHE_TTL = 10 * 60 * 1000;
let couponsCache = new Map();

/**
 * Очистка кеша талонов
 */
function clearCouponsCache() {
  couponsCache.clear();
  log("Coupons cache cleared");
}

/**
 * Получение списка талонов с пагинацией и кешированием на 10 минут
 * @param {string} token - Токен авторизации
 * @param {Object} [options] - Параметры фильтрации (year, month, limit)
 * @returns {Promise<Array>} - Массив полученных талонов
 */
async function getCoupons(token, options = {}) {
  const limit = options.limit || 100;
  const targetYear = options.year;
  const targetMonth = options.month;

  const cacheKey = `${targetYear ?? "all"}_${targetMonth ?? "all"}`;
  const now = Date.now();
  const cached = couponsCache.get(cacheKey);

  if (cached && (now - cached.timestamp) < COUPONS_CACHE_TTL) {
    log(`Cache HIT for coupons (${cacheKey})`);
    return cached.data;
  }

  log(`Cache MISS for coupons (${cacheKey}) - fetching fresh data`);

  let offset = 0;
  let allCoupons = [];
  let stopFetching = false;

  while (!stopFetching) {
    const res = await axios.get(`${API_BASE}/coupon-secured/v1/coupon`, {
      params: { offset, limit },
      headers: { Authorization: `Bearer ${token}` },
    });

    const items = res.data?.items || [];
    const count = res.data?.count || 0;

    if (items.length === 0) {
      break;
    }

    let itemsOlderThanPeriod = 0;

    for (const item of items) {
      const rawDateStr = item.effectiveDate || item.bookedAt;
      const d = rawDateStr ? new Date(rawDateStr) : null;
      const itemYear = item.year || (d ? d.getFullYear() : null);
      const itemMonth = d ? d.getMonth() + 1 : null;

      let matchesYear = true;
      if (targetYear !== undefined && targetYear !== null) {
        matchesYear = itemYear === targetYear;
      }

      let matchesMonth = true;
      if (targetMonth !== undefined && targetMonth !== null) {
        matchesMonth = itemMonth === targetMonth;
      }

      if (matchesYear && matchesMonth) {
        allCoupons.push(item);
      }

      if (targetYear !== undefined && targetYear !== null) {
        if (itemYear !== null && itemYear < targetYear) {
          itemsOlderThanPeriod++;
        } else if (itemYear === targetYear && targetMonth !== undefined && targetMonth !== null) {
          if (itemMonth !== null && itemMonth < targetMonth) {
            itemsOlderThanPeriod++;
          }
        }
      }
    }

    if (items.length > 0 && itemsOlderThanPeriod === items.length) {
      stopFetching = true;
    }

    offset += limit;
    if (offset >= count) {
      break;
    }
  }

  couponsCache.set(cacheKey, {
    data: allCoupons,
    timestamp: now,
  });

  return allCoupons;
}

async function createDocument(payload, token) {
  const res = await axios.put(
    `${API_BASE}/document-secured/v1/document`,
    payload,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return { name: `${res.data.pet} - ${res.data.applicant}`, documentId: res.data._id };
}
module.exports = {
  fetchToken,
  getDocuments,
  getDocumentsWithSearch,
  getRefList,
  getRefListCached,
  getCouponRefListsCached,
  clearRefListCache,
  createCoupon,
  getCoupons,
  clearCouponsCache,
  createDocument,
};
