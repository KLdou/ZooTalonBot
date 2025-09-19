// Универсальный сервис для работы с LLM-провайдерами (ollama, openrouter)
// Выбор провайдера через process.env.LLM_PROVIDER ("ollama" или "openrouter")

const { logError } = require('../utils/helpers');
const provider = process.env.LLM_PROVIDER || 'ollama';

// Константа для количества попыток при неудачном парсинге JSON
const MAX_RETRY_ATTEMPTS = 2;

let llm;
if (provider === 'openrouter') {
  llm = provider === 'openrouter' ? require('./openrouter') : require('./ollama');
} else {
  llm = require('./ollama');
}

async function parseUserMessage(text, retryCount = 0) {
  const prompt = `You are the registrar of an organization dedicated to helping homeless animals.\n
You will get text data where each line should be mapped to property of json object. 
Order of lines in message can be different. Be sure that every property is filled.\n
Return only json without any explanations.\n
You need to find out\n 
1.Surname, First Name, Patronymic (should be saved as one string as fio property in json)\n2.Address (should be address property in json)\n3.Phone (should be phone property in json)\n4.Name of Veterinary Clinic (should be clinic property in json)\n5.Date of visit (should be date property in json)\n6.Type of animal, e.g. Cat or dog (should be animal_type property in json)\n7.Name of animal (should be animal_name property in json)\n8.Type of treatment: Sterilization, treatment (should be type property in json)\nCheck message below \n"""${text}""".\n`;
  const response = await llm.sendPrompt(prompt);
  const match = response.match(/\{.*\}/s);
  if (!match) {
    if (retryCount < MAX_RETRY_ATTEMPTS) {
      return await parseUserMessage(text, retryCount + 1);
    }
    throw new Error(`LLM response does not contain valid JSON after ${MAX_RETRY_ATTEMPTS} attempts: ${response}`);
  }
  const jsonObject = JSON.parse(match[0]);
  return await reFillEmptyProperties(text, jsonObject);
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
  const response = await llm.sendPrompt(prompt);
  const match = response.match(/\{.*\}/s);
  if (!match) {
    if (retryCount < MAX_RETRY_ATTEMPTS) {
      return await reFillEmptyProperties(text, jsonObject, retryCount + 1);
    }
    throw new Error(`LLM response does not contain valid JSON for reFillEmptyProperties after ${MAX_RETRY_ATTEMPTS} attempts: ${response}`);
  }
  const result = JSON.parse(match[0]);
  return mergeWithOverrideEmpty(jsonObject, result);
}

function findEmptyOrNullKeys(obj) {
  return Object.keys(obj).filter((key) => {
    const value = obj[key];
    return value === null || value === undefined || value === "";
  });
}

function findExtraLines(text, jsonObject) {
  const lines = text.trim().split("\n").map((line) => line.trim());
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
  const prompt = `Список: ${JSON.stringify(documents)}. Есть ли документ на животное ${name} от ${fio} в этом году? Верни JSON вида { exist: true, documentId: '', name: '' }`;
  const response = await llm.sendPrompt(prompt);
  try {
    const match = response.match(/\{.*\}/s);
    if (!match) {
      if (retryCount < MAX_RETRY_ATTEMPTS) {
        return await findDocument(documents, fio, name, retryCount + 1);
      }
      return { exist: false };
    }
    return JSON.parse(match[0]);
  } catch {
    return { exist: false };
  }
}

function stringsMatch80Percent(str1, str2) {
  str1 = (str1 || "").toLowerCase();
  str2 = (str2 || "").toLowerCase();
  const len1 = str1.length;
  const len2 = str2.length;
  if (len1 === 0 && len2 === 0) return true;
  if (len1 === 0 || len2 === 0) return false;
  const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));
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
          matrix[i - 1][j - 1] + 1
        );
      }
    }
  }
  const maxLength = Math.max(len1, len2);
  const distance = matrix[len1][len2];
  const similarity = (maxLength - distance) / maxLength;
  return similarity >= 0.8;
}

async function matchEntity(entityType, list, query, retryCount = 0) {
  const foundItem = list.find(
    (item) => item.name && query && item.name.toLowerCase() === query.toLowerCase()
  );
  if (foundItem) {
    return {
      name: foundItem.name,
      id: foundItem.id !== undefined ? foundItem.id : foundItem._id,
    };
  }
  const prompt = `Найди соответствующий объект для "${query}" скорее всего это поле name в списке объектов типа ${entityType}:\n   ${JSON.stringify(list)}\n Обязательно верни JSON с name вида { name: '' }. Верни только JSON без пояснений.`;
  const response = await llm.sendPrompt(prompt);
  try {
    const match = response.match(/\{.*\}/s);
    if (!match) {
      if (retryCount < MAX_RETRY_ATTEMPTS) {
        return await matchEntity(entityType, list, query, retryCount + 1);
      }
      return { id: "", name: "" };
    }
    const ollamaResponse = JSON.parse(match[0]);
    const foundItem = list.find(
      (item) =>
        item.name &&
        ollamaResponse.name &&
        item.name.toLowerCase() === ollamaResponse.name.toLowerCase()
    );
    if (foundItem) {
      return {
        name: foundItem.name,
        id: foundItem.id !== undefined ? foundItem.id : foundItem._id,
      };
    }
    return { id: "", name: "" };
  } catch (e) {
    logError(`Error in findObjectInArray for query "${query}"`, e);
    return { id: "", name: "" };
  }
}

async function askSimpleQuestion(text) {
  const response = await llm.sendPrompt(text);
  try {
    return response;
  } catch {
    return "";
  }
}

async function formatAddress(address) {
  return askSimpleQuestion(
    `Перепиши адрес "${address}" в официальном стиле с сокращениями: 
    "ул." вместо "улица"
    "д." вместо "дом"
    "кв." вместо "квартира"
    "г." вместо "город"`
  );
}

async function formatGoal(type) {
  return askSimpleQuestion(
    `Просклоняй причину обращения "${type}" в творительный падеж.
    Ответ должен содержать 1-3 слова. Ответ должен НЕ содержать "прошу помочь с". Без кавычек и точек.`
  );
}

async function formatPet(animalType, animalName) {
  return askSimpleQuestion(
    `Перечисли в именительном падеже используя тип животного с маленькой буквы ${animalType.toLowerCase()} 
    и его кличку или клички(если их несколько через запятую) ${animalName}.
    Например "кот Василий" или "кошка Плюша, кошка Марина"`
  );
}

async function formatMonth(today) {
  return askSimpleQuestion(
    `Сегодня ${today}. Напиши одним словом в родительном падеже название текущего месяца на русском языке. Только одно слово, без кавычек и точек.`
  );
}

async function formatShortFio(fio) {
  return askSimpleQuestion(
    `Преобразуй полное ФИО в формат "Фамилия И.О.". Верни только результат преобразования без дополнительных пояснений. 
Примеры:
1. Вход: "Иванов Петр Сергеевич" → Выход: "Иванов П.С."
2. Вход: "Смирнова Анна Викторовна" → Выход: "Смирнова А.В."
3. Вход: "Петров-Водкин Константин Дмитриевич" → Выход: "Петров-Водкин К.Д."
Теперь преобразуй: ${fio}`
  );
}

module.exports = {
  parseUserMessage,
  findDocument,
  matchEntity,
  askSimpleQuestion,
  formatAddress,
  formatGoal,
  formatPet,
  formatMonth,
  formatShortFio,
};
