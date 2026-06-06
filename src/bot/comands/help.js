const name = "/help";
const description = "Показать список доступных команд и их описание";

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  // Динамический импорт для избежания круговой зависимости
  const { commands } = require("./index");

  const helpText = commands
    .map((cmd) => `*${cmd.name}* — ${cmd.description || "Без описания"}`)
    .join("\n");

  await bot.sendMessage(
    chatId,
    `Список доступных команд:\n\n${helpText}`,
    { parse_mode: "Markdown" }
  );
}

module.exports = {
  name,
  description,
  handle,
};
