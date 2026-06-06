const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function requireFresh(modulePath) {
  clearModule(modulePath);
  return require(modulePath);
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zoo-documents-test-"));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testRussianMonthParsing() {
  const archive = requireFresh("../src/utils/documentArchive");

  assert.deepStrictEqual(archive.parseRussianMonth("июнь"), {
    index: 6,
    nominative: "июнь",
  });
  assert.deepStrictEqual(archive.parseRussianMonth("ИЮНЯ"), {
    index: 6,
    nominative: "июнь",
  });
  assert.deepStrictEqual(archive.parseRussianMonth("февраль"), {
    index: 2,
    nominative: "февраль",
  });
  assert.deepStrictEqual(archive.parseRussianMonth("февраля"), {
    index: 2,
    nominative: "февраль",
  });
  assert.strictEqual(archive.parseRussianMonth("june"), null);
  assert.strictEqual(archive.parseRussianMonth(""), null);
}

async function testBelarusDateParts() {
  const archive = requireFresh("../src/utils/documentArchive");

  assert.deepStrictEqual(
    archive.getBelarusDateParts(new Date("2026-05-31T20:59:59.000Z")),
    { year: 2026, month: 5 },
  );
  assert.deepStrictEqual(
    archive.getBelarusDateParts(new Date("2026-05-31T21:00:00.000Z")),
    { year: 2026, month: 6 },
  );
}

async function testGeneratedDocumentNameFilter() {
  const archive = requireFresh("../src/utils/documentArchive");

  assert.strictEqual(
    archive.isGeneratedDocumentName("Луна - Иванова Анна.docx"),
    true,
  );
  assert.strictEqual(
    archive.isGeneratedDocumentName("Luna - Ivanova Anna.docx"),
    true,
  );
  assert.strictEqual(archive.isGeneratedDocumentName("example.docx"), false);
  assert.strictEqual(archive.isGeneratedDocumentName("example_old.docx"), false);
  assert.strictEqual(
    archive.isGeneratedDocumentName("zooshans-application-for-assistance.docx"),
    false,
  );
  assert.strictEqual(archive.isGeneratedDocumentName("Луна - Иванова Анна.pdf"), false);
}

async function testFindDocumentsForMonthUsesBelarusCalendar() {
  const archive = requireFresh("../src/utils/documentArchive");
  const dir = makeTempDir();

  try {
    const juneFile = path.join(dir, "Луна - Иванова Анна.docx");
    const mayFile = path.join(dir, "Май - Петров Петр.docx");
    const templateFile = path.join(dir, "example.docx");

    fs.writeFileSync(juneFile, Buffer.from("june"));
    fs.writeFileSync(mayFile, Buffer.from("may"));
    fs.writeFileSync(templateFile, Buffer.from("template"));

    const juneDate = new Date("2026-05-31T21:00:00.000Z");
    const mayDate = new Date("2026-05-31T20:59:59.000Z");
    fs.utimesSync(juneFile, juneDate, juneDate);
    fs.utimesSync(mayFile, mayDate, mayDate);
    fs.utimesSync(templateFile, juneDate, juneDate);

    const found = archive.findDocumentsForMonth({
      documentsDir: dir,
      month: 6,
      year: 2026,
      preferMtimeForTests: true,
    });

    assert.deepStrictEqual(
      found.map((file) => file.name),
      ["Луна - Иванова Анна.docx"],
    );
  } finally {
    removeTempDir(dir);
  }
}

async function testCreateDocumentsArchive() {
  const archive = requireFresh("../src/utils/documentArchive");
  const dir = makeTempDir();

  try {
    const first = path.join(dir, "Луна - Иванова Анна.docx");
    const second = path.join(dir, "Барсик - Петров Петр.docx");
    const ignored = path.join(dir, "example.docx");
    const madeAt = new Date("2026-06-15T10:00:00.000Z");

    fs.writeFileSync(first, Buffer.from("first doc"));
    fs.writeFileSync(second, Buffer.from("second doc"));
    fs.writeFileSync(ignored, Buffer.from("template"));
    fs.utimesSync(first, madeAt, madeAt);
    fs.utimesSync(second, madeAt, madeAt);
    fs.utimesSync(ignored, madeAt, madeAt);

    const result = archive.createDocumentsArchive({
      documentsDir: dir,
      month: 6,
      year: 2026,
      preferMtimeForTests: true,
    });

    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.fileName, "documents-2026-06.zip");
    assert.ok(Buffer.isBuffer(result.buffer));

    const PizZip = require("pizzip");
    const zip = new PizZip(result.buffer);
    assert.deepStrictEqual(Object.keys(zip.files).sort(), [
      "Барсик - Петров Петр.docx",
      "Луна - Иванова Анна.docx",
    ]);
    assert.strictEqual(zip.files["Луна - Иванова Анна.docx"].asText(), "first doc");
    assert.strictEqual(zip.files["Барсик - Петров Петр.docx"].asText(), "second doc");
  } finally {
    removeTempDir(dir);
  }
}

function createFakeBot() {
  return {
    messages: [],
    documents: [],
    async sendMessage(chatId, text, options) {
      this.messages.push({ chatId, text, options });
    },
    async sendDocument(chatId, document, options, fileOptions) {
      this.documents.push({ chatId, document, options, fileOptions });
    },
  };
}

async function testDocumentsCommandShowsButtonsWhenNoMonth() {
  const command = requireFresh("../src/bot/comands/documents");
  const bot = createFakeBot();

  await command.handle(
    bot,
    { chat: { id: 123 }, text: "/documents" },
    { now: new Date("2026-06-06T09:00:00Z") }
  );

  assert.strictEqual(bot.documents.length, 0);
  assert.strictEqual(bot.messages.length, 1);
  assert.strictEqual(bot.messages[0].chatId, 123);
  assert.strictEqual(bot.messages[0].text, "Выберите месяц для выгрузки документов:");

  const keyboard = bot.messages[0].options.reply_markup.inline_keyboard;
  assert.strictEqual(keyboard.length, 3);
  assert.strictEqual(keyboard[0][0].text, "Июнь 2026");
  assert.strictEqual(JSON.parse(keyboard[0][0].callback_data).action, "send_docs");
  assert.strictEqual(JSON.parse(keyboard[0][0].callback_data).month, 6);
  assert.strictEqual(JSON.parse(keyboard[0][0].callback_data).year, 2026);

  assert.strictEqual(keyboard[1][0].text, "Май 2026");
  assert.strictEqual(keyboard[2][0].text, "Апрель 2026");
}

async function testDocumentsCommandRejectsInvalidMonth() {
  const command = requireFresh("../src/bot/comands/documents");
  const bot = createFakeBot();

  await command.handle(bot, { chat: { id: 123 }, text: "/documents banana" });

  assert.strictEqual(bot.documents.length, 0);
  assert.strictEqual(bot.messages.length, 1);
  assert.match(bot.messages[0].text, /Не понял месяц/);
}

async function testDocumentsCommandSendsArchive() {
  const command = requireFresh("../src/bot/comands/documents");
  const dir = makeTempDir();
  const bot = createFakeBot();

  try {
    const filePath = path.join(dir, "Луна - Иванова Анна.docx");
    const madeAt = new Date("2026-06-15T10:00:00.000Z");
    fs.writeFileSync(filePath, Buffer.from("doc"));
    fs.utimesSync(filePath, madeAt, madeAt);

    await command.handle(
      bot,
      { chat: { id: 123 }, text: "/documents июнь" },
      {
        documentsDir: dir,
        now: new Date("2026-06-20T10:00:00.000Z"),
        preferMtimeForTests: true,
      },
    );

    assert.strictEqual(bot.messages.length, 0);
    assert.strictEqual(bot.documents.length, 1);
    assert.strictEqual(bot.documents[0].chatId, 123);
    assert.ok(Buffer.isBuffer(bot.documents[0].document));
    assert.match(bot.documents[0].options.caption, /Документы за июнь 2026: 1/);
    assert.strictEqual(bot.documents[0].fileOptions.filename, "documents-2026-06.zip");
    assert.strictEqual(bot.documents[0].fileOptions.contentType, "application/zip");
  } finally {
    removeTempDir(dir);
  }
}

async function testDocumentsCommandReportsEmptyMonth() {
  const command = requireFresh("../src/bot/comands/documents");
  const dir = makeTempDir();
  const bot = createFakeBot();

  try {
    await command.handle(
      bot,
      { chat: { id: 123 }, text: "/documents июнь" },
      {
        documentsDir: dir,
        now: new Date("2026-06-20T10:00:00.000Z"),
        preferMtimeForTests: true,
      },
    );

    assert.strictEqual(bot.documents.length, 0);
    assert.strictEqual(bot.messages.length, 1);
    assert.match(bot.messages[0].text, /Документы за июнь 2026 не найдены/);
  } finally {
    removeTempDir(dir);
  }
}

async function testBelarusYearForMonth() {
  const archive = requireFresh("../src/utils/documentArchive");

  // In June 2026 (Europe/Minsk time, so UTC 2026-06-06T09:00:00Z is 12:00 in Minsk)
  const juneNow = new Date("2026-06-06T09:00:00Z");
  assert.strictEqual(archive.getBelarusYearForMonth(6, juneNow), 2026);
  assert.strictEqual(archive.getBelarusYearForMonth(5, juneNow), 2026);
  assert.strictEqual(archive.getBelarusYearForMonth(12, juneNow), 2025);

  // In January 2026
  const janNow = new Date("2026-01-01T09:00:00Z");
  assert.strictEqual(archive.getBelarusYearForMonth(12, janNow), 2025);
  assert.strictEqual(archive.getBelarusYearForMonth(1, janNow), 2026);
}

async function testRecentMonths() {
  const archive = requireFresh("../src/utils/documentArchive");

  // In June 2026
  const juneNow = new Date("2026-06-06T09:00:00Z");
  assert.deepStrictEqual(archive.getRecentMonths(juneNow), [
    { index: 6, nominative: "июнь", year: 2026 },
    { index: 5, nominative: "май", year: 2026 },
    { index: 4, nominative: "апрель", year: 2026 },
  ]);

  // In January 2026
  const janNow = new Date("2026-01-01T09:00:00Z");
  assert.deepStrictEqual(archive.getRecentMonths(janNow), [
    { index: 1, nominative: "январь", year: 2026 },
    { index: 12, nominative: "декабрь", year: 2025 },
    { index: 11, nominative: "ноябрь", year: 2025 },
  ]);
}

async function testSendDocsCallbackQuery() {
  const { handleCallbackAction } = requireFresh("../src/bot/callbacks/index");
  const bot = createFakeBot();
  const dir = makeTempDir();

  try {
    const filePath = path.join(dir, "Луна - Иванова Анна.docx");
    const madeAt = new Date("2026-06-15T10:00:00.000Z");
    fs.writeFileSync(filePath, Buffer.from("doc"));
    fs.utimesSync(filePath, madeAt, madeAt);

    const key = { action: "send_docs", month: 6, year: 2026 };
    const handled = await handleCallbackAction(
      bot,
      123,
      key,
      {
        documentsDir: dir,
        preferMtimeForTests: true,
      }
    );

    assert.strictEqual(handled, true);
    assert.strictEqual(bot.messages.length, 0);
    assert.strictEqual(bot.documents.length, 1);
    assert.strictEqual(bot.documents[0].chatId, 123);
    assert.ok(Buffer.isBuffer(bot.documents[0].document));
    assert.match(bot.documents[0].options.caption, /Документы за июнь 2026: 1/);
    assert.strictEqual(bot.documents[0].fileOptions.filename, "documents-2026-06.zip");
  } finally {
    removeTempDir(dir);
  }
}

async function run() {
  await testRussianMonthParsing();
  await testBelarusDateParts();
  await testBelarusYearForMonth();
  await testRecentMonths();
  await testGeneratedDocumentNameFilter();
  await testFindDocumentsForMonthUsesBelarusCalendar();
  await testCreateDocumentsArchive();
  await testDocumentsCommandShowsButtonsWhenNoMonth();
  await testDocumentsCommandRejectsInvalidMonth();
  await testDocumentsCommandSendsArchive();
  await testDocumentsCommandReportsEmptyMonth();
  await testSendDocsCallbackQuery();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
