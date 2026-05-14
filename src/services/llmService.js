// Универсальный сервис для работы с LLM-провайдерами (ollama, openrouter, ollamacloud)
// Выбор провайдера через process.env.LLM_PROVIDER или динамически через setProvider()

const { log, logError } = require("../utils/helpers");

const PROVIDERS = ["ollama", "openrouter", "ollamacloud"];
let currentProvider = process.env.LLM_PROVIDER || "openrouter";

// Константа для количества попыток при неудачном парсинге JSON
const MAX_RETRY_ATTEMPTS = 2;
const ENTITY_STOP_WORDS = new Set([
  "клиника",
  "ветклиника",
  "лечебница",
  "больница",
  "ветеринарная",
  "вет",
]);

const USER_MESSAGE_FIELDS = [
  "fio",
  "address",
  "phone",
  "clinic",
  "date",
  "animal_type",
  "coat_color",
  "animal_name",
  "place",
  "type",
];

// Кеш для matchEntity с TTL 30 минут
const matchEntityCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 минут в миллисекундах

function getCacheKey(entityType, query) {
  return `${entityType}:${query}`;
}

function isExpired(timestamp) {
  return Date.now() - timestamp > CACHE_TTL_MS;
}

function getCachedResult(entityType, query) {
  const key = getCacheKey(entityType, query);
  const cached = matchEntityCache.get(key);

  if (cached && !isExpired(cached.timestamp)) {
    return cached.result;
  }

  // Удаляем устаревшую запись
  if (cached) {
    matchEntityCache.delete(key);
  }

  return null;
}

function setCachedResult(entityType, query, result) {
  const key = getCacheKey(entityType, query);
  matchEntityCache.set(key, {
    result: result,
    timestamp: Date.now(),
  });
}

function ensureUserMessageFields(jsonObject) {
  const result = { ...jsonObject };
  for (const field of USER_MESSAGE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) {
      result[field] = null;
    }
  }
  return result;
}

// Пытаемся безопасно извлечь JSON-объект из произвольного текста ответа LLM.
// Учтены случаи с Markdown-кодовыми блоками (```json ... ```), а также
// поиск первого корректно сбалансированного блока {...}.
function extractJsonFromText(text) {
  if (!text || typeof text !== "string") return null;
  // Убираем кодовые блоки ```json ... ``` или ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    text = fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) return null;

  // Ищем корректно сбалансированный JSON по скобкам (поддерживает вложенные объекты)
  let depth = 0;
  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;

    if (depth === 0) {
      const candidate = text.slice(firstBrace, i + 1);
      try {
        return JSON.parse(candidate);
      } catch (e) {
        // Если парсинг не удался — возможно LLM вернул невалидный JSON.
        // В этом случае возвращаем null — вызывающий код обработает повторную попытку.
        return null;
      }
    }
  }

  return null;
}

const providerLoaders = {
  openrouter: () => require("./openrouter"),
  ollamacloud: () => require("./ollamaCloud"),
  ollama: () => require("./ollama"),
};
const loadedProviders = {};

function getLlm() {
  const providerName = PROVIDERS.includes(currentProvider)
    ? currentProvider
    : "openrouter";
  if (!loadedProviders[providerName]) {
    loadedProviders[providerName] = providerLoaders[providerName]();
  }
  return loadedProviders[providerName];
}

function getProvider() {
  return currentProvider;
}

function setProvider(name) {
  if (!PROVIDERS.includes(name)) {
    throw new Error(`Unknown provider: ${name}. Available: ${PROVIDERS.join(", ")}`);
  }
  currentProvider = name;
  log(`LLM provider switched to: ${name}`);
}

async function parseUserMessage(text, retryCount = 0) {
  const prompt = `You are the registrar of an organization dedicated to helping homeless animals.\n
You will get text data where each line should be mapped to property of json object. 
Order of lines in message can be different. Be sure that every property is filled.\n
Return only json without any explanations.\n
You need to find out\n 
1.Surname, First Name, Patronymic (should be saved as one string as fio property in json)\n
2.Address (should be address property in json)\n
3.Phone (should be phone property in json)\n
4.Name of Veterinary Clinic (should be clinic property in json)\n
5.Date of visit (should be date property in json)\n
6.Type of animal, e.g. Cat or dog (should be animal_type property in json)\n
7.Сoat color, e.g. Black, White, Tricolor, Point (should be coat_color property in json)\n
8.Name of animal (should be animal_name property in json)\n
9.Information, where animal was found(should be place property in json)\n
10.Type of treatment: Sterilization, treatment (should be type property in json)\n
Check message below \n"""${text}""".\n`;
  const response = await getLlm().sendPrompt(prompt);
  const jsonObject = extractJsonFromText(response);
  if (!jsonObject) {
    if (retryCount < MAX_RETRY_ATTEMPTS) {
      return await parseUserMessage(text, retryCount + 1);
    }
    throw new Error(
      `LLM response does not contain valid JSON after ${MAX_RETRY_ATTEMPTS} attempts: ${response}`,
    );
  }
  return await reFillEmptyProperties(text, ensureUserMessageFields(jsonObject));
}

async function reFillEmptyProperties(text, jsonObject, retryCount = 0) {
  const emptyProperties = findEmptyOrNullKeys(jsonObject);
  if (emptyProperties.length === 0) return jsonObject;
  const lines = findExtraLines(text, jsonObject);
  const prompt = `Ты — интеллектуальный парсер текста. Твоя задача — проанализировать входной текст и заполнить указанные поля JSON, сопоставляя наиболее подходящие строки из текста с именами полей.

У тебя есть:
1. Массив строк текста (возможно, с опечатками, лишними пробелами или неупорядоченными данными).
2. Список имён полей JSON, которые ранее были пустыми (null/undefined/""), и которые нужно заполнить.

Твоя цель:
- Для каждого имени поля из списка найди **наиболее релевантную** строку из текста, которая логически может быть его значением.
- Учитывай контекст, смысл и тип данных (например, имя человека, дата, адрес, тип животного и т.д.).
- Не добавляй лишних полей. Не изменяй имена полей.
- Не выдумывай данные. Используй ТОЛЬКО строки из предоставленного массива.
- Если для поля нет подходящей строки — оставь значение как null.
- Верни результат строго в формате JSON: { "поле1": "значение1", "поле2": "значение2", ... }

Правила:
- Сопоставление должно быть логичным и обоснованным.
- Одну строку текста можно использовать только один раз.
- Сохраняй оригинальное написание строки (не меняй регистр, не обрезай, если не указано иное).
- Если несколько полей могут подойти к одной строке — выбери наилучшее соответствие.

Пример входных данных:
Текст: [
  "Друг",
  "АВ3116680"
]
Пустые поля: ["clinic"]

Ожидаемый вывод:
{
  "clinic": "Друг"
}

Теперь выполни задачу для следующих данных:

Текст: ${lines.join()}
Пустые поля: ${emptyProperties.join()}

Верни ТОЛЬКО JSON-объект без пояснений.`;
  const response = await getLlm().sendPrompt(prompt);
  const resultObj = extractJsonFromText(response);
  if (!resultObj) {
    if (retryCount < MAX_RETRY_ATTEMPTS) {
      return await reFillEmptyProperties(text, jsonObject, retryCount + 1);
    }
    throw new Error(
      `LLM response does not contain valid JSON for reFillEmptyProperties after ${MAX_RETRY_ATTEMPTS} attempts: ${response}`,
    );
  }
  return mergeWithOverrideEmpty(jsonObject, resultObj);
}

function findEmptyOrNullKeys(obj) {
  return Object.keys(obj).filter((key) => {
    const value = obj[key];
    return value === null || value === undefined || value === "";
  });
}

function findExtraLines(text, jsonObject) {
  const lines = text
    .trim()
    .split("\n")
    .map((line) => line.trim());
  const jsonValues = Object.values(jsonObject)
    .filter((val) => val !== null && val !== undefined)
    .map((val) => String(val).trim());
  return lines.filter((line) => {
    return !jsonValues.some((value) => stringsMatch80Percent(line, value));
  });
}

function mergeWithOverrideEmpty(mainObj, overrideObj) {
  const result = { ...mainObj };
  for (const key in overrideObj) {
    if (overrideObj.hasOwnProperty(key)) {
      const mainValue = mainObj[key];
      const overrideValue = overrideObj[key];
      if (mainValue === null || mainValue === undefined || mainValue === "") {
        if (overrideValue !== undefined) {
          result[key] = overrideValue;
        }
      }
    }
  }
  return result;
}

async function findDocument(documents, fio, name, retryCount = 0) {
  const possibleName = `${name} - ${fio}`;

  const possibleDocument = findBestDocumentMatch(documents, possibleName);
  if (possibleDocument) {
    return {
      exist: true,
      documentId: possibleDocument.documentId,
      name: possibleDocument.name,
    };
  }

  const prompt = `Список: ${JSON.stringify(
    documents,
  )}. Есть ли документ на животное ${name} от ${fio} в этом году? Верни JSON вида { exist: true, documentId: '', name: '' }`;
  const response = await getLlm().sendPrompt(prompt);
  try {
    const parsed = extractJsonFromText(response);
    if (!parsed) {
      if (retryCount < MAX_RETRY_ATTEMPTS) {
        return await findDocument(documents, fio, name, retryCount + 1);
      }
      return { exist: false };
    }
    return parsed;
  } catch {
    return { exist: false };
  }
}

function stringsMatch80Percent(str1, str2, persent = 80) {
  str1 = (str1 || "").toLowerCase();
  str2 = (str2 || "").toLowerCase();
  const len1 = str1.length;
  const len2 = str2.length;
  if (len1 === 0 && len2 === 0) return true;
  if (len1 === 0 || len2 === 0) return false;
  const matrix = Array(len1 + 1)
    .fill()
    .map(() => Array(len2 + 1).fill(0));
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1,
        );
      }
    }
  }
  const maxLength = Math.max(len1, len2);
  const distance = matrix[len1][len2];
  const similarity = (maxLength - distance) / maxLength;
  return similarity >= persent / 100;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeEntityName(value) {
  return normalizeText(value)
    .split(" ")
    .filter((word) => word && !ENTITY_STOP_WORDS.has(word))
    .join(" ");
}

function compactNormalized(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function similarityRatio(str1, str2) {
  str1 = String(str1 || "").toLowerCase();
  str2 = String(str2 || "").toLowerCase();
  const maxLength = Math.max(str1.length, str2.length);
  if (maxLength === 0) return 1;
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len1 + 1)
    .fill()
    .map(() => Array(len2 + 1).fill(0));
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  for (let i = 1; i < len1 + 1; i++) {
    for (let j = 1; j < len2 + 1; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1,
        );
      }
    }
  }
  return (maxLength - matrix[len1][len2]) / maxLength;
}

function findBestDocumentMatch(documents, possibleName) {
  const normalizedPossibleName = compactNormalized(possibleName);
  let bestMatch = null;
  let bestScore = 0;

  for (const document of documents || []) {
    const normalizedDocumentName = compactNormalized(document.name);
    const score = similarityRatio(normalizedPossibleName, normalizedDocumentName);
    if (score > bestScore) {
      bestMatch = document;
      bestScore = score;
    }
  }

  return bestScore >= 0.95 ? bestMatch : null;
}

function findBestEntityMatch(list, query) {
  const normalizedQuery = normalizeEntityName(query);
  const compactQuery = compactNormalized(normalizedQuery);
  if (!compactQuery) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const item of list || []) {
    if (!item.name) continue;
    const normalizedName = normalizeEntityName(item.name);
    const compactName = compactNormalized(normalizedName);
    if (!compactName) continue;

    if (compactName === compactQuery) {
      return item;
    }

    const containsScore =
      compactName.length >= 3 && compactQuery.includes(compactName)
        ? 0.9
        : 0;
    const distanceScore = similarityRatio(compactQuery, compactName);
    const score = Math.max(containsScore, distanceScore);

    if (score > bestScore) {
      bestMatch = item;
      bestScore = score;
    }
  }

  return bestScore >= 0.88 ? bestMatch : null;
}

async function matchEntity(entityType, list, query, retryCount = 0) {
  // Проверяем кеш только для успешных запросов (retryCount = 0)
  if (retryCount === 0) {
    const cachedResult = getCachedResult(entityType, query);
    if (cachedResult) {
      return cachedResult;
    }
  }

  let foundItem = findBestEntityMatch(list, query);
  if (foundItem) {
    const result = {
      name: foundItem.name,
      id: foundItem.id !== undefined ? foundItem.id : foundItem._id,
    };

    setCachedResult(entityType, query, result);

    return result;
  }
  const prompt = `Найди соответствующий объект для "${query}" скорее всего это поле name в списке объектов типа ${entityType}:\n   ${JSON.stringify(
    list,
  )}\n .Очисти "${query}" от адреса и названия типа заведения(клиника, лечебница, больница), например "клиника Алешка ул. Строителей" должно искать как "Алешка"
  \n Иногда объекты в списке могут содержать знаки препинания, сокращения или незначительные опечатки, которые не должны мешать правильному сопоставлению.
  \n Верни целое значение name из списка, которое наиболее точно соответствует запросу.
  \n Обязательно верни JSON с name вида { id:'', name: '' }. Верни только JSON без пояснений.`;
  const response = await getLlm().sendPrompt(prompt);
  try {
    const ollamaResponse = extractJsonFromText(response);
    if (!ollamaResponse) {
      if (retryCount < MAX_RETRY_ATTEMPTS) {
        return await matchEntity(entityType, list, query, retryCount + 1);
      }
      const fallbackResult = { id: "", name: "" };

      return fallbackResult;
    }
    foundItem = list.find(
      (item) =>
        item.name &&
        ollamaResponse.name &&
        item.name.toLowerCase() === ollamaResponse.name.toLowerCase(),
    );
    if (foundItem) {
      const result = {
        name: foundItem.name,
        id: foundItem.id !== undefined ? foundItem.id : foundItem._id,
      };
      setCachedResult(entityType, query, result);

      return result;
    }

    foundItem = list.find(
      (item) =>
        (item.id || item._id) === (ollamaResponse.id || ollamaResponse._id),
    );
    if (foundItem) {
      const result = {
        name: foundItem.name,
        id: foundItem.id !== undefined ? foundItem.id : foundItem._id,
      };
      setCachedResult(entityType, query, result);

      return result;
    }

    const fallbackResult = { id: "", name: "" };

    return fallbackResult;
  } catch (e) {
    logError(`Error in findObjectInArray for query "${query}"`, e);
    const errorResult = { id: "", name: "" };

    return errorResult;
  }
}

async function askSimpleQuestion(text) {
  const response = await getLlm().sendPrompt(text);
  try {
    return response;
  } catch {
    return "";
  }
}

async function formatAddress(address) {
  return askSimpleQuestion(
    `Приведи адрес «${address}» к официальному формату, используя общепринятые сокращения:
«ул.» вместо «улица»,
«д.» вместо «дом»,
«кв.» вместо «квартира»,
«г.» вместо «город».
Сохрани исходный порядок элементов адреса и не добавляй пояснений — выведи только преобразованный адрес.`,
  );
}

async function formatFoundPlace(place) {
  const sourcePlace = String(place || "").trim();
  if (!sourcePlace) {
    return "";
  }

  const response = await askSimpleQuestion(
    `Преобразуй текст места, где найдено животное: "${sourcePlace}".
Верни ТОЛЬКО фразу, которая может завершить предложение: "Животное было найдено ...".
Если это адрес, то приведи его к официальному формату, используя общепринятые сокращения:
«ул.» вместо «улица»,
«д.» вместо «дом» или «деревня» в зависимости от контекста,
«г.» вместо «город».
При этом оставь поясняющие слова, если они есть, например "возле", "рядом с", "на территории" и т.д. 
Сохрани исходный смысл и порядок слов, но сократи адресные компоненты и не добавляй пояснений — выведи только преобразованный адрес.
Не возвращай начало предложения, кавычки и точку в конце. Сохрани исходный смысл.`,
  );

  let formattedPlace = String(response || "").trim();
  formattedPlace = formattedPlace.replace(/^["'\s]+|["'\s]+$/g, "");
  formattedPlace = formattedPlace.replace(
    /^(?:the\s+animal\s+was\s+found|животное\s+было\s+найдено|zhivotnoe\s+bylo\s+naideno)\s*/iu,
    "",
  );
  formattedPlace = formattedPlace.replace(/^\.\s*/, "").trim();

  return formattedPlace || sourcePlace;
}

async function formatGoal(type) {
  return askSimpleQuestion(
    `Просклоняй причину обращения "${type}" в творительный падеж.
    Ответ должен содержать 1-3 слова. Ответ должен НЕ содержать "прошу помочь с". Без кавычек и точек.`,
  );
}

async function formatPet(animalType, coatColor, animalName) {
  const type = String(animalType || "").trim().toLowerCase();
  const color = String(coatColor || "").trim();
  const names = Array.isArray(animalName)
    ? animalName.filter(Boolean).join(", ")
    : String(animalName || "").trim();

  return [type, color, names].filter(Boolean).join(" ");
}

async function formatMonth(today) {
  const months = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ];
  const date = today instanceof Date ? today : new Date(today || Date.now());
  return months[date.getMonth()];
}

async function formatShortFio(fio) {
  const parts = String(fio || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) {
    return parts.join(" ");
  }

  const [surname, ...names] = parts;
  const initials = names.map((part) => `${part[0].toUpperCase()}.`).join("");
  return `${surname} ${initials}`;
}

module.exports = {
  parseUserMessage,
  findDocument,
  matchEntity,
  askSimpleQuestion,
  formatAddress,
  formatFoundPlace,
  formatGoal,
  formatPet,
  formatMonth,
  formatShortFio,
  getProvider,
  setProvider,
  PROVIDERS,
};
