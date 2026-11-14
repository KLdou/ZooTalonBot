const { fetchToken, getCouponRefListsCached } = require("../../services/api");
const { validateInvite, consumeInvite } = require("../../services/inviteService");
const { validateFIO, validateAddress } = require("../../utils/validators");
const {
  log,
  logError,
  normalizePhoneNumber,
  formatPhoneNumber,
  getAllowedUsers,
  storePayload,
} = require("../../utils/helpers");

const wizardSessions = new Map();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 часа

const STEPS = [
  { id: "fio", title: "ФИО заявителя" },
  { id: "phone", title: "Номер телефона" },
  { id: "address", title: "Адрес заявителя" },
  { id: "animal_type", title: "Вид животного" },
  { id: "animal_name", title: "Кличка животного" },
  { id: "coat_color", title: "Окрас животного" },
  { id: "place", title: "Место обитания/обнаружения", optional: true },
  { id: "clinic", title: "Клиника" },
  { id: "type", title: "Цель визита" },
  { id: "comment", title: "Примечание", optional: true },
  { id: "review", title: "Проверка данных" },
];

function getSession(chatId) {
  const session = wizardSessions.get(chatId);
  if (!session) return null;
  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
    wizardSessions.delete(chatId);
    return null;
  }
  return session;
}

function saveSession(chatId, session) {
  session.updatedAt = Date.now();
  wizardSessions.set(chatId, session);
}

function clearSession(chatId) {
  wizardSessions.delete(chatId);
}

function hasActiveSession(chatId) {
  return getSession(chatId) !== null;
}

/**
 * Запуск мастера оформления заявки
 */
async function startWizard(bot, chatId, user, invite) {
  const session = {
    chatId,
    user: {
      id: user.id,
      username: user.username || "",
      first_name: user.first_name || "",
      last_name: user.last_name || "",
    },
    inviteCode: invite.code,
    invite,
    currentStepIndex: 0,
    editingSpecificField: null,
    data: {
      fio: "",
      phone: "",
      address: "",
      animal_type: "",
      animal_name: "",
      coat_color: "",
      place: "",
      clinic: "",
      type: "",
      date: new Date().toISOString().split("T")[0],
      comment: "",
    },
    refLists: { clinics: [], goals: [] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  saveSession(chatId, session);

  // Предзагрузка справочников в фоновом режиме
  try {
    const token = await fetchToken();
    const { clinics, goals } = await getCouponRefListsCached(token);
    session.refLists = { clinics, goals };
    saveSession(chatId, session);
  } catch (err) {
    logError("Ошибка предзагрузки справочников для визарда", err);
  }

  const greeting = `🐾 *Добро пожаловать в систему оформления талонов!*

Вам предоставлен доступ по персональному приглашению.
${invite.label ? `🏷 *Цель:* _${invite.label}_\n` : ""}
Мы поможем вам по шагам заполнить анкету. Вы всегда сможете вернуться назад или изменить любое поле перед отправкой.

Давайте начнем!`;

  await bot.sendMessage(chatId, greeting, { parse_mode: "Markdown" });
  await renderCurrentStep(bot, chatId, session);
}

/**
 * Отрисовка текущего шага
 */
async function renderCurrentStep(bot, chatId, session) {
  const stepId = session.editingSpecificField || STEPS[session.currentStepIndex].id;

  switch (stepId) {
    case "fio": {
      const text = `👤 *Шаг 1 из 10: ФИО заявителя*\n\nПожалуйста, введите ваше ФИО полностью (Фамилия Имя Отчество):\n_Пример: Иванов Иван Иванович_`;
      const keyboard = [[{ text: "❌ Отменить заявку", callback_data: JSON.stringify({ action: "wiz_cancel" }) }]];
      if (session.editingSpecificField) {
        keyboard.unshift([{ text: "🔙 Вернуться к проверке", callback_data: JSON.stringify({ action: "wiz_to_review" }) }]);
      }
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      });
      break;
    }

    case "phone": {
      const text = `📞 *Шаг 2 из 10: Номер телефона*\n\nВведите ваш контактный номер телефона:\n_Пример: +375 29 123-45-67 или 80291234567_`;
      const keyboard = [];
      if (session.editingSpecificField) {
        keyboard.push([{ text: "🔙 Вернуться к проверке", callback_data: JSON.stringify({ action: "wiz_to_review" }) }]);
      } else {
        keyboard.push([
          { text: "⬅️ Назад", callback_data: JSON.stringify({ action: "wiz_back" }) },
          { text: "❌ Отменить", callback_data: JSON.stringify({ action: "wiz_cancel" }) },
        ]);
      }
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      });
      break;
    }

    case "address": {
      const text = `📍 *Шаг 3 из 10: Адрес проживания заявителя*\n\nУкажите населенный пункт, улицу, дом, квартиру:\n_Пример: г. Минск, ул. Ленина, д. 10, кв. 5_`;
      const keyboard = [];
      if (session.editingSpecificField) {
        keyboard.push([{ text: "🔙 Вернуться к проверке", callback_data: JSON.stringify({ action: "wiz_to_review" }) }]);
      } else {
        keyboard.push([
          { text: "⬅️ Назад", callback_data: JSON.stringify({ action: "wiz_back" }) },
          { text: "❌ Отменить", callback_data: JSON.stringify({ action: "wiz_cancel" }) },
        ]);
      }
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      });
      break;
    }

    case "animal_type": {
      const text = `🐾 *Шаг 4 из 10: Вид животного*\n\nВыберите вид животного кнопкой или напишите свой вариант текстом:`;
      const keyboard = [
        [
          { text: "🐱 Кот", callback_data: JSON.stringify({ action: "wiz_set", field: "animal_type", val: "Кот" }) },
          { text: "🐈 Кошка", callback_data: JSON.stringify({ action: "wiz_set", field: "animal_type", val: "Кошка" }) },
        ],
        [
          { text: "🐶 Собака (кобель)", callback_data: JSON.stringify({ action: "wiz_set", field: "animal_type", val: "Собака" }) },
          { text: "🐕 Собака (сука)", callback_data: JSON.stringify({ action: "wiz_set", field: "animal_type", val: "Собака (сука)" }) },
        ],
        [
          { text: "🐾 Котёнок / Щенок", callback_data: JSON.stringify({ action: "wiz_set", field: "animal_type", val: "Котёнок/Щенок" }) },
        ],
      ];
      if (session.editingSpecificField) {
        keyboard.push([{ text: "🔙 Вернуться к проверке", callback_data: JSON.stringify({ action: "wiz_to_review" }) }]);
      } else {
        keyboard.push([
          { text: "⬅️ Назад", callback_data: JSON.stringify({ action: "wiz_back" }) },
          { text: "❌ Отменить", callback_data: JSON.stringify({ action: "wiz_cancel" }) },
        ]);
      }
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      });
      break;
    }

    case "animal_name": {
      const text = `🏷 *Шаг 5 из 10: Кличка животного*\n\nВведите кличку животного.\n_Если животных несколько, укажите их клички через запятую (например: Барсик, Мурка)_:`;
      const keyboard = [];
      if (session.editingSpecificField) {
        keyboard.push([{ text: "🔙 Вернуться к проверке", callback_data: JSON.stringify({ action: "wiz_to_review" }) }]);
      } else {
        keyboard.push([
          { text: "⬅️ Назад", callback_data: JSON.stringify({ action: "wiz_back" }) },
          { text: "❌ Отменить", callback_data: JSON.stringify({ action: "wiz_cancel" }) },
        ]);
      }
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      });
      break;
    }

    case "coat_color": {
      const text = `🎨 *Шаг 6 из 10: Окрас животного*\n\nУкажите окрас или приметы животного:\n_Пример: Черный, Трехцветная, Белый с рыжими пятнами_`;
      const keyboard = [];
      if (session.editingSpecificField) {
        keyboard.push([{ text: "🔙 Вернуться к проверке", callback_data: JSON.stringify({ action: "wiz_to_review" }) }]);
      } else {
        keyboard.push([
          { text: "⬅️ Назад", callback_data: JSON.stringify({ action: "wiz_back" }) },
          { text: "❌ Отменить", callback_data: JSON.stringify({ action: "wiz_cancel" }) },
        ]);
      }
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      });
      break;
    }

    case "place": {
      const text = `📍 *Шаг 7 из 10: Место обитания/обнаружения (необязательно)*\n\nУкажите, где обитает или найдено животное, либо нажмите «Пропустить»:\n_Пример: двор по ул. Ленина, д. 10_`;
      const keyboard = [
        [{ text: "⏩ Пропустить шаг", callback_data: JSON.stringify({ action: "wiz_skip", field: "place" }) }],
      ];
      if (session.editingSpecificField) {
        keyboard.push([{ text: "🔙 Вернуться к проверке", callback_data: JSON.stringify({ action: "wiz_to_review" }) }]);
      } else {
        keyboard.push([
          { text: "⬅️ Назад", callback_data: JSON.stringify({ action: "wiz_back" }) },
          { text: "❌ Отменить", callback_data: JSON.stringify({ action: "wiz_cancel" }) },
        ]);
      }
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      });
      break;
    }

    case "clinic": {
      await renderClinicStep(bot, chatId, session);
      break;
    }

    case "type": {
      await renderGoalStep(bot, chatId, session);
      break;
    }

    case "comment": {
      const text = `💬 *Шаг 10 из 10: Примечание к заявке (необязательно)*\n\nЕсли есть важная информация (срочность, особенности здоровья и т.д.), напишите её или нажмите «Пропустить»:\n_Пример: Срочно, запись на четверг_`;
      const keyboard = [
        [{ text: "⏩ Пропустить шаг", callback_data: JSON.stringify({ action: "wiz_skip", field: "comment" }) }],
      ];
      if (session.editingSpecificField) {
        keyboard.push([{ text: "🔙 Вернуться к проверке", callback_data: JSON.stringify({ action: "wiz_to_review" }) }]);
      } else {
        keyboard.push([
          { text: "⬅️ Назад", callback_data: JSON.stringify({ action: "wiz_back" }) },
          { text: "❌ Отменить", callback_data: JSON.stringify({ action: "wiz_cancel" }) },
        ]);
      }
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      });
      break;
    }

    case "review": {
      await renderReviewScreen(bot, chatId, session);
      break;
    }
  }
}

async function renderClinicStep(bot, chatId, session) {
  let clinics = session.refLists?.clinics || [];
  if (clinics.length === 0) {
    try {
      const token = await fetchToken();
      const ref = await getCouponRefListsCached(token);
      clinics = ref.clinics || [];
      session.refLists.clinics = clinics;
      saveSession(chatId, session);
    } catch (_) {}
  }

  const text = `🏥 *Шаг 8 из 10: Выбор ветеринарной клиники*\n\nВыберите клинику из списка кнопкой ниже или напишите название текстом:`;
  const keyboard = [];

  const validClinics = clinics.filter((c) => c && c.name);
  for (let i = 0; i < Math.min(validClinics.length, 12); i += 2) {
    const row = [];
    row.push({
      text: `🏥 ${validClinics[i].name.substring(0, 26)}`,
      callback_data: JSON.stringify({ action: "wiz_clinic", idx: i }),
    });
    if (i + 1 < validClinics.length) {
      row.push({
        text: `🏥 ${validClinics[i + 1].name.substring(0, 26)}`,
        callback_data: JSON.stringify({ action: "wiz_clinic", idx: i + 1 }),
      });
    }
    keyboard.push(row);
  }

  if (session.editingSpecificField) {
    keyboard.push([{ text: "🔙 Вернуться к проверке", callback_data: JSON.stringify({ action: "wiz_to_review" }) }]);
  } else {
    keyboard.push([
      { text: "⬅️ Назад", callback_data: JSON.stringify({ action: "wiz_back" }) },
      { text: "❌ Отменить", callback_data: JSON.stringify({ action: "wiz_cancel" }) },
    ]);
  }

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function renderGoalStep(bot, chatId, session) {
  let goals = session.refLists?.goals || [];
  if (goals.length === 0) {
    try {
      const token = await fetchToken();
      const ref = await getCouponRefListsCached(token);
      goals = ref.goals || [];
      session.refLists.goals = goals;
      saveSession(chatId, session);
    } catch (_) {}
  }

  const text = `🎯 *Шаг 9 из 10: Цель визита / процедура*\n\nВыберите цель обращения из списка или напишите текстом:`;
  const keyboard = [];

  const validGoals = goals.filter((g) => g && g.name);
  if (validGoals.length > 0) {
    for (let i = 0; i < Math.min(validGoals.length, 8); i += 2) {
      const row = [];
      row.push({
        text: `🎯 ${validGoals[i].name.substring(0, 24)}`,
        callback_data: JSON.stringify({ action: "wiz_goal", idx: i }),
      });
      if (i + 1 < validGoals.length) {
        row.push({
          text: `🎯 ${validGoals[i + 1].name.substring(0, 24)}`,
          callback_data: JSON.stringify({ action: "wiz_goal", idx: i + 1 }),
        });
      }
      keyboard.push(row);
    }
  } else {
    keyboard.push([
      { text: "✂️ Стерилизация", callback_data: JSON.stringify({ action: "wiz_set", field: "type", val: "Стерилизация" }) },
      { text: "✂️ Кастрация", callback_data: JSON.stringify({ action: "wiz_set", field: "type", val: "Кастрация" }) },
    ]);
  }

  if (session.editingSpecificField) {
    keyboard.push([{ text: "🔙 Вернуться к проверке", callback_data: JSON.stringify({ action: "wiz_to_review" }) }]);
  } else {
    keyboard.push([
      { text: "⬅️ Назад", callback_data: JSON.stringify({ action: "wiz_back" }) },
      { text: "❌ Отменить", callback_data: JSON.stringify({ action: "wiz_cancel" }) },
    ]);
  }

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard },
  });
}

/**
 * Отрисовка финального экрана проверки данных
 */
async function renderReviewScreen(bot, chatId, session) {
  const d = session.data;
  const formattedPhone = formatPhoneNumber(d.phone);

  const reviewText = `📋 *Пожалуйста, проверьте данные вашей заявки:*

👤 *ФИО заявителя:* ${d.fio}
📞 *Телефон:* ${formattedPhone}
📍 *Адрес:* ${d.address}
🐾 *Вид животного:* ${d.animal_type}
🏷 *Кличка:* ${d.animal_name}
🎨 *Окрас:* ${d.coat_color}
📍 *Место обитания:* ${d.place || "_не указано_"}
🏥 *Клиника:* ${d.clinic}
🎯 *Цель визита:* ${d.type}
💬 *Примечание:* ${d.comment || "_нет_"}

_Если всё заполнено верно, нажмите кнопку «Отправить заявку куратору»._`;

  const keyboard = [
    [{ text: "🚀 Отправить заявку куратору", callback_data: JSON.stringify({ action: "wiz_submit" }) }],
    [
      { text: "✏️ ФИО", callback_data: JSON.stringify({ action: "wiz_edit", f: "fio" }) },
      { text: "✏️ Телефон", callback_data: JSON.stringify({ action: "wiz_edit", f: "phone" }) },
      { text: "✏️ Адрес", callback_data: JSON.stringify({ action: "wiz_edit", f: "address" }) },
    ],
    [
      { text: "✏️ Вид/Кличка", callback_data: JSON.stringify({ action: "wiz_edit", f: "animal_name" }) },
      { text: "✏️ Окрас", callback_data: JSON.stringify({ action: "wiz_edit", f: "coat_color" }) },
      { text: "✏️ Место", callback_data: JSON.stringify({ action: "wiz_edit", f: "place" }) },
    ],
    [
      { text: "✏️ Клиника", callback_data: JSON.stringify({ action: "wiz_edit", f: "clinic" }) },
      { text: "✏️ Цель визита", callback_data: JSON.stringify({ action: "wiz_edit", f: "type" }) },
      { text: "✏️ Примечание", callback_data: JSON.stringify({ action: "wiz_edit", f: "comment" }) },
    ],
    [{ text: "❌ Отменить заявку", callback_data: JSON.stringify({ action: "wiz_cancel" }) }],
  ];

  await bot.sendMessage(chatId, reviewText, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard },
  });
}

/**
 * Обработка текстового ввода от пользователя
 */
async function handleStepInput(bot, chatId, msg) {
  const session = getSession(chatId);
  if (!session) return false;

  const rawText = msg.text ? msg.text.trim() : "";
  const stepId = session.editingSpecificField || STEPS[session.currentStepIndex].id;

  switch (stepId) {
    case "fio": {
      const fioCheck = validateFIO(rawText);
      if (!fioCheck.valid) {
        await bot.sendMessage(
          chatId,
          `⚠️ *Ошибка:* ${fioCheck.error}.\n\nПожалуйста, введите Фамилию и Имя через пробел:`,
          { parse_mode: "Markdown" },
        );
        return true;
      }
      session.data.fio = rawText;
      return advanceStep(bot, chatId, session);
    }

    case "phone": {
      if (!rawText) {
        await bot.sendMessage(chatId, "⚠️ Пожалуйста, введите номер телефона:");
        return true;
      }
      const normPhone = normalizePhoneNumber(rawText);
      if (!/^\+375\d{9}$/.test(normPhone) && !/^\+\d{10,14}$/.test(normPhone)) {
        await bot.sendMessage(
          chatId,
          "⚠️ Некорректный формат номера телефона. Введите номер в формате +375XXXXXXXXX (например: +375 29 123-45-67):",
        );
        return true;
      }
      session.data.phone = normPhone;
      return advanceStep(bot, chatId, session);
    }

    case "address": {
      const addrCheck = validateAddress(rawText);
      if (!addrCheck.valid) {
        await bot.sendMessage(chatId, `⚠️ ${addrCheck.error}. Укажите город, улицу и дом:`);
        return true;
      }
      session.data.address = rawText;
      return advanceStep(bot, chatId, session);
    }

    case "animal_type": {
      if (!rawText) {
        await bot.sendMessage(chatId, "⚠️ Пожалуйста, выберите вид животного или введите текстом:");
        return true;
      }
      session.data.animal_type = rawText;
      return advanceStep(bot, chatId, session);
    }

    case "animal_name": {
      if (!rawText) {
        await bot.sendMessage(chatId, "⚠️ Пожалуйста, введите кличку животного:");
        return true;
      }
      session.data.animal_name = rawText;
      return advanceStep(bot, chatId, session);
    }

    case "coat_color": {
      if (!rawText) {
        await bot.sendMessage(chatId, "⚠️ Пожалуйста, укажите окрас животного:");
        return true;
      }
      session.data.coat_color = rawText;
      return advanceStep(bot, chatId, session);
    }

    case "place": {
      session.data.place = rawText;
      return advanceStep(bot, chatId, session);
    }

    case "clinic": {
      if (!rawText) {
        await bot.sendMessage(chatId, "⚠️ Пожалуйста, выберите клинику из списка или введите название:");
        return true;
      }
      session.data.clinic = rawText;
      return advanceStep(bot, chatId, session);
    }

    case "type": {
      if (!rawText) {
        await bot.sendMessage(chatId, "⚠️ Пожалуйста, укажите цель визита (процедуру):");
        return true;
      }
      session.data.type = rawText;
      return advanceStep(bot, chatId, session);
    }

    case "comment": {
      session.data.comment = rawText;
      return advanceStep(bot, chatId, session);
    }

    case "review": {
      await renderReviewScreen(bot, chatId, session);
      return true;
    }
  }

  return false;
}

/**
 * Переход на следующий шаг
 */
async function advanceStep(bot, chatId, session) {
  if (session.editingSpecificField) {
    session.editingSpecificField = null;
    session.currentStepIndex = STEPS.findIndex((s) => s.id === "review");
  } else {
    session.currentStepIndex += 1;
  }

  saveSession(chatId, session);
  await renderCurrentStep(bot, chatId, session);
  return true;
}

function escapeMd(str) {
  if (!str) return "";
  return String(str).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

function validateAllWizardFields(data) {
  if (!data.fio || !validateFIO(data.fio).valid) return false;
  if (!data.phone) return false;
  const normPhone = normalizePhoneNumber(data.phone);
  if (!/^\+375\d{9}$/.test(normPhone) && !/^\+\d{10,14}$/.test(normPhone)) return false;
  if (!data.address || !validateAddress(data.address).valid) return false;
  if (!data.animal_type || !data.animal_name || !data.coat_color) return false;
  if (!data.clinic || !data.type) return false;
  return true;
}

const ALLOWED_SET_FIELDS = new Set([
  "animal_type",
  "coat_color",
  "clinic",
  "type",
  "place",
  "comment",
]);

/**
 * Обработка callback_query для визарда
 */
async function handleWizardCallback(bot, chatId, key) {
  const session = getSession(chatId);
  if (!session) return false;

  const action = key.action;

  if (action === "wiz_back") {
    if (session.editingSpecificField) {
      session.editingSpecificField = null;
      session.currentStepIndex = STEPS.findIndex((s) => s.id === "review");
    } else if (session.currentStepIndex > 0) {
      session.currentStepIndex -= 1;
    }
    saveSession(chatId, session);
    await renderCurrentStep(bot, chatId, session);
    return true;
  }

  if (action === "wiz_cancel") {
    clearSession(chatId);
    await bot.sendMessage(
      chatId,
      "❌ Оформление заявки отменено. Ваша ссылка-приглашение осталась активна.",
    );
    return true;
  }

  if (action === "wiz_to_review") {
    session.editingSpecificField = null;
    session.currentStepIndex = STEPS.findIndex((s) => s.id === "review");
    saveSession(chatId, session);
    await renderReviewScreen(bot, chatId, session);
    return true;
  }

  if (action === "wiz_edit") {
    const validEditSteps = STEPS.map((s) => s.id).filter((id) => id !== "review");
    if (!validEditSteps.includes(key.f)) {
      return false;
    }
    session.editingSpecificField = key.f;
    saveSession(chatId, session);
    await renderCurrentStep(bot, chatId, session);
    return true;
  }

  if (action === "wiz_set") {
    if (!ALLOWED_SET_FIELDS.has(key.field) || typeof key.val !== "string") {
      return false;
    }
    session.data[key.field] = key.val.trim().slice(0, 500);
    return advanceStep(bot, chatId, session);
  }

  if (action === "wiz_skip") {
    if (!ALLOWED_SET_FIELDS.has(key.field)) {
      return false;
    }
    session.data[key.field] = "";
    return advanceStep(bot, chatId, session);
  }

  if (action === "wiz_clinic") {
    const clinics = session.refLists?.clinics || [];
    if (typeof key.idx !== "number" || key.idx < 0 || key.idx >= clinics.length) {
      return false;
    }
    const clinicObj = clinics[key.idx];
    if (clinicObj && clinicObj.name) {
      session.data.clinic = clinicObj.name.trim();
      return advanceStep(bot, chatId, session);
    }
    return false;
  }

  if (action === "wiz_goal") {
    const goals = session.refLists?.goals || [];
    if (typeof key.idx !== "number" || key.idx < 0 || key.idx >= goals.length) {
      return false;
    }
    const goalObj = goals[key.idx];
    if (goalObj && goalObj.name) {
      session.data.type = goalObj.name.trim();
      return advanceStep(bot, chatId, session);
    }
    return false;
  }

  if (action === "wiz_submit") {
    await submitApplication(bot, chatId, session);
    return true;
  }

  return false;
}

/**
 * Финальная отправка заявки администраторам
 */
async function submitApplication(bot, chatId, session) {
  // 1. Проверка инвайта
  const valInvite = validateInvite(session.inviteCode);
  if (!valInvite.valid) {
    await bot.sendMessage(
      chatId,
      `⚠️ Не удалось отправить заявку: ${valInvite.reason}`,
    );
    clearSession(chatId);
    return;
  }

  // 2. Валидация всех обязательных полей анкеты
  if (!validateAllWizardFields(session.data)) {
    await bot.sendMessage(
      chatId,
      "⚠️ В анкете заполнены не все обязательные поля или указаны некорректно. Пожалуйста, проверьте данные:",
    );
    session.currentStepIndex = STEPS.findIndex((s) => s.id === "review");
    saveSession(chatId, session);
    await renderReviewScreen(bot, chatId, session);
    return false;
  }

  // 3. Погашение инвайта
  consumeInvite(session.inviteCode, session.user);

  // 4. Подготовка имен животных
  const rawNames = session.data.animal_name;
  const names = rawNames
    .split(/[,;\n]+/)
    .map((n) => n.trim())
    .filter(Boolean);

  const baseData = {
    ...session.data,
    animal_name: names.length > 1 ? names : (names[0] || ""),
  };

  // 5. Сохранение заявки в payloadStore для согласования
  const requestId = `wiz_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  const storedKey = storePayload(requestId, {
    type: "wizard_talon_request",
    baseData,
    names,
    applicantChatId: chatId,
    applicantUser: session.user,
    inviteCode: session.inviteCode,
    createdAt: new Date().toISOString(),
  });

  // Очистка сессии пользователя
  clearSession(chatId);

  // 6. Подтверждение заявителю
  const applicantMsg = `🎉 *Заявка успешно отправлена куратору!*

Мы передали вашу заявку администраторам на проверку и оформление талона.
Как только талон будет создан в системе, вы получите подтверждение и номер талона в этом чате.

Спасибо за заботу о животных! 🐾`;

  await bot.sendMessage(chatId, applicantMsg, { parse_mode: "Markdown" });

  // 7. Уведомление администраторам
  const allowedUsers = getAllowedUsers();
  const applicantTag = session.user.username
    ? `@${session.user.username}`
    : (session.user.first_name || "Заявитель");

  const adminCard = `🌐 *Новая заявка на талон по приглашению!*
${session.invite?.label ? `🏷 *Метка инвайта:* _${escapeMd(session.invite.label)}_\n` : ""}
👤 *Заявитель:* ${escapeMd(baseData.fio)} (${applicantTag})
📞 *Телефон:* ${formatPhoneNumber(baseData.phone)}
📍 *Адрес:* ${escapeMd(baseData.address)}
🐾 *Животное:* ${escapeMd(baseData.animal_type)} ${escapeMd(names.join(", "))}
🎨 *Окрас:* ${escapeMd(baseData.coat_color)}
📍 *Место:* ${baseData.place ? escapeMd(baseData.place) : "_не указано_"}
🏥 *Клиника:* ${escapeMd(baseData.clinic)}
🎯 *Цель визита:* ${escapeMd(baseData.type)}
📅 *Дата:* ${baseData.date}${baseData.comment ? `\n💬 *Примечание:* ${escapeMd(baseData.comment)}` : ""}`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "✅ Одобрить и создать талон",
          callback_data: JSON.stringify({ action: "approve_wiz", id: storedKey }),
        },
        {
          text: "❌ Отклонить",
          callback_data: JSON.stringify({ action: "reject_wiz", id: storedKey }),
        },
      ],
    ],
  };

  for (const adminId of allowedUsers) {
    try {
      await bot.sendMessage(adminId, adminCard, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
      log(`Заявка ${requestId} отправлена на согласование админу ${adminId}`);
    } catch (err) {
      logError(`Ошибка отправки заявки админу ${adminId}`, err);
    }
  }
}

module.exports = {
  startWizard,
  handleStepInput,
  handleWizardCallback,
  hasActiveSession,
  getSession,
  clearSession,
};
