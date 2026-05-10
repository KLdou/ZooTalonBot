const { getProvider, PROVIDERS } = require("../../services/llmService");

const name = "/provider";

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const current = getProvider();
  const keyboard = PROVIDERS.map((p) => [
    {
      text: `${p === current ? "✅ " : ""}${p}`,
      callback_data: JSON.stringify({ action: "set_provider", provider: p }),
    },
  ]);

  await bot.sendMessage(
    chatId,
    `Текущий LLM-провайдер: *${current}*\nВыберите провайдер:`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    },
  );
}

module.exports = {
  name,
  handle,
};
