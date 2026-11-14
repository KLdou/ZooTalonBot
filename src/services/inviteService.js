const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { log, logError } = require("../utils/helpers");

const DATA_DIR = path.resolve(__dirname, "../../data");
const INVITES_FILE = path.join(DATA_DIR, "invites.json");

const DEFAULT_TTL_HOURS = 24;

let invitesCache = new Map();
let isInitialized = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadInvites() {
  ensureDataDir();
  if (!fs.existsSync(INVITES_FILE)) {
    invitesCache = new Map();
    isInitialized = true;
    return;
  }

  try {
    const raw = fs.readFileSync(INVITES_FILE, "utf-8");
    const data = JSON.parse(raw);
    invitesCache = new Map(Object.entries(data));
    isInitialized = true;
  } catch (error) {
    logError("Ошибка чтения файла invites.json, инициализируем пустой кэш", error);
    invitesCache = new Map();
    isInitialized = true;
  }
}

function saveInvites() {
  ensureDataDir();
  try {
    const obj = Object.fromEntries(invitesCache);
    fs.writeFileSync(INVITES_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch (error) {
    logError("Ошибка сохранения invites.json", error);
  }
}

function initIfNeeded() {
  if (!isInitialized) {
    loadInvites();
  }
}

/**
 * Создание нового инвайта
 * @param {Object} params
 * @param {number} params.createdBy - Telegram ID администратора
 * @param {string} [params.creatorName] - Имя/username администратора
 * @param {string} [params.label] - Пометка для кого/зачем инвайт
 * @param {number} [params.ttlHours=24] - Срок действия в часах
 * @param {number} [params.maxUses=1] - Количество разрешенных использований
 * @returns {Object} объект созданного инвайта
 */
function createInvite({ createdBy, creatorName = "", label = "", ttlHours = DEFAULT_TTL_HOURS, maxUses = 1 }) {
  initIfNeeded();

  const code = `inv_${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  const invite = {
    code,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ttlHours,
    createdBy,
    creatorName,
    label: (label || "").trim(),
    maxUses: Math.max(1, parseInt(maxUses, 10) || 1),
    usedCount: 0,
    usedBy: [],
    status: "active", // "active" | "used" | "revoked" | "expired"
  };

  invitesCache.set(code, invite);
  saveInvites();
  log(`Создан инвайт ${code} админом ${createdBy} (${creatorName}) на ${ttlHours}ч. Метка: "${label}"`);

  return invite;
}

/**
 * Получение инвайта по коду
 * @param {string} code
 * @returns {Object|null}
 */
function getInvite(code) {
  initIfNeeded();
  if (!code || typeof code !== "string") return null;
  const cleanCode = code.trim();
  return invitesCache.get(cleanCode) || null;
}

/**
 * Проверка валидности инвайта
 * @param {string} code
 * @returns {{ valid: boolean, reason?: string, invite?: Object }}
 */
function validateInvite(code) {
  initIfNeeded();
  const invite = getInvite(code);

  if (!invite) {
    return {
      valid: false,
      reason: "Приглашение не найдено. Проверьте правильность ссылки.",
    };
  }

  if (invite.status === "revoked") {
    return {
      valid: false,
      reason: "Это приглашение было отозвано администратором.",
      invite,
    };
  }

  const now = new Date();
  const expiresAt = new Date(invite.expiresAt);
  if (now > expiresAt) {
    if (invite.status === "active") {
      invite.status = "expired";
      saveInvites();
    }
    return {
      valid: false,
      reason: "Срок действия этого приглашения истёк (действовало 24 часа).",
      invite,
    };
  }

  if (invite.usedCount >= invite.maxUses || invite.status === "used") {
    return {
      valid: false,
      reason: "Это приглашение уже было использовано для оформления заявки.",
      invite,
    };
  }

  return { valid: true, invite };
}

/**
 * Фиксация использования инвайта
 * @param {string} code
 * @param {Object} user - { id, username, first_name }
 * @returns {{ success: boolean, invite?: Object, error?: string }}
 */
function consumeInvite(code, user) {
  initIfNeeded();
  const validation = validateInvite(code);
  if (!validation.valid) {
    return { success: false, error: validation.reason, invite: validation.invite };
  }

  const invite = validation.invite;
  invite.usedCount += 1;
  invite.usedBy.push({
    userId: user?.id || null,
    username: user?.username || "",
    firstName: user?.first_name || "",
    usedAt: new Date().toISOString(),
  });

  if (invite.usedCount >= invite.maxUses) {
    invite.status = "used";
  }

  saveInvites();
  log(`Инвайт ${code} успешно использован пользователем ${user?.id} (${user?.username || user?.first_name})`);
  return { success: true, invite };
}

/**
 * Получение списка активных инвайтов
 * @returns {Array<Object>}
 */
function listActiveInvites() {
  initIfNeeded();
  const now = new Date();
  const result = [];

  for (const invite of invitesCache.values()) {
    if (invite.status === "active") {
      const expiresAt = new Date(invite.expiresAt);
      if (now > expiresAt) {
        invite.status = "expired";
      } else {
        result.push(invite);
      }
    }
  }

  saveInvites();
  return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Отзыв инвайта администратором
 * @param {string} code
 * @param {number} [revokedBy]
 * @returns {boolean}
 */
function revokeInvite(code, revokedBy) {
  initIfNeeded();
  const invite = getInvite(code);
  if (!invite) return false;

  invite.status = "revoked";
  invite.revokedAt = new Date().toISOString();
  if (revokedBy) invite.revokedBy = revokedBy;

  saveInvites();
  log(`Инвайт ${code} отозван админом ${revokedBy}`);
  return true;
}

/**
 * Очистка для тестов
 */
function _clearForTests() {
  invitesCache.clear();
  isInitialized = true;
  if (fs.existsSync(INVITES_FILE)) {
    try {
      fs.unlinkSync(INVITES_FILE);
    } catch (_) {}
  }
}

module.exports = {
  createInvite,
  getInvite,
  validateInvite,
  consumeInvite,
  listActiveInvites,
  revokeInvite,
  DEFAULT_TTL_HOURS,
  _clearForTests,
};
