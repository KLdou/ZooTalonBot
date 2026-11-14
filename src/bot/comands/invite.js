const { createInvite, DEFAULT_TTL_HOURS } = require("../../services/inviteService");
const { logError } = require("../../utils/helpers");

const name = "/invite";
const aliases = ["/invite", "/inv"];
const description = "Создать персональную ссылку-приглашение на 24 часа для заявителя";

let cachedBotUsername = null;

async function getBotUsername(bot) {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await bot.getMe();
    cachedBotUsername = me.username;
    return me.username;
  } catch (error) {
    logError("Ошибка получения информации о боте через bot.getMe()", error);
    return "ZooTalonBot";
  }
}

function parseInviteParams(text) {
  const parts = String(text || "").trim().split(/\s+/).slice(1);
  if (parts.length === 0) {
    return { label: "", maxUses: 1 };
  }

  let maxUses = 1;
  let labelParts = [];

  for (const part of parts) {
    if (/^\d+$/.test(part) && labelParts.length === 0) {
      maxUses = parseInt(part, 10) || 1;
    } else {
      labelParts.push(part);
    }
  }

  return {
    label: labelParts.join(" "),
    maxUses,
  };
}

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const username = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name || "Администратор");
  const { label, maxUses } = parseInviteParams(msg.text);

  try {
    const invite = createInvite({
      createdBy: chatId,
      creatorName: username,
      label,
      maxUses,
      ttlHours: DEFAULT_TTL_HOURS,
    });

    const botUsername = await getBotUsername(bot);
    const link = `https://t.me/${botUsername}?start=${invite.code}`;

    const expiresDate = new Date(invite.expiresAt);
    const expiresFormatted = expiresDate.toLocaleString("ru-RU", {
      timeZone: "Europe/Minsk",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const messageText = `🎟 *Приглашение на оформление талона создано!*

🔗 *Ссылка для заявителя:*
\`${link}\`

⏱ *Срок действия:* 24 часа (до ${expiresFormatted})
🎯 *Лимит заявок:* ${invite.maxUses}
${invite.label ? `🏷 *Метка:* _${invite.label}_\n` : ""}
_Перешлите эту ссылку человеку, которому нужно оформить талон._`;

    await bot.sendMessage(chatId, messageText, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📋 Скопировать ссылку",
              url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
                "Ссылка для оформления ветеринарного талона (действует 24 часа):",
              )}`,
            },
          ],
        ],
      },
    });
  } catch (error) {
    logError("Ошибка создания инвайта", error);
    await bot.sendMessage(chatId, `❌ Ошибка при создании инвайта: ${error.message}`);
  }
}

module.exports = {
  name,
  aliases,
  description,
  handle,
  parseInviteParams,
};
