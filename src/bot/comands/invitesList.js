const { listActiveInvites } = require("../../services/inviteService");
const { logError } = require("../../utils/helpers");

const name = "/invites";
const aliases = ["/invites", "/invlist"];
const description = "Показать список активных приглашений и возможность их отзыва";

async function handle(bot, msg) {
  const chatId = msg.chat.id;

  try {
    const activeInvites = listActiveInvites();

    if (activeInvites.length === 0) {
      await bot.sendMessage(
        chatId,
        "📭 Нет активных приглашений.\n\nСоздать новое: `/invite [метка]`",
        { parse_mode: "Markdown" },
      );
      return;
    }

    let text = `📋 *Активные приглашения (${activeInvites.length}):*\n\n`;
    const keyboard = [];

    activeInvites.slice(0, 10).forEach((inv, index) => {
      const expiresDate = new Date(inv.expiresAt);
      const expiresStr = expiresDate.toLocaleString("ru-RU", {
        timeZone: "Europe/Minsk",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

      const label = inv.label ? ` (${inv.label})` : "";
      text += `${index + 1}. \`${inv.code}\`${label}\n   ⏳ До: ${expiresStr} | Исп: ${inv.usedCount}/${inv.maxUses}\n`;

      keyboard.push([
        {
          text: `❌ Отозвать ${inv.code}${label}`,
          callback_data: JSON.stringify({ action: "revoke_inv", code: inv.code }),
        },
      ]);
    });

    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (error) {
    logError("Ошибка получения списка инвайтов", error);
    await bot.sendMessage(chatId, `❌ Ошибка при получении списка инвайтов: ${error.message}`);
  }
}

module.exports = {
  name,
  aliases,
  description,
  handle,
};
