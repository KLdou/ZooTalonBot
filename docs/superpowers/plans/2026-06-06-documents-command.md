# Documents Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/documents <месяц>` Telegram command that sends a ZIP archive with all generated DOCX documents from `documents/` made in the requested Russian month, using Belarus calendar dates.

**Architecture:** Keep command handling consistent with the existing `src/bot/comands` pattern by adding a new command module and registering it in `src/bot/comands/index.js`. Put month parsing, Belarus-time date extraction, document filtering, and ZIP creation in a focused utility module so it can be tested without Telegram. Reuse the existing `pizzip` dependency to create archives and avoid adding another package.

**Tech Stack:** Node.js 20, CommonJS modules, `node-telegram-bot-api`, `fs`, `path`, `Intl.DateTimeFormat` with `Europe/Minsk`, `pizzip`, built-in `assert` tests.

---

## Behavior Decisions

- Command syntax: `/documents июнь`.
- Accepted month forms: nominative and genitive Russian names, case-insensitive, with `ё` normalized to `е`: `январь/января`, `февраль/февраля`, `март/марта`, `апрель/апреля`, `май/мая`, `июнь/июня`, `июль/июля`, `август/августа`, `сентябрь/сентября`, `октябрь/октября`, `ноябрь/ноября`, `декабрь/декабря`.
- Year selection: current calendar year in Belarus time. For example, on `2026-06-06` `/documents июнь` returns June 2026 documents.
- Date source: file creation time from `fs.stat().birthtime` when valid; fallback to `mtime` when `birthtime` is missing or not useful. This preserves the user-facing meaning "made documents" while still working in Linux/Docker volumes.
- Document inclusion: only generated `.docx` files with the naming shape `Animal - Applicant.docx`. This excludes `example.docx`, `example_old.docx`, `zooshans-application-for-assistance.docx`, and any future templates without `" - "` in the name.
- Empty result: send a text message saying no documents were found for the requested month/year.
- Invalid month or missing argument: send usage text instead of falling through to normal message handling.
- Archive name: `documents-YYYY-MM.zip`, for example `documents-2026-06.zip`.
- ZIP contents: original DOCX filenames, no nested directories.

## Files To Create Or Modify

- Create: `src/utils/documentArchive.js`
  - Russian month parsing.
  - Belarus-time year/month extraction for any `Date`.
  - Generated-document filename filtering.
  - File selection from `documents/`.
  - ZIP buffer creation with `PizZip`.
- Create: `src/bot/comands/documents.js`
  - Parse command argument from `msg.text`.
  - Call archive utility.
  - Send ZIP with `bot.sendDocument`.
  - Send user-friendly messages for invalid month, missing month, and no results.
- Modify: `src/bot/comands/index.js`
  - Register the new command beside `/provider`.
- Create: `tests/documentsCommand.test.js`
  - Unit tests for month parsing, Belarus-time boundaries, file filtering, ZIP creation, and command responses.
- Modify: `package.json`
  - Run the existing optimization test and the new documents command test from `npm test`.

---

### Task 1: Add Tests For Month Parsing And Belarus-Time Date Extraction

**Files:**
- Create: `tests/documentsCommand.test.js`
- Test target to create later: `src/utils/documentArchive.js`

- [ ] **Step 1: Write the failing test file shell**

Create `tests/documentsCommand.test.js` with the test harness and the first two tests:

```js
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

async function run() {
  await testRussianMonthParsing();
  await testBelarusDateParts();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run the test and verify it fails because the module does not exist**

Run:

```bash
node tests/documentsCommand.test.js
```

Expected: FAIL with a module resolution error for `../src/utils/documentArchive`.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/documentsCommand.test.js
git commit -m "test: cover documents month parsing"
```

---

### Task 2: Implement Month Parsing And Belarus-Time Helpers

**Files:**
- Create: `src/utils/documentArchive.js`
- Test: `tests/documentsCommand.test.js`

- [ ] **Step 1: Add the minimal utility implementation**

Create `src/utils/documentArchive.js`:

```js
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

function isGeneratedDocumentName(fileName) {
  return (
    path.extname(fileName).toLowerCase() === ".docx" &&
    fileName.includes(" - ")
  );
}

function getDocumentMadeAt(stats) {
  if (
    stats.birthtime instanceof Date &&
    Number.isFinite(stats.birthtime.getTime()) &&
    stats.birthtime.getFullYear() > 2000
  ) {
    return stats.birthtime;
  }

  return stats.mtime;
}

module.exports = {
  BELARUS_TIME_ZONE,
  DOCUMENTS_DIR,
  MONTHS,
  parseRussianMonth,
  getBelarusDateParts,
  getCurrentBelarusYear,
  isGeneratedDocumentName,
  getDocumentMadeAt,
};
```

- [ ] **Step 2: Run the new test and verify it passes**

Run:

```bash
node tests/documentsCommand.test.js
```

Expected: PASS with no console output.

- [ ] **Step 3: Run the existing test suite**

Run:

```bash
npm test
```

Expected: PASS with no console output from `tests/optimization.test.js`.

- [ ] **Step 4: Commit the helper implementation**

```bash
git add src/utils/documentArchive.js tests/documentsCommand.test.js
git commit -m "feat: add document archive date helpers"
```

---

### Task 3: Add Document Filtering And ZIP Creation Tests

**Files:**
- Modify: `tests/documentsCommand.test.js`
- Modify later: `src/utils/documentArchive.js`

- [ ] **Step 1: Add tests for generated document filtering, file selection, and ZIP output**

Append these functions to `tests/documentsCommand.test.js` before `run()`:

```js
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
```

Then update `run()` in the same file:

```js
async function run() {
  await testRussianMonthParsing();
  await testBelarusDateParts();
  await testGeneratedDocumentNameFilter();
  await testFindDocumentsForMonthUsesBelarusCalendar();
  await testCreateDocumentsArchive();
}
```

- [ ] **Step 2: Run the test and verify it fails on missing functions**

Run:

```bash
node tests/documentsCommand.test.js
```

Expected: FAIL because `findDocumentsForMonth` and `createDocumentsArchive` are not exported yet.

- [ ] **Step 3: Commit the failing archive tests**

```bash
git add tests/documentsCommand.test.js
git commit -m "test: cover documents archive creation"
```

---

### Task 4: Implement Document Selection And ZIP Creation

**Files:**
- Modify: `src/utils/documentArchive.js`
- Test: `tests/documentsCommand.test.js`

- [ ] **Step 1: Extend the archive utility**

Replace the bottom portion of `src/utils/documentArchive.js` from `function getDocumentMadeAt` through `module.exports` with this code:

```js
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
  isGeneratedDocumentName,
  getDocumentMadeAt,
  findDocumentsForMonth,
  createDocumentsArchive,
};
```

- [ ] **Step 2: Run the archive tests**

Run:

```bash
node tests/documentsCommand.test.js
```

Expected: PASS with no console output.

- [ ] **Step 3: Run the existing tests**

Run:

```bash
npm test
```

Expected: PASS with no console output from the existing test file.

- [ ] **Step 4: Commit the archive implementation**

```bash
git add src/utils/documentArchive.js tests/documentsCommand.test.js
git commit -m "feat: create monthly document archives"
```

---

### Task 5: Add Command Handler Tests

**Files:**
- Modify: `tests/documentsCommand.test.js`
- Create later: `src/bot/comands/documents.js`

- [ ] **Step 1: Add fake Telegram bot tests**

Append these helpers and tests to `tests/documentsCommand.test.js` before `run()`:

```js
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

async function testDocumentsCommandRejectsMissingMonth() {
  const command = requireFresh("../src/bot/comands/documents");
  const bot = createFakeBot();

  await command.handle(bot, { chat: { id: 123 }, text: "/documents" });

  assert.strictEqual(bot.documents.length, 0);
  assert.strictEqual(bot.messages.length, 1);
  assert.match(bot.messages[0].text, /Использование: \/documents июнь/);
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
```

Update `run()`:

```js
async function run() {
  await testRussianMonthParsing();
  await testBelarusDateParts();
  await testGeneratedDocumentNameFilter();
  await testFindDocumentsForMonthUsesBelarusCalendar();
  await testCreateDocumentsArchive();
  await testDocumentsCommandRejectsMissingMonth();
  await testDocumentsCommandRejectsInvalidMonth();
  await testDocumentsCommandSendsArchive();
  await testDocumentsCommandReportsEmptyMonth();
}
```

- [ ] **Step 2: Run the test and verify it fails because the command module does not exist**

Run:

```bash
node tests/documentsCommand.test.js
```

Expected: FAIL with a module resolution error for `../src/bot/comands/documents`.

- [ ] **Step 3: Commit the failing command tests**

```bash
git add tests/documentsCommand.test.js
git commit -m "test: cover documents command responses"
```

---

### Task 6: Implement The `/documents` Command

**Files:**
- Create: `src/bot/comands/documents.js`
- Test: `tests/documentsCommand.test.js`

- [ ] **Step 1: Create the command module**

Create `src/bot/comands/documents.js`:

```js
const {
  parseRussianMonth,
  getCurrentBelarusYear,
  createDocumentsArchive,
} = require("../../utils/documentArchive");
const { logError } = require("../../utils/helpers");

const name = "/documents";

function getMonthArgument(text) {
  const parts = String(text || "").trim().split(/\s+/);
  return parts[1] || "";
}

async function handle(bot, msg, options = {}) {
  const chatId = msg.chat.id;
  const rawMonth = getMonthArgument(msg.text);

  if (!rawMonth) {
    await bot.sendMessage(
      chatId,
      "Использование: /documents июнь\nКоманда принимает месяц на русском языке и отправляет ZIP с документами за этот месяц текущего года.",
    );
    return;
  }

  const month = parseRussianMonth(rawMonth);
  if (!month) {
    await bot.sendMessage(
      chatId,
      `Не понял месяц "${rawMonth}". Пример команды: /documents июнь`,
    );
    return;
  }

  const year = getCurrentBelarusYear(options.now || new Date());

  try {
    const archive = createDocumentsArchive({
      documentsDir: options.documentsDir,
      month: month.index,
      year,
      preferMtimeForTests: options.preferMtimeForTests,
    });

    if (archive.count === 0) {
      await bot.sendMessage(
        chatId,
        `Документы за ${month.nominative} ${year} не найдены.`,
      );
      return;
    }

    await bot.sendDocument(
      chatId,
      archive.buffer,
      {
        caption: `Документы за ${month.nominative} ${year}: ${archive.count}`,
      },
      {
        filename: archive.fileName,
        contentType: "application/zip",
      },
    );
  } catch (error) {
    logError("Ошибка при создании архива документов", error);
    await bot.sendMessage(
      chatId,
      `Ошибка при создании архива документов: ${error.message}`,
    );
  }
}

module.exports = {
  name,
  handle,
  getMonthArgument,
};
```

- [ ] **Step 2: Run the command tests**

Run:

```bash
node tests/documentsCommand.test.js
```

Expected: PASS with no console output.

- [ ] **Step 3: Run the current full test command**

Run:

```bash
npm test
```

Expected: PASS with no console output from `tests/optimization.test.js`.

- [ ] **Step 4: Commit the command implementation**

```bash
git add src/bot/comands/documents.js tests/documentsCommand.test.js
git commit -m "feat: add documents archive command"
```

---

### Task 7: Register The Command And Include New Tests In `npm test`

**Files:**
- Modify: `src/bot/comands/index.js`
- Modify: `package.json`
- Test: `tests/documentsCommand.test.js`

- [ ] **Step 1: Register the command**

Change `src/bot/comands/index.js` from:

```js
const providerCommand = require("./provider");

const commands = [providerCommand];
```

to:

```js
const providerCommand = require("./provider");
const documentsCommand = require("./documents");

const commands = [providerCommand, documentsCommand];
```

- [ ] **Step 2: Update `npm test`**

Change the `scripts.test` value in `package.json` from:

```json
"test": "node tests/optimization.test.js"
```

to:

```json
"test": "node tests/optimization.test.js && node tests/documentsCommand.test.js"
```

- [ ] **Step 3: Run all tests**

Run:

```bash
npm test
```

Expected: PASS with no console output.

- [ ] **Step 4: Verify module loading**

Run:

```bash
node -e "require('./src/utils/documentArchive'); require('./src/bot/comands/documents'); require('./src/bot/handlers'); console.log('ok')"
```

Expected:

```text
ok
```

- [ ] **Step 5: Commit registration and test script changes**

```bash
git add src/bot/comands/index.js package.json tests/documentsCommand.test.js
git commit -m "chore: register documents command tests"
```

---

### Task 8: Manual Verification With Existing `documents/`

**Files:**
- No source changes.
- Uses existing `documents/` folder.

- [ ] **Step 1: Count expected files for a known month**

Run this command for June 2025 because the current `documents/` folder contains many June 2025 files:

```bash
node -e "const a=require('./src/utils/documentArchive'); const r=a.createDocumentsArchive({month:6,year:2025}); console.log(r.count, r.fileName)"
```

Expected: prints a positive count and `documents-2025-06.zip`. The exact count depends on the local contents of `documents/`.

- [ ] **Step 2: Verify current-year behavior**

Run this command for June 2026:

```bash
node -e "const a=require('./src/utils/documentArchive'); const r=a.createDocumentsArchive({month:6,year:2026}); console.log(r.count, r.fileName)"
```

Expected: prints the count of generated documents from June 2026 in `documents/` and `documents-2026-06.zip`. It is valid for the count to be `0` when there are no June 2026 generated files.

- [ ] **Step 3: Verify command behavior without starting Telegram polling**

Run:

```bash
node -e "const c=require('./src/bot/comands/documents'); const bot={sendMessage:async(...a)=>console.log('message',a[1]), sendDocument:async(...a)=>console.log('document',a[3].filename,a[2].caption)}; c.handle(bot,{chat:{id:1},text:'/documents июнь'},{now:new Date('2026-06-06T09:00:00Z')})"
```

Expected: either `document documents-2026-06.zip ...` when June 2026 generated documents exist, or `message Документы за июнь 2026 не найдены.` when none exist.

- [ ] **Step 4: Commit no additional files**

Run:

```bash
git status --short
```

Expected: clean working tree after the previous commits. Generated archives are kept in memory and are not written to disk.

---

## Rollout Notes

- No Docker Compose changes are needed. `docker-compose.yml` already mounts `./documents:/app/documents`, so the command will read the same document folder inside the container.
- No new npm dependency is needed. `pizzip` already exists in `package.json`.
- The command is protected by the existing allowed-user gate in `src/bot/handlers.js`, because commands are handled only after `allowedUsers` validation.
- The implementation does not delete or modify DOCX files. It reads matching files into memory and sends the generated ZIP buffer to Telegram.

## Self-Review

- Spec coverage: the plan covers the `/documents` command, Russian month argument parsing, Belarus-time date filtering, ZIP creation, Telegram sending, no-result and invalid-input responses, test coverage, and Docker volume behavior.
- Placeholder scan: the plan contains concrete filenames, functions, command examples, expected test results, and commit commands.
- Type consistency: `parseRussianMonth`, `getBelarusDateParts`, `getCurrentBelarusYear`, `isGeneratedDocumentName`, `getDocumentMadeAt`, `findDocumentsForMonth`, and `createDocumentsArchive` are introduced before use by the command module.
