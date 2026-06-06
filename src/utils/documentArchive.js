const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");

const BELARUS_TIME_ZONE = "Europe/Minsk";
const ROOT_DIR = path.join(__dirname, "..", "..");
const DOCUMENTS_DIR = path.join(ROOT_DIR, "documents");

const MONTHS = [
  { index: 1, nominative: "январь", aliases: ["январь", "января"] },
  { index: 2, nominative: "февраль", aliases: ["февраль", "февраля"] },
  { index: 3, nominative: "март", aliases: ["март", "марта"] },
  { index: 4, nominative: "апрель", aliases: ["апрель", "апреля"] },
  { index: 5, nominative: "май", aliases: ["май", "мая"] },
  { index: 6, nominative: "июнь", aliases: ["июнь", "июня"] },
  { index: 7, nominative: "июль", aliases: ["июль", "июля"] },
  { index: 8, nominative: "август", aliases: ["август", "августа"] },
  { index: 9, nominative: "сентябрь", aliases: ["сентябрь", "сентября"] },
  { index: 10, nominative: "октябрь", aliases: ["октябрь", "октября"] },
  { index: 11, nominative: "ноябрь", aliases: ["ноябрь", "ноября"] },
  { index: 12, nominative: "декабрь", aliases: ["декабрь", "декабря"] },
];

function normalizeMonthText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}

function parseRussianMonth(value) {
  const normalized = normalizeMonthText(value);
  if (!normalized) {
    return null;
  }

  const match = MONTHS.find((month) =>
    month.aliases.some((alias) => normalizeMonthText(alias) === normalized),
  );

  if (!match) {
    return null;
  }

  return {
    index: match.index,
    nominative: match.nominative,
  };
}

function getBelarusDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BELARUS_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year").value),
    month: Number(parts.find((part) => part.type === "month").value),
  };
}

function getCurrentBelarusYear(now = new Date()) {
  return getBelarusDateParts(now).year;
}

function getBelarusYearForMonth(requestedMonthIndex, now = new Date()) {
  const parts = getBelarusDateParts(now);
  if (requestedMonthIndex <= parts.month) {
    return parts.year;
  }
  return parts.year - 1;
}

function isGeneratedDocumentName(fileName) {
  return (
    path.extname(fileName).toLowerCase() === ".docx" &&
    fileName.includes(" - ")
  );
}

function getDocumentMadeAt(stats, options = {}) {
  if (options.preferMtimeForTests) {
    return stats.mtime;
  }

  if (
    stats.birthtime instanceof Date &&
    Number.isFinite(stats.birthtime.getTime()) &&
    stats.birthtime.getFullYear() > 2000
  ) {
    return stats.birthtime;
  }

  return stats.mtime;
}

function findDocumentsForMonth(options) {
  const documentsDir = options.documentsDir || DOCUMENTS_DIR;
  const month = options.month;
  const year = options.year;

  return fs
    .readdirSync(documentsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isGeneratedDocumentName(entry.name))
    .map((entry) => {
      const filePath = path.join(documentsDir, entry.name);
      const stats = fs.statSync(filePath);
      return {
        name: entry.name,
        path: filePath,
        madeAt: getDocumentMadeAt(stats, options),
      };
    })
    .filter((file) => {
      const parts = getBelarusDateParts(file.madeAt);
      return parts.year === year && parts.month === month;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

function createDocumentsArchive(options) {
  const month = options.month;
  const year = options.year;
  const documents = findDocumentsForMonth(options);
  const zip = new PizZip();

  documents.forEach((document) => {
    zip.file(document.name, fs.readFileSync(document.path));
  });

  return {
    buffer: zip.generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    }),
    count: documents.length,
    documents,
    fileName: `documents-${year}-${String(month).padStart(2, "0")}.zip`,
  };
}

module.exports = {
  BELARUS_TIME_ZONE,
  DOCUMENTS_DIR,
  MONTHS,
  parseRussianMonth,
  getBelarusDateParts,
  getCurrentBelarusYear,
  getBelarusYearForMonth,
  isGeneratedDocumentName,
  getDocumentMadeAt,
  findDocumentsForMonth,
  createDocumentsArchive,
};
