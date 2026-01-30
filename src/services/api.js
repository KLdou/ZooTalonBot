const axios = require("axios");
const { log } = require("../utils/helpers");

const API_BASE = "https://server-eu-1.petapps.org/091d334e2bc5";
const API_TOKEN = process.env.API_COOKIE;

// Глобальный кеш для справочников
let refListCache = {
  types: { data: null, timestamp: null },
  clinics: { data: null, timestamp: null },
  goals: { data: null, timestamp: null }
};

// TTL кеша - 24 часа (справочники обновляются редко)
const CACHE_TTL = 24 * 60 * 60 * 1000;

async function fetchToken() {
  const { data } = await axios.get(`${API_BASE}/user/v1/token`, {
    headers: { Cookie: API_TOKEN },
  });
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
  clearRefListCache,
  createCoupon,
  createDocument,
};
