const {
  getActiveEditSession,
  updateEditSession,
} = require("../../utils/helpers");

/**
 * Начало редактирования конкретного поля
 * @param {Object} bot - Экземпляр бота
 * @param {number} chatId - ID чата
 * @param {Object} key - Callback payload
 */
async function handleEditField(bot, chatId, key) {
  const session = getActiveEditSession(chatId);
  if (!session) {
    await bot.sendMessage(
      chatId,
      "❌ Сессия редактирования истекла. Отправьте данные заново.",
    );
    return;
  }

  const { field } = key;
  session.editingField = field;
  updateEditSession(session.key, session);

  const fieldPrompts = {
    fio: "Введите ФИО в формате: Фамилия Имя Отчество",
    phone: "Введите номер телефона в формате: +375XXXXXXXXX",
    address: "Введите полный адрес (улица, дом, квартира)",
    clinic: "Введите название клиники",
    animal_type: "Введите тип животного (кошка, собака и т.д.)",
    coat_color: "Введите окрас животного",
    animal_name: "Введите кличку животного",
    type: "Введите цель визита (стерилизация, лечение и т.д.)",
    date: "Введите дату в формате ДД.ММ.ГГГГ или оставьте пустым для текущей даты",
  };

  const prompt = fieldPrompts[field] || `Введите новое значение для ${field}`;
  await bot.sendMessage(chatId, `✏️ ${prompt}`);
}

module.exports = handleEditField;
