const fs = require("fs");
const path = require("path");
const os = require("os");
const XLSX = require("xlsx");
const { logError } = require("../../utils/helpers");

const name = "/giveaway";
const description = "Собрать уникальные комментарии к посту в Instagram (использование: /giveaway ссылка)";

const TIMEZONE = "Europe/Minsk";
const LOCALE = "ru-BY";
const SIMILARITY_DISTANCE = 3;

function getPostUrlArgument(text) {
  const parts = String(text || "").trim().split(/\s+/);
  return parts[1] || "";
}

function normalizePostUrl(input) {
  const withProtocol = /^(www\.)?instagram\.com\//i.test(input)
    ? `https://${input}`
    : input;

  let parsedUrl;
  try {
    parsedUrl = new URL(withProtocol);
  } catch {
    throw new Error("Укажите URL поста Instagram, например: https://www.instagram.com/p/DWk_MX_jPtS/");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Поддерживаются только http/https URL постов Instagram.");
  }

  if (!/(^|\.)instagram\.com$/i.test(parsedUrl.hostname)) {
    throw new Error("URL должен вести на instagram.com.");
  }

  if (!extractShortcode(parsedUrl.href)) {
    throw new Error("URL должен быть ссылкой на пост Instagram в формате /p/{shortcode}/.");
  }

  return parsedUrl.href;
}

function extractShortcode(url) {
  const match = url.match(/\/p\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

async function openBrowserContext() {
  const { chromium } = require("playwright");
  const PROFILE_DIR = path.resolve(process.cwd(), process.env.INSTAGRAM_PROFILE_DIR || ".pw-profile");
  const HEADLESS = process.env.INSTAGRAM_HEADLESS === "true";

  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 900 },
  });
}

async function scrollCommentsUntilStable(page, shortcode, onProgress) {
  let previousCount = await countComments(page, shortcode);
  let stableRounds = 0;
  const maxRounds = 120;
  const maxStableRounds = 1;

  if (onProgress) {
    onProgress(previousCount);
  }

  for (let round = 1; round <= maxRounds && stableRounds < maxStableRounds; round++) {
    await clickMoreComments(page);
    const scrollResult = await scrollCommentsContainer(page, shortcode);

    if (!scrollResult.found) {
      stableRounds++;
      await page.waitForTimeout(1000);
      continue;
    }

    const currentCount = await waitForCommentCountIncrease(page, shortcode, previousCount);
    if (currentCount > previousCount) {
      previousCount = currentCount;
      stableRounds = 0;
      if (onProgress) {
        onProgress(currentCount);
      }
    } else {
      stableRounds++;
    }
  }
}

async function clickMoreComments(page) {
  const patterns = [
    /view all/i,
    /view more/i,
    /load more/i,
    /more comments/i,
    /show more/i,
    /посмотреть все/i,
    /загрузить еще/i,
    /показать еще/i,
    /еще комментарии/i,
  ];

  for (const pattern of patterns) {
    const locator = page.getByText(pattern).first();
    try {
      if (await locator.isVisible({ timeout: 300 })) {
        await locator.click({ timeout: 1000 });
        await page.waitForTimeout(1000);
        return;
      }
    } catch {
      // Instagram often changes button markup while scrolling; skipping is fine.
    }
  }
}

async function scrollCommentsContainer(page, shortcode) {
  return page.evaluate((postShortcode) => {
    function isScrollable(element) {
      if (!element || element === document.body || element === document.documentElement) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const hasScrollableOverflow = /(auto|scroll|overlay)/i.test(style.overflowY);
      return hasScrollableOverflow && element.scrollHeight > element.clientHeight + 40;
    }

    const commentLinkPart = postShortcode ? `/p/${postShortcode}/c/` : "/c/";
    const commentLinks = Array.from(document.querySelectorAll(`a[href*="${commentLinkPart}"]`));
    const seed = commentLinks[commentLinks.length - 1] || commentLinks[0];
    let target = null;

    for (let element = seed && seed.parentElement; element; element = element.parentElement) {
      if (isScrollable(element)) {
        target = element;
        break;
      }
    }

    if (!target) {
      const candidates = Array.from(document.querySelectorAll("div, main, section, article"))
        .filter(isScrollable)
        .map((element) => ({
          element,
          commentCount: element.querySelectorAll(`a[href*="${commentLinkPart}"]`).length,
        }))
        .filter((candidate) => candidate.commentCount > 0)
        .sort((a, b) => b.commentCount - a.commentCount);

      target = candidates[0] && candidates[0].element;
    }

    if (!target) {
      return { found: false, reason: "comment-scroll-container-not-found" };
    }

    const beforeTop = target.scrollTop;
    const maxTop = target.scrollHeight - target.clientHeight;
    const nextTop = maxTop;
    const deltaY = Math.max(600, nextTop - beforeTop, target.clientHeight * 2);

    target.scrollTop = nextTop;
    target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY }));

    return {
      found: true,
      scrolled: target.scrollTop > beforeTop,
      beforeTop,
      afterTop: target.scrollTop,
      maxTop,
      commentCount: target.querySelectorAll(`a[href*="${commentLinkPart}"]`).length,
    };
  }, shortcode);
}

async function waitForCommentCountIncrease(page, shortcode, previousCount) {
  const deadline = Date.now() + 30000;
  let currentCount = previousCount;

  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    currentCount = await countComments(page, shortcode);

    if (currentCount > previousCount) {
      return currentCount;
    }
  }

  return currentCount;
}

async function countComments(page, shortcode) {
  return page.evaluate(({ postShortcode, collectorSource }) => {
    const collectInstagramComments = new Function(`return (${collectorSource});`)();
    return collectInstagramComments(postShortcode).length;
  }, { postShortcode: shortcode, collectorSource: String(collectInstagramComments) });
}

async function extractComments(page, shortcode) {
  return page.evaluate(({ postShortcode, collectorSource }) => {
    const collectInstagramComments = new Function(`return (${collectorSource});`)();
    return collectInstagramComments(postShortcode);
  }, { postShortcode: shortcode, collectorSource: String(collectInstagramComments) });
}

function collectInstagramComments(postShortcode) {
  function cleanText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function findAuthorLink(headerRow) {
    if (!headerRow) return null;

    const links = Array.from(headerRow.querySelectorAll("a[href]"));
    return links.find((link) => {
      const href = link.getAttribute("href") || "";
      const text = cleanText(link.innerText);

      if (!text || text.includes(" ")) return false;
      if (href.includes("/p/") || href.includes("/c/") || href.includes("/explore/")) return false;
      return /^https:\/\/www\.instagram\.com\/[^/?#]+\/?$/i.test(href) || /^\/[^/?#]+\/?$/i.test(href);
    }) || null;
  }

  const commentLinkPart = postShortcode ? `/p/${postShortcode}/c/` : "/c/";
  const timeSelector = postShortcode
    ? `a[href*="${commentLinkPart}"] time[datetime]`
    : 'a[href*="/p/"][href*="/c/"] time[datetime]';
  const comments = [];
  const seenIds = new Set();

  for (const timeElement of document.querySelectorAll(timeSelector)) {
    const permalink = timeElement.closest(`a[href*="${commentLinkPart}"]`);
    if (!permalink) continue;

    const href = permalink.getAttribute("href") || permalink.href || "";
    const idMatch = href.match(/\/c\/([^/?#]+)/);
    const commentId = idMatch ? idMatch[1] : href;
    if (!commentId || seenIds.has(commentId)) continue;
    seenIds.add(commentId);

    const headerRow = permalink.parentElement && permalink.parentElement.parentElement;
    const textBlock = headerRow && headerRow.nextElementSibling;
    const authorLink = findAuthorLink(headerRow);
    const sender = cleanText(authorLink && authorLink.innerText);
    const text = cleanText(textBlock && textBlock.innerText);
    const datetime = timeElement.getAttribute("datetime") || "";

    if (!sender || !text || !datetime) continue;

    comments.push({
      id: commentId,
      datetime,
      sender,
      text,
    });
  }

  return comments;
}

function splitDuplicates(comments) {
  const seen = new Set();
  const unique = [];
  const duplicates = [];

  for (const comment of comments) {
    const key = `${comment.sender};${comment.text}`.trim().toLowerCase();
    if (seen.has(key)) {
      duplicates.push(comment);
    } else {
      seen.add(key);
      unique.push(comment);
    }
  }

  return { unique, duplicates };
}

function markSimilarComments(comments) {
  const commentsByUser = new Map();

  for (const comment of comments) {
    if (!commentsByUser.has(comment.sender)) {
      commentsByUser.set(comment.sender, []);
    }
    commentsByUser.get(comment.sender).push(comment);
  }

  for (const userComments of commentsByUser.values()) {
    for (let i = 0; i < userComments.length; i++) {
      for (let j = i + 1; j < userComments.length; j++) {
        if (levenshtein(userComments[i].text, userComments[j].text, SIMILARITY_DISTANCE) <= SIMILARITY_DISTANCE) {
          userComments[i].needsCheck = true;
          userComments[j].needsCheck = true;
        }
      }
    }
  }
}

function levenshtein(first, second, maxDistance) {
  const a = String(first || "").trim();
  const b = String(second || "").trim();

  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  if (a.length > b.length) return levenshtein(b, a, maxDistance);

  const previous = new Array(a.length + 1);
  let current = new Array(a.length + 1);

  for (let i = 0; i <= a.length; i++) {
    previous[i] = i;
  }

  for (let j = 1; j <= b.length; j++) {
    current[0] = j;
    let minInRow = current[0];
    const charCode = b.charCodeAt(j - 1);

    for (let i = 1; i <= a.length; i++) {
      const cost = a.charCodeAt(i - 1) === charCode ? 0 : 1;
      current[i] = Math.min(
        previous[i] + 1,
        current[i - 1] + 1,
        previous[i - 1] + cost
      );
      minInRow = Math.min(minInRow, current[i]);
    }

    if (minInRow > maxDistance) {
      return maxDistance + 1;
    }

    for (let i = 0; i <= a.length; i++) {
      previous[i] = current[i];
    }
  }

  return previous[a.length];
}

function formatDateMinsk(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(LOCALE, {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const rawUrl = getPostUrlArgument(msg.text);

  if (!rawUrl) {
    await bot.sendMessage(
      chatId,
      "Использование: /giveaway <ссылка на пост Instagram>\nКоманда собирает комментарии к посту, удаляет дубликаты и возвращает XLSX-файл с результатами."
    );
    return;
  }

  let postUrl;
  try {
    postUrl = normalizePostUrl(rawUrl);
  } catch (error) {
    await bot.sendMessage(chatId, `Ошибка: ${error.message}`);
    return;
  }

  const shortcode = extractShortcode(postUrl);
  const statusMsg = await bot.sendMessage(
    chatId,
    `Начинаю сбор комментариев. Это может занять некоторое время...`
  );

  let lastUpdate = Date.now();
  const onProgress = async (count) => {
    const now = Date.now();
    if (now - lastUpdate >= 4000) {
      lastUpdate = now;
      try {
        await bot.editMessageText(
          `Загружаю комментарии... Уже видно: ${count}`,
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
      } catch (err) {
        // Ignore edit message errors (like Telegram rate limit or message not modified)
      }
    }
  };

  let context;
  let tempDir;

  try {
    context = await openBrowserContext();
    const page = context.pages()[0] || (await context.newPage());

    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(5000);

    await scrollCommentsUntilStable(page, shortcode, onProgress);

    await bot.editMessageText(
      `Сбор комментариев завершен. Извлекаю и обрабатываю данные...`,
      { chat_id: chatId, message_id: statusMsg.message_id }
    );

    const comments = await extractComments(page, shortcode);
    const { unique, duplicates } = splitDuplicates(comments);
    markSimilarComments(unique);

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "instagram-giveaway-"));
    const xlsxPath = path.join(tempDir, "giveaway_results.xlsx");

    const commentsRows = [
      ["дата", "пользователь", "комментарий", "проверка"],
      ...unique.map((comment) => [
        formatDateMinsk(comment.datetime),
        comment.sender,
        comment.text,
        comment.needsCheck ? "проверить" : "",
      ]),
    ];

    const duplicatesRows = [
      ["дата", "пользователь", "комментарий"],
      ...duplicates.map((comment) => [
        formatDateMinsk(comment.datetime),
        comment.sender,
        comment.text,
      ]),
    ];

    const wb = XLSX.utils.book_new();
    const wsUnique = XLSX.utils.aoa_to_sheet(commentsRows);
    XLSX.utils.book_append_sheet(wb, wsUnique, "Уникальные");

    const wsDuplicates = XLSX.utils.aoa_to_sheet(duplicatesRows);
    XLSX.utils.book_append_sheet(wb, wsDuplicates, "Дубликаты");

    XLSX.writeFile(wb, xlsxPath);

    await bot.editMessageText(
      `📊 Результаты сбора комментариев:\n` +
      `- Всего собрано: ${comments.length}\n` +
      `- Уникальных: ${unique.length}\n` +
      `- Дубликатов: ${duplicates.length}\n` +
      `- Требуют проверки (похожие): ${unique.filter((comment) => comment.needsCheck).length}`,
      { chat_id: chatId, message_id: statusMsg.message_id }
    );

    await bot.sendDocument(
      chatId,
      xlsxPath,
      { caption: `Результаты розыгрыша (Уникальных: ${unique.length}, Дубликатов: ${duplicates.length})` },
      { filename: "giveaway_results.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    );
  } catch (error) {
    logError("Ошибка при выполнении giveaway", error);
    try {
      await bot.sendMessage(
        chatId,
        `Произошла ошибка при обработке комментариев: ${error.message}`
      );
    } catch (sendErr) {
      logError("Не удалось отправить сообщение об ошибке пользователю", sendErr);
    }
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (closeErr) {
        logError("Ошибка при закрытии контекста браузера", closeErr);
      }
    }
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (rmErr) {
        logError("Не удалось удалить временную папку", rmErr);
      }
    }
  }
}

module.exports = {
  name,
  description,
  handle,
  normalizePostUrl,
  extractShortcode,
  splitDuplicates,
  levenshtein,
};
