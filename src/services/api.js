const axios = require("axios");

const API_BASE = "https://server-eu-1.petapps.org/091d334e2bc5";
const API_TOKEN = process.env.API_COOKIE;

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
  getRefList,
  createCoupon,
  createDocument,
};
