const assert = require("assert");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const axios = require("axios");

const getTalonStatCmd = require("../src/bot/comands/getTalonStat");
const { getCoupons } = require("../src/services/api");

function createFakeBot() {
  return {
    messages: [],
    documents: [],
    editedMessages: [],
    async sendMessage(chatId, text, options) {
      this.messages.push({ chatId, text, options });
      return { message_id: this.messages.length };
    },
    async editMessageText(text, options) {
      this.editedMessages.push({ text, options });
    },
    async sendDocument(chatId, docPath, options, fileOptions) {
      this.documents.push({ chatId, docPath, options, fileOptions });
    },
  };
}

async function testParseStatParams() {
  const mockDate = new Date("2026-08-02T12:00:00.000Z");

  // 1. Default (no args) -> 2026, month null
  const p1 = getTalonStatCmd.parseStatParams("/gettalonstat", mockDate);
  assert.strictEqual(p1.year, 2026);
  assert.strictEqual(p1.month, null);

  // 2. Only year -> 2025, month null
  const p2 = getTalonStatCmd.parseStatParams("/gettalonstat 2025", mockDate);
  assert.strictEqual(p2.year, 2025);
  assert.strictEqual(p2.month, null);

  // 3. Only month number -> 2026, month 8
  const p3 = getTalonStatCmd.parseStatParams("/gettalonstat 8", mockDate);
  assert.strictEqual(p3.year, 2026);
  assert.strictEqual(p3.month, 8);

  // 4. Only month Russian name -> 2026, month 8
  const p4 = getTalonStatCmd.parseStatParams("/gettalonstat август", mockDate);
  assert.strictEqual(p4.year, 2026);
  assert.strictEqual(p4.month, 8);

  // 5. Year and Month number -> 2026, month 8
  const p5 = getTalonStatCmd.parseStatParams("/gettalonstat 2026 8", mockDate);
  assert.strictEqual(p5.year, 2026);
  assert.strictEqual(p5.month, 8);

  // 6. Month name and Year -> 2026, month 8
  const p6 = getTalonStatCmd.parseStatParams("/gettalonstat август 2026", mockDate);
  assert.strictEqual(p6.year, 2026);
  assert.strictEqual(p6.month, 8);

  // 7. Invalid parameter -> throws
  assert.throws(() => {
    getTalonStatCmd.parseStatParams("/gettalonstat abcxyz", mockDate);
  }, /Неизвестный параметр/);

  console.log("✅ parseStatParams tests passed!");
}

async function testAggregateCouponStats() {
  const sampleCoupons = [
    {
      _id: "1",
      year: 2026,
      effectiveDate: "2026-08-02T08:20:13.721Z",
      vet: { name: "ДокторВет" },
      goal: { name: "Лечение" },
    },
    {
      _id: "2",
      year: 2026,
      effectiveDate: "2026-08-02T09:20:13.721Z",
      vet: { name: "ДокторВет" },
      goal: { name: "Лечение" },
    },
    {
      _id: "3",
      year: 2026,
      effectiveDate: "2026-08-02T10:20:13.721Z",
      vet: { name: "ДокторВет" },
      goal: { name: "Вакцинация" },
    },
    {
      _id: "4",
      year: 2026,
      effectiveDate: "2026-08-02T11:20:13.721Z",
      vet: { name: "АльфаВет" },
      goal: { name: "Лечение" },
    },
  ];

  const aggregated = getTalonStatCmd.aggregateCouponStats(sampleCoupons);
  assert.strictEqual(aggregated.length, 3);

  // Check counts
  const alfaTreatment = aggregated.find((r) => r.clinicName === "АльфаВет" && r.goalName === "Лечение");
  assert.ok(alfaTreatment);
  assert.strictEqual(alfaTreatment.total, 1);

  const docTreatment = aggregated.find((r) => r.clinicName === "ДокторВет" && r.goalName === "Лечение");
  assert.ok(docTreatment);
  assert.strictEqual(docTreatment.total, 2);

  const docVaccine = aggregated.find((r) => r.clinicName === "ДокторВет" && r.goalName === "Вакцинация");
  assert.ok(docVaccine);
  assert.strictEqual(docVaccine.total, 1);

  console.log("✅ aggregateCouponStats tests passed!");
}

async function testGenerateStatsXlsx() {
  const sampleCoupons = [
    {
      _id: "1",
      name: "ДокторВет #524",
      owner: { usernameCanonical: "ashatan", username: "Ashatan" },
      user: { usernameCanonical: "adi", username: "ADI" },
      year: 2026,
      effectiveDate: "2026-08-02T08:20:13.721Z",
      vet: { name: "ДокторВет" },
      goal: { name: "Лечение" },
      expenses: 100,
      enclosed: 0, // unpaid
    },
    {
      _id: "2",
      name: "ДокторВет #525",
      owner: { usernameCanonical: "ashatan", username: "Ashatan" },
      user: { usernameCanonical: "ashatan", username: "Ashatan" },
      year: 2026,
      effectiveDate: "2026-08-02T09:20:13.721Z",
      vet: { name: "ДокторВет" },
      goal: { name: "Вакцинация" },
      expenses: 100,
      enclosed: 50, // partial
    },
    {
      _id: "3",
      name: "ДокторВет #526",
      year: 2026,
      effectiveDate: "2026-08-02T10:20:13.721Z",
      vet: { name: "ДокторВет" },
      goal: { name: "Осмотр" },
      expenses: 100,
      enclosed: 100, // full
    },
  ];

  const result = await getTalonStatCmd.generateStatsXlsx(sampleCoupons, { year: 2026, month: 8 });
  assert.ok(fs.existsSync(result.filePath));

  const workbook = XLSX.readFile(result.filePath);
  assert.ok(workbook.SheetNames.includes("По месяцам"));
  assert.ok(workbook.SheetNames.includes("По клиникам"));
  assert.ok(workbook.SheetNames.includes("По целям"));

  const sheet1 = workbook.Sheets["По месяцам"];
  const rows1 = XLSX.utils.sheet_to_json(sheet1, { header: 1 });
  assert.deepStrictEqual(rows1[0], [
    "Месяц",
    "Клиника",
    "Цель обращения",
    "Количество талонов",
    "Непогашенные",
    "Погашенные частично",
    "Полностью погашенные",
  ]);

  // Check row data for unpaid (with different user ADI) and partial coupon names
  const rowUnpaid = rows1.find((r) => r[2] === "Лечение");
  assert.ok(rowUnpaid);
  assert.strictEqual(rowUnpaid[4], "1 (ДокторВет #524 (ADI))");

  const rowPartial = rows1.find((r) => r[2] === "Вакцинация");
  assert.ok(rowPartial);
  assert.strictEqual(rowPartial[5], "1 (ДокторВет #525)");

  const summaryRow = rows1.find((r) => r[0] && r[0].startsWith("Итого за"));
  assert.ok(summaryRow);
  assert.strictEqual(summaryRow[3], 3); // Total
  assert.strictEqual(summaryRow[4], "1 (ДокторВет #524 (ADI))"); // Unpaid with user suffix
  assert.strictEqual(summaryRow[5], "1 (ДокторВет #525)"); // Partial with name
  assert.strictEqual(summaryRow[6], 1); // Full count

  fs.rmSync(result.tempDir, { recursive: true, force: true });

  // Test 20+ coupons limit (should output plain text string without formula)
  const manyCoupons = Array.from({ length: 25 }, (_, i) => ({
    _id: `id_${i}`,
    name: `Клиника #${i}`,
    year: 2026,
    effectiveDate: "2026-08-02T08:20:13.721Z",
    vet: { name: "ДокторВет" },
    goal: { name: "Лечение" },
    expenses: 100,
    enclosed: 0,
  }));

  const manyResult = await getTalonStatCmd.generateStatsXlsx(manyCoupons, { year: 2026, month: 8 });
  const manyWb = XLSX.readFile(manyResult.filePath);
  const manySheet1 = manyWb.Sheets["По месяцам"];
  const manyRows1 = XLSX.utils.sheet_to_json(manySheet1, { header: 1 });
  const manyRowUnpaid = manyRows1.find((r) => r[2] === "Лечение");
  assert.ok(manyRowUnpaid);
  assert.strictEqual(manyRowUnpaid[4].startsWith("25 ("), true);
  fs.rmSync(manyResult.tempDir, { recursive: true, force: true });

  console.log("✅ generateStatsXlsx tests passed!");
}

async function testGetCouponsApi() {
  const originalGet = axios.get;
  const { clearCouponsCache } = require("../src/services/api");
  clearCouponsCache();

  let callCount = 0;

  try {
    axios.get = async (url, config) => {
      callCount++;
      if (url.includes("/coupon-secured/v1/coupon")) {
        const offset = config.params.offset || 0;
        if (offset === 0) {
          return {
            data: {
              items: [
                {
                  _id: "c1",
                  year: 2026,
                  effectiveDate: "2026-08-02T10:00:00.000Z",
                  vet: { name: "ДокторВет" },
                  goal: { name: "Лечение" },
                },
                {
                  _id: "c2",
                  year: 2026,
                  effectiveDate: "2026-07-15T10:00:00.000Z",
                  vet: { name: "АльфаВет" },
                  goal: { name: "Осмотр" },
                },
              ],
              count: 2,
              offset: 0,
              limit: 100,
            },
          };
        }
      }
      return { data: { items: [], count: 0 } };
    };

    // First call -> cache miss, makes HTTP request
    const couponsAugust = await getCoupons("fake-token", { year: 2026, month: 8 });
    assert.strictEqual(couponsAugust.length, 1);
    assert.strictEqual(couponsAugust[0]._id, "c1");
    assert.strictEqual(callCount, 1);

    // Second call with same params -> cache hit, callCount should remain 1
    const cachedAugust = await getCoupons("fake-token", { year: 2026, month: 8 });
    assert.strictEqual(cachedAugust.length, 1);
    assert.strictEqual(callCount, 1);

    // Different params -> cache miss
    const couponsYear = await getCoupons("fake-token", { year: 2026 });
    assert.strictEqual(couponsYear.length, 2);
    assert.strictEqual(callCount, 2);
  } finally {
    axios.get = originalGet;
    clearCouponsCache();
  }

  console.log("✅ getCoupons API tests passed!");
}

async function testHandleCommandExecution() {
  const bot = createFakeBot();
  const originalGet = axios.get;

  try {
    axios.get = async (url, config) => {
      if (url.includes("/coupon-secured/v1/coupon")) {
        return {
          data: {
            items: [
              {
                _id: "c1",
                year: 2026,
                effectiveDate: "2026-08-02T10:00:00.000Z",
                vet: { name: "ДокторВет" },
                goal: { name: "Лечение" },
              },
            ],
            count: 1,
            offset: 0,
            limit: 100,
          },
        };
      }
      return { data: { items: [], count: 0 } };
    };

    await getTalonStatCmd.handle(
      bot,
      { text: "/gettalonstat 2026 8", chat: { id: 777 } },
      {
        token: "test-token",
        now: new Date("2026-08-02T12:00:00.000Z"),
      }
    );

    assert.ok(bot.messages.length >= 1);
    assert.strictEqual(bot.messages[0].chatId, 777);
    assert.ok(bot.documents.length === 1);
    assert.strictEqual(bot.documents[0].chatId, 777);
    assert.strictEqual(bot.documents[0].fileOptions.filename, "talon_stat_2026-08.xlsx");
  } finally {
    axios.get = originalGet;
  }

  console.log("✅ handle command execution tests passed!");
}

async function run() {
  await testParseStatParams();
  await testAggregateCouponStats();
  await testGenerateStatsXlsx();
  await testGetCouponsApi();
  await testHandleCommandExecution();
  console.log("All getTalonStat tests passed successfully!");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
