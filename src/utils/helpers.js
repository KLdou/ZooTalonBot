const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const logFilePath = path.resolve(__dirname, "../../logger/zoo-bot.log");
const logDir = path.dirname(logFilePath);
let logStream;
try {
  // Убедимся, что директория для логов существует
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  logStream = fs.createWriteStream(logFilePath, { flags: "a" });
} catch (e) {
  // Если не удалось создать поток в файл (например, из-за прав),
  // используем резервный объект, который пишет в stdout.
  console.warn(`Logger: cannot write to ${logFilePath}, falling back to console.`, e);
  logStream = { write: (msg) => process.stdout.write(msg) };
}

function log(message) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;
  logStream.write(entry);
  console.log(entry.trim());
}

function logError(message, error) {
  const timestamp = new Date().toISOString();
  const stack = new Error().stack;
  const callerLine = stack.split('\n')[2]?.trim() || 'unknown location';
  
  let errorDetails = '';
  if (error) {
    errorDetails = error.stack || error.message || error.toString();
  }
  
  const entry = `[${timestamp}] ERROR: ${message}\nLocation: ${callerLine}\nDetails: ${errorDetails}\n`;
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
const editSessionStore = new Map();

function storePayload(chatId, payload) {
  const key = `${chatId}_${Date.now()}_${crypto
    .randomBytes(4)
    .toString("hex")}`;
  payloadStore.set(key, payload);
  setTimeout(() => payloadStore.delete(key), 60 * 60 * 1000);
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

/**
 * Сохранение сессии редактирования с данными и справочниками
 * @param {number} chatId - ID чата
 * @param {Object} baseData - Данные пользователя
 * @param {Object} errors - Объект с ошибками валидации
 * @param {Object} refLists - Закешированные справочники (types, clinics, goals)
 * @returns {string} - Ключ сессии
 */
function storeEditSession(chatId, baseData, errors, refLists) {
  const sessionKey = `edit_${chatId}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  
  editSessionStore.set(sessionKey, {
    key: sessionKey,
    baseData: { ...baseData },
    errors: { ...errors },
    editingField: null,
    chatId: chatId,
    refLists: refLists || null
  });
  
  // Автоматическое удаление через 30 минут
  setTimeout(() => editSessionStore.delete(sessionKey), 30 * 60 * 1000);
  
  return sessionKey;
}

/**
 * Получение сессии редактирования по ключу
 * @param {string} sessionKey - Ключ сессии
 * @returns {Object|undefined} - Объект сессии или undefined
 */
function getEditSession(sessionKey) {
  return editSessionStore.get(sessionKey);
}

/**
 * Получение активной сессии редактирования для данного чата
 * @param {number} chatId - ID чата
 * @returns {Object|null} - Объект сессии или null
 */
function getActiveEditSession(chatId) {
  // Находим активную сессию редактирования для данного чата
  for (const [key, session] of editSessionStore.entries()) {
    if (session.chatId === chatId) {
      return session;
    }
  }
  return null;
}

/**
 * Обновление сессии редактирования
 * @param {string} sessionKey - Ключ сессии
 * @param {Object} updatedSession - Обновлённый объект сессии
 */
function updateEditSession(sessionKey, updatedSession) {
  editSessionStore.set(sessionKey, updatedSession);
}

/**
 * Удаление сессии редактирования
 * @param {string} sessionKey - Ключ сессии
 * @returns {boolean} - true если сессия была удалена
 */
function removeEditSession(sessionKey) {
  return editSessionStore.delete(sessionKey);
}

module.exports = {
  log,
  logError,
  confirmationKeyboard,
  storePayload,
  getPayload,
  removePayload,
  existsPayload,
  normalizePhoneNumber,
  formatPhoneNumber,
  storeEditSession,
  getEditSession,
  getActiveEditSession,
  updateEditSession,
  removeEditSession,
};
