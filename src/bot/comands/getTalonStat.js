const fs = require("fs");
const path = require("path");
const os = require("os");
const XLSX = require("xlsx");
const PizZip = require("pizzip");
const { fetchToken, getCoupons } = require("../../services/api");
const { parseRussianMonth, getCurrentBelarusYear, MONTHS } = require("../../utils/documentArchive");
const { logError } = require("../../utils/helpers");

const name = "/gettalonstat";
const aliases = ["/gettalonstat", "/gettalotstat"];
const description = "Сформировать статистику по талонам в Excel (использование: /gettalonstat [год] [месяц])";

function parseStatParams(text, now = new Date()) {
  const currentYear = getCurrentBelarusYear(now);
  const parts = String(text || "").trim().split(/\s+/).slice(1);

  if (parts.length === 0) {
    return { year: currentYear, month: null };
  }

  let year = null;
  let month = null;

  for (const part of parts) {
    if (/^\d{4}$/.test(part)) {
      year = parseInt(part, 10);
      continue;
    }

    if (/^\d{1,2}$/.test(part)) {
      const val = parseInt(part, 10);
      if (val >= 1 && val <= 12) {
        month = val;
        continue;
      }
    }

    const monthObj = parseRussianMonth(part);
    if (monthObj) {
      month = monthObj.index;
      continue;
    }

    throw new Error(`Неизвестный параметр "${part}". Пример использования: /gettalonstat 2026 август`);
  }

  if (year === null) {
    year = currentYear;
  }

  return { year, month };
}

function getCouponPaymentStatus(coupon) {
  const expenses = Number(coupon.expenses) || 0;
  const enclosed = Number(coupon.enclosed) || 0;

  if (enclosed === 0) {
    return "unpaid";
  }
  if (enclosed < expenses) {
    return "partial";
  }
  return "full";
}

function createEmptyCounts() {
  return {
    total: 0,
    unpaid: 0,
    unpaidItems: [],
    partial: 0,
    partialItems: [],
    full: 0,
  };
}

function updateCounts(counts, coupon) {
  counts.total++;
  const status = getCouponPaymentStatus(coupon);
  const couponId = coupon._id || coupon.id;
  let couponName = coupon.name || (coupon.number ? `#${coupon.number}` : "Без названия");

  const ownerCanon = coupon.owner?.usernameCanonical || "";
  const userCanon = coupon.user?.usernameCanonical || "";
  const userName = coupon.user?.username;

  if (userCanon && ownerCanon !== userCanon) {
    couponName += ` (${userName || userCanon})`;
  }

  if (status === "unpaid") {
    counts.unpaid++;
    counts.unpaidItems.push({ id: couponId, name: couponName });
  } else if (status === "partial") {
    counts.partial++;
    counts.partialItems.push({ id: couponId, name: couponName });
  } else {
    counts.full++;
  }
}

function addCounts(target, source) {
  target.total += source.total;
  target.unpaid += source.unpaid;
  target.unpaidItems.push(...source.unpaidItems);
  target.partial += source.partial;
  target.partialItems.push(...source.partialItems);
  target.full += source.full;
}

function formatCountCell(count, items) {
  if (!count || count === 0) {
    return 0;
  }
  if (!items || items.length === 0) {
    return count;
  }

  return `${count} (${items.map((i) => i.name).join(", ")})`;
}

function aggregateCouponStats(coupons) {
  const map = new Map();

  for (const coupon of coupons) {
    const rawDateStr = coupon.effectiveDate || coupon.bookedAt;
    const d = rawDateStr ? new Date(rawDateStr) : null;
    const itemYear = coupon.year || (d ? d.getFullYear() : 0);
    const itemMonthIndex = d ? d.getMonth() + 1 : 1;

    const monthData = MONTHS.find((m) => m.index === itemMonthIndex);
    const monthName = monthData ? monthData.nominative : `Месяц ${itemMonthIndex}`;
    const monthFormatted = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${itemYear}`;
    const monthSortKey = `${itemYear}-${String(itemMonthIndex).padStart(2, "0")}`;

    const clinicName = coupon.vet?.name || (coupon.name ? coupon.name.split(" #")[0] : "Не указана");
    const goalName = coupon.goal?.name || "Не указана";

    const key = `${monthSortKey}|${monthFormatted}|${clinicName}|${goalName}`;
    if (!map.has(key)) {
      map.set(key, createEmptyCounts());
    }
    updateCounts(map.get(key), coupon);
  }

  const rows = [];
  for (const [key, counts] of map.entries()) {
    const [monthSortKey, monthFormatted, clinicName, goalName] = key.split("|");
    rows.push({
      monthSortKey,
      monthFormatted,
      clinicName,
      goalName,
      ...counts,
    });
  }

  rows.sort((a, b) => {
    if (a.monthSortKey !== b.monthSortKey) {
      return a.monthSortKey.localeCompare(b.monthSortKey);
    }
    if (a.clinicName !== b.clinicName) {
      return a.clinicName.localeCompare(b.clinicName, "ru");
    }
    return a.goalName.localeCompare(b.goalName, "ru");
  });

  return rows;
}

function formatPeriodText(year, month) {
  if (month) {
    const monthData = MONTHS.find((m) => m.index === month);
    const monthName = monthData ? monthData.nominative : `${month} месяц`;
    return `${monthName} ${year}`;
  }
  return `${year} год`;
}

function aggregateMonthSheet(coupons) {
  const monthsMap = new Map();

  for (const coupon of coupons) {
    const rawDateStr = coupon.effectiveDate || coupon.bookedAt;
    const d = rawDateStr ? new Date(rawDateStr) : null;
    const itemYear = coupon.year || (d ? d.getFullYear() : 0);
    const itemMonthIndex = d ? d.getMonth() + 1 : 1;

    const monthData = MONTHS.find((m) => m.index === itemMonthIndex);
    const monthName = monthData ? monthData.nominative : `Месяц ${itemMonthIndex}`;
    const monthFormatted = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${itemYear}`;
    const monthSortKey = `${itemYear}-${String(itemMonthIndex).padStart(2, "0")}`;

    const clinicName = coupon.vet?.name || (coupon.name ? coupon.name.split(" #")[0] : "Не указана");
    const goalName = coupon.goal?.name || "Не указана";

    if (!monthsMap.has(monthSortKey)) {
      monthsMap.set(monthSortKey, { monthFormatted, clinics: new Map() });
    }
    const monthObj = monthsMap.get(monthSortKey);

    if (!monthObj.clinics.has(clinicName)) {
      monthObj.clinics.set(clinicName, new Map());
    }
    const goalsMap = monthObj.clinics.get(clinicName);

    if (!goalsMap.has(goalName)) {
      goalsMap.set(goalName, createEmptyCounts());
    }
    updateCounts(goalsMap.get(goalName), coupon);
  }

  const tableData = [
    ["Месяц", "Клиника", "Цель обращения", "Количество талонов", "Непогашенные", "Погашенные частично", "Полностью погашенные"]
  ];
  const merges = [];
  let currentRowIndex = 1;
  const grandTotal = createEmptyCounts();

  const sortedMonthKeys = Array.from(monthsMap.keys()).sort();

  for (const mKey of sortedMonthKeys) {
    const monthObj = monthsMap.get(mKey);
    const monthStartRow = currentRowIndex;
    const sortedClinics = Array.from(monthObj.clinics.keys()).sort((a, b) => a.localeCompare(b, "ru"));

    const monthTotal = createEmptyCounts();

    for (const clinicName of sortedClinics) {
      const clinicStartRow = currentRowIndex;
      const goalsMap = monthObj.clinics.get(clinicName);
      const sortedGoals = Array.from(goalsMap.keys()).sort((a, b) => a.localeCompare(b, "ru"));

      for (const goalName of sortedGoals) {
        const counts = goalsMap.get(goalName);
        addCounts(monthTotal, counts);
        tableData.push([
          monthObj.monthFormatted,
          clinicName,
          goalName,
          counts.total,
          formatCountCell(counts.unpaid, counts.unpaidItems),
          formatCountCell(counts.partial, counts.partialItems),
          counts.full,
        ]);
        currentRowIndex++;
      }

      const clinicEndRow = currentRowIndex - 1;
      if (clinicEndRow > clinicStartRow) {
        merges.push({ s: { r: clinicStartRow, c: 1 }, e: { r: clinicEndRow, c: 1 } });
      }
    }

    const monthEndRow = currentRowIndex - 1;
    if (monthEndRow > monthStartRow) {
      merges.push({ s: { r: monthStartRow, c: 0 }, e: { r: monthEndRow, c: 0 } });
    }

    const summaryRowIndex = currentRowIndex;
    tableData.push([
      `Итого за ${monthObj.monthFormatted}`,
      "",
      "",
      monthTotal.total,
      formatCountCell(monthTotal.unpaid, monthTotal.unpaidItems),
      formatCountCell(monthTotal.partial, monthTotal.partialItems),
      monthTotal.full,
    ]);
    merges.push({ s: { r: summaryRowIndex, c: 0 }, e: { r: summaryRowIndex, c: 2 } });
    currentRowIndex++;

    tableData.push([]);
    currentRowIndex++;

    addCounts(grandTotal, monthTotal);
  }

  const grandTotalRowIndex = currentRowIndex;
  tableData.push([
    "ОБЩИЙ ИТОГО",
    "",
    "",
    grandTotal.total,
    formatCountCell(grandTotal.unpaid, grandTotal.unpaidItems),
    formatCountCell(grandTotal.partial, grandTotal.partialItems),
    grandTotal.full,
  ]);
  merges.push({ s: { r: grandTotalRowIndex, c: 0 }, e: { r: grandTotalRowIndex, c: 2 } });

  return { tableData, merges };
}

function aggregateClinicSheet(coupons) {
  const clinicsMap = new Map();

  for (const coupon of coupons) {
    const rawDateStr = coupon.effectiveDate || coupon.bookedAt;
    const d = rawDateStr ? new Date(rawDateStr) : null;
    const itemYear = coupon.year || (d ? d.getFullYear() : 0);
    const itemMonthIndex = d ? d.getMonth() + 1 : 1;

    const monthData = MONTHS.find((m) => m.index === itemMonthIndex);
    const monthName = monthData ? monthData.nominative : `Месяц ${itemMonthIndex}`;
    const monthFormatted = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${itemYear}`;
    const monthSortKey = `${itemYear}-${String(itemMonthIndex).padStart(2, "0")}`;

    const clinicName = coupon.vet?.name || (coupon.name ? coupon.name.split(" #")[0] : "Не указана");
    const goalName = coupon.goal?.name || "Не указана";

    if (!clinicsMap.has(clinicName)) {
      clinicsMap.set(clinicName, new Map());
    }
    const monthsMap = clinicsMap.get(clinicName);

    const monthKey = `${monthSortKey}|${monthFormatted}`;
    if (!monthsMap.has(monthKey)) {
      monthsMap.set(monthKey, new Map());
    }
    const goalsMap = monthsMap.get(monthKey);

    if (!goalsMap.has(goalName)) {
      goalsMap.set(goalName, createEmptyCounts());
    }
    updateCounts(goalsMap.get(goalName), coupon);
  }

  const tableData = [
    ["Клиника", "Месяц", "Цель обращения", "Количество талонов", "Непогашенные", "Погашенные частично", "Полностью погашенные"]
  ];
  const merges = [];
  let currentRowIndex = 1;
  const grandTotal = createEmptyCounts();

  const sortedClinics = Array.from(clinicsMap.keys()).sort((a, b) => a.localeCompare(b, "ru"));

  for (const clinicName of sortedClinics) {
    const clinicStartRow = currentRowIndex;
    const monthsMap = clinicsMap.get(clinicName);
    const sortedMonthKeys = Array.from(monthsMap.keys()).sort((a, b) => a.localeCompare(b));

    const clinicTotal = createEmptyCounts();

    for (const monthKey of sortedMonthKeys) {
      const monthStartRow = currentRowIndex;
      const [, monthFormatted] = monthKey.split("|");
      const goalsMap = monthsMap.get(monthKey);
      const sortedGoals = Array.from(goalsMap.keys()).sort((a, b) => a.localeCompare(b, "ru"));

      for (const goalName of sortedGoals) {
        const counts = goalsMap.get(goalName);
        addCounts(clinicTotal, counts);
        tableData.push([
          clinicName,
          monthFormatted,
          goalName,
          counts.total,
          formatCountCell(counts.unpaid, counts.unpaidItems),
          formatCountCell(counts.partial, counts.partialItems),
          counts.full,
        ]);
        currentRowIndex++;
      }

      const monthEndRow = currentRowIndex - 1;
      if (monthEndRow > monthStartRow) {
        merges.push({ s: { r: monthStartRow, c: 1 }, e: { r: monthEndRow, c: 1 } });
      }
    }

    const clinicEndRow = currentRowIndex - 1;
    if (clinicEndRow > clinicStartRow) {
      merges.push({ s: { r: clinicStartRow, c: 0 }, e: { r: clinicEndRow, c: 0 } });
    }

    const summaryRowIndex = currentRowIndex;
    tableData.push([
      `Итого по клинике: ${clinicName}`,
      "",
      "",
      clinicTotal.total,
      formatCountCell(clinicTotal.unpaid, clinicTotal.unpaidItems),
      formatCountCell(clinicTotal.partial, clinicTotal.partialItems),
      clinicTotal.full,
    ]);
    merges.push({ s: { r: summaryRowIndex, c: 0 }, e: { r: summaryRowIndex, c: 2 } });
    currentRowIndex++;

    tableData.push([]);
    currentRowIndex++;

    addCounts(grandTotal, clinicTotal);
  }

  const grandTotalRowIndex = currentRowIndex;
  tableData.push([
    "ОБЩИЙ ИТОГО",
    "",
    "",
    grandTotal.total,
    formatCountCell(grandTotal.unpaid, grandTotal.unpaidItems),
    formatCountCell(grandTotal.partial, grandTotal.partialItems),
    grandTotal.full,
  ]);
  merges.push({ s: { r: grandTotalRowIndex, c: 0 }, e: { r: grandTotalRowIndex, c: 2 } });

  return { tableData, merges };
}

function aggregateGoalSheet(coupons) {
  const goalsMap = new Map();

  for (const coupon of coupons) {
    const rawDateStr = coupon.effectiveDate || coupon.bookedAt;
    const d = rawDateStr ? new Date(rawDateStr) : null;
    const itemYear = coupon.year || (d ? d.getFullYear() : 0);
    const itemMonthIndex = d ? d.getMonth() + 1 : 1;

    const monthData = MONTHS.find((m) => m.index === itemMonthIndex);
    const monthName = monthData ? monthData.nominative : `Месяц ${itemMonthIndex}`;
    const monthFormatted = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${itemYear}`;
    const monthSortKey = `${itemYear}-${String(itemMonthIndex).padStart(2, "0")}`;

    const clinicName = coupon.vet?.name || (coupon.name ? coupon.name.split(" #")[0] : "Не указана");
    const goalName = coupon.goal?.name || "Не указана";

    if (!goalsMap.has(goalName)) {
      goalsMap.set(goalName, new Map());
    }
    const clinicsMap = goalsMap.get(goalName);

    if (!clinicsMap.has(clinicName)) {
      clinicsMap.set(clinicName, new Map());
    }
    const monthsMap = clinicsMap.get(clinicName);

    const monthKey = `${monthSortKey}|${monthFormatted}`;
    if (!monthsMap.has(monthKey)) {
      monthsMap.set(monthKey, createEmptyCounts());
    }
    updateCounts(monthsMap.get(monthKey), coupon);
  }

  const tableData = [
    ["Цель обращения", "Клиника", "Месяц", "Количество талонов", "Непогашенные", "Погашенные частично", "Полностью погашенные"]
  ];
  const merges = [];
  let currentRowIndex = 1;
  const grandTotal = createEmptyCounts();

  const sortedGoals = Array.from(goalsMap.keys()).sort((a, b) => a.localeCompare(b, "ru"));

  for (const goalName of sortedGoals) {
    const goalStartRow = currentRowIndex;
    const clinicsMap = goalsMap.get(goalName);
    const sortedClinics = Array.from(clinicsMap.keys()).sort((a, b) => a.localeCompare(b, "ru"));

    const goalTotal = createEmptyCounts();

    for (const clinicName of sortedClinics) {
      const clinicStartRow = currentRowIndex;
      const monthsMap = clinicsMap.get(clinicName);
      const sortedMonthKeys = Array.from(monthsMap.keys()).sort((a, b) => a.localeCompare(b));

      for (const monthKey of sortedMonthKeys) {
        const [, monthFormatted] = monthKey.split("|");
        const counts = monthsMap.get(monthKey);
        addCounts(goalTotal, counts);
        tableData.push([
          goalName,
          clinicName,
          monthFormatted,
          counts.total,
          formatCountCell(counts.unpaid, counts.unpaidItems),
          formatCountCell(counts.partial, counts.partialItems),
          counts.full,
        ]);
        currentRowIndex++;
      }

      const clinicEndRow = currentRowIndex - 1;
      if (clinicEndRow > clinicStartRow) {
        merges.push({ s: { r: clinicStartRow, c: 1 }, e: { r: clinicEndRow, c: 1 } });
      }
    }

    const goalEndRow = currentRowIndex - 1;
    if (goalEndRow > goalStartRow) {
      merges.push({ s: { r: goalStartRow, c: 0 }, e: { r: goalEndRow, c: 0 } });
    }

    const summaryRowIndex = currentRowIndex;
    tableData.push([
      `Итого по цели: ${goalName}`,
      "",
      "",
      goalTotal.total,
      formatCountCell(goalTotal.unpaid, goalTotal.unpaidItems),
      formatCountCell(goalTotal.partial, goalTotal.partialItems),
      goalTotal.full,
    ]);
    merges.push({ s: { r: summaryRowIndex, c: 0 }, e: { r: summaryRowIndex, c: 2 } });
    currentRowIndex++;

    tableData.push([]);
    currentRowIndex++;

    addCounts(grandTotal, goalTotal);
  }

  const grandTotalRowIndex = currentRowIndex;
  tableData.push([
    "ОБЩИЙ ИТОГО",
    "",
    "",
    grandTotal.total,
    formatCountCell(grandTotal.unpaid, grandTotal.unpaidItems),
    formatCountCell(grandTotal.partial, grandTotal.partialItems),
    grandTotal.full,
  ]);
  merges.push({ s: { r: grandTotalRowIndex, c: 0 }, e: { r: grandTotalRowIndex, c: 2 } });

  return { tableData, merges };
}

function applyMiddleAlignmentStylesToXlsxBuffer(buf) {
  const zip = new PizZip(buf);

  let stylesXml = zip.file("xl/styles.xml")?.asText();
  if (stylesXml && stylesXml.includes("<cellXfs")) {
    stylesXml = stylesXml.replace(
      /<cellXfs count="(\d+)">/,
      (match, count) => `<cellXfs count="${parseInt(count, 10) + 1}">`
    );
    stylesXml = stylesXml.replace(
      "</cellXfs>",
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>'
    );
    zip.file("xl/styles.xml", stylesXml);

    for (const fileName of Object.keys(zip.files)) {
      if (fileName.startsWith("xl/worksheets/sheet") && fileName.endsWith(".xml")) {
        let sheetXml = zip.file(fileName).asText();
        sheetXml = sheetXml.replace(/<c r="([^"]+)"([^>]*)>/g, (match, r, rest) => {
          if (rest.includes('s="')) {
            return `<c r="${r}"${rest.replace(/s="\d+"/, 's="1"')}>`;
          }
          return `<c r="${r}" s="1"${rest}>`;
        });
        zip.file(fileName, sheetXml);
      }
    }
  }

  return zip.generate({ type: "nodebuffer" });
}

function createSheetWithMergesAndAlignment(tableData, merges, colWidths) {
  const ws = XLSX.utils.aoa_to_sheet(tableData);
  ws["!merges"] = merges;
  ws["!cols"] = colWidths;

  for (const cellAddress in ws) {
    if (cellAddress.startsWith("!")) continue;
    if (!ws[cellAddress].s) {
      ws[cellAddress].s = {};
    }
    ws[cellAddress].s.alignment = {
      horizontal: "center",
      vertical: "center",
      wrapText: true,
    };
  }

  return ws;
}

async function generateStatsXlsx(coupons, { year, month }) {
  const wb = XLSX.utils.book_new();
  const defaultColWidths = [
    { wch: 25 },
    { wch: 25 },
    { wch: 25 },
    { wch: 20 },
    { wch: 35 },
    { wch: 35 },
    { wch: 22 },
  ];

  // Лист 1: По месяцам
  const monthSheet = aggregateMonthSheet(coupons);
  const ws1 = createSheetWithMergesAndAlignment(
    monthSheet.tableData,
    monthSheet.merges,
    defaultColWidths
  );
  XLSX.utils.book_append_sheet(wb, ws1, "По месяцам");

  // Лист 2: По клиникам (древовидная структура)
  const clinicSheet = aggregateClinicSheet(coupons);
  const ws2 = createSheetWithMergesAndAlignment(
    clinicSheet.tableData,
    clinicSheet.merges,
    defaultColWidths
  );
  XLSX.utils.book_append_sheet(wb, ws2, "По клиникам");

  // Лист 3: По целям (древовидная структура)
  const goalSheet = aggregateGoalSheet(coupons);
  const ws3 = createSheetWithMergesAndAlignment(
    goalSheet.tableData,
    goalSheet.merges,
    defaultColWidths
  );
  XLSX.utils.book_append_sheet(wb, ws3, "По целям");

  const rawBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const finalBuf = applyMiddleAlignmentStylesToXlsxBuffer(rawBuf);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "talon-stat-"));
  const periodText = month ? `${year}-${String(month).padStart(2, "0")}` : `${year}`;
  const fileName = `talon_stat_${periodText}.xlsx`;
  const filePath = path.join(tempDir, fileName);

  fs.writeFileSync(filePath, finalBuf);
  return { tempDir, filePath, fileName, totalCount: coupons.length };
}

async function handle(bot, msg, options = {}) {
  const chatId = msg.chat.id;

  let params;
  try {
    params = parseStatParams(msg.text, options.now || new Date());
  } catch (err) {
    await bot.sendMessage(chatId, `Ошибка: ${err.message}`);
    return;
  }

  const periodText = formatPeriodText(params.year, params.month);

  const statusMsg = await bot.sendMessage(
    chatId,
    `⌛ Запрашиваю статистику по талонам за ${periodText}...`
  );

  let tempDir = null;

  try {
    const token = options.token || (await fetchToken());
    const coupons = await getCoupons(token, { year: params.year, month: params.month });

    if (!coupons || coupons.length === 0) {
      await bot.editMessageText(
        `За выбранный период (${periodText}) талоны не найдены.`,
        { chat_id: chatId, message_id: statusMsg.message_id }
      );
      return;
    }

    const result = await generateStatsXlsx(coupons, params);
    tempDir = result.tempDir;

    await bot.editMessageText(
      `📊 Статистика по талонам за ${periodText} сформирована!\n- Всего талонов: ${result.totalCount}`,
      { chat_id: chatId, message_id: statusMsg.message_id }
    );

    await bot.sendDocument(
      chatId,
      result.filePath,
      { caption: `Статистика по талонам за ${periodText} (всего: ${result.totalCount})` },
      { filename: result.fileName, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    );
  } catch (error) {
    logError("Ошибка при формировании статистики по талонам", error);
    try {
      await bot.editMessageText(
        `Произошла ошибка при формировании статистики: ${error.message}`,
        { chat_id: chatId, message_id: statusMsg.message_id }
      );
    } catch (msgErr) {
      await bot.sendMessage(chatId, `Произошла ошибка при формировании статистики: ${error.message}`);
    }
  } finally {
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
  aliases,
  description,
  handle,
  parseStatParams,
  aggregateCouponStats,
  generateStatsXlsx,
};
