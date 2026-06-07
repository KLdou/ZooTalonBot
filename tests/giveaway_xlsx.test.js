const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const XLSX = require("xlsx");

function testXlsxGeneration() {
  const commentsRows = [
    ["дата", "пользователь", "комментарий", "проверка"],
    ["07.06.2026 23:00:00", "user1", "comment 1", ""],
    ["07.06.2026 23:01:00", "user2", "comment 2", "проверить"],
  ];

  const duplicatesRows = [
    ["дата", "пользователь", "комментарий"],
    ["07.06.2026 23:00:00", "user1", "comment 1"],
  ];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xlsx-test-"));
  const xlsxPath = path.join(tempDir, "test.xlsx");

  const wb = XLSX.utils.book_new();
  const wsUnique = XLSX.utils.aoa_to_sheet(commentsRows);
  XLSX.utils.book_append_sheet(wb, wsUnique, "Уникальные");

  const wsDuplicates = XLSX.utils.aoa_to_sheet(duplicatesRows);
  XLSX.utils.book_append_sheet(wb, wsDuplicates, "Дубликаты");

  XLSX.writeFile(wb, xlsxPath);

  assert.ok(fs.existsSync(xlsxPath));

  const readWb = XLSX.readFile(xlsxPath);
  assert.deepStrictEqual(readWb.SheetNames, ["Уникальные", "Дубликаты"]);

  const readWsUnique = readWb.Sheets["Уникальные"];
  const dataUnique = XLSX.utils.sheet_to_json(readWsUnique, { header: 1 });
  assert.deepStrictEqual(dataUnique, commentsRows);

  const readWsDuplicates = readWb.Sheets["Дубликаты"];
  const dataDuplicates = XLSX.utils.sheet_to_json(readWsDuplicates, { header: 1 });
  assert.deepStrictEqual(dataDuplicates, duplicatesRows);

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("XLSX mock generation verified successfully!");
}

testXlsxGeneration();
