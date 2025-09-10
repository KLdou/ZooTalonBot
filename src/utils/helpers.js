const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const logStream = fs.createWriteStream(
  path.resolve(__dirname, "../../logger/zoo-bot.log"),
  { flags: "a" }
);

function log(message) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;
  logStream.write(entry);
  console.log(entry.trim());
}

function confirmationKeyboard(key) {
  const buttons = [
    { text: "✅ Подтвердить", callback_data: JSON.stringify(key) },
    { text: "❌ Отказать", callback_data: JSON.stringify({ reject: true }) },
  ];
  return { reply_markup: { inline_keyboard: [buttons] } };
}

const payloadStore = new Map();

function storePayload(chatId, payload) {
  const key = `${chatId}_${Date.now()}_${crypto
    .randomBytes(4)
    .toString("hex")}`;
  payloadStore.set(key, payload);
  setTimeout(() => payloadStore.delete(key), 20 * 60 * 1000);
  return key;
}

function getPayload(key) {
  return payloadStore.get(key);
}

function existsPayload(key) {
  return payloadStore.has(key);
}

function removePayload(key) {
  return payloadStore.delete(key);
}

function formatPhoneNumber(phone) {
  // Проверяем, соответствует ли номер формату +375XXXXXXXXX
  if (!/^\+375\d{9}$/.test(phone)) {
    return phone; // Возвращаем как есть, если не соответствует
  }

  // Разбиваем номер на части и форматируем
  return phone.replace(
    /^(\+375)(\d{2})(\d{3})(\d{2})(\d{2})$/,
    "$1 $2 $3 $4 $5"
  );
}

function normalizePhoneNumber(phone) {
  // Удаляем все нецифровые символы
  const digitsOnly = phone.replace(/\D/g, "");

  // Если номер начинается с 80 и имеет 11 цифр (для Беларуси)
  if (digitsOnly.startsWith("80") && digitsOnly.length === 11) {
    return `+375${digitsOnly.substring(2)}`;
  }

  // Если номер уже в международном формате, оставляем как есть
  if (digitsOnly.startsWith("375") && digitsOnly.length === 12) {
    return `+${digitsOnly}`;
  }

  // Возвращаем исходный номер, если формат не распознан
  return phone;
}

module.exports = {
  log,
  confirmationKeyboard,
  storePayload,
  getPayload,
  removePayload,
  existsPayload,
  normalizePhoneNumber,
  formatPhoneNumber,
};
