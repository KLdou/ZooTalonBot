const path = require("path");
const fs = require("fs");
const PizZip = require("pizzip");
const { DOMParser } = require("@xmldom/xmldom");
const { log } = require("./helpers");

function removeFileAfterSend(filePath) {
  fs.unlink(filePath, (err) => {
    if (err) log(`Ошибка удаления файла ${filePath}: ${err.message}`);
    else log(`Удалён временный файл: ${filePath}`);
  });
}

// Упрощённый интерфейс для использования
async function openAndReplacePlaceholders(inputFilename, outputFilename, data) {
  if (!(await checkFile(outputFilename))) {
    null;
  }

  try {
    const content = fs.readFileSync(inputFilename, "binary");
    const zip = new PizZip(content);

    const xmlContent = zip.files["word/document.xml"].asText();
    const xmlDoc = new DOMParser().parseFromString(xmlContent, "text/xml");

    // 4. Находим и изменяем текст (например, заменяем "старое" на "новое")
    const textNodes = xmlDoc.getElementsByTagName("w:t");
    for (let i = 0; i < textNodes.length; i++) {
      let text = textNodes[i].textContent;

      // Замена {{propertyName}} на значения из data
      text = text.replace(/\{\{(\w+)\}\}/g, (match, propertyName) => {
        return data[propertyName]; // Если свойства нет, оставляем как было
      });

      textNodes[i].textContent = text;
    }

    // 5. Обновляем document.xml в ZIP-архиве
    zip.file("word/document.xml", xmlDoc.toString());

    // 6. Генерируем новый DOCX и сохраняем
    const newDocxBuffer = zip.generate({ type: "nodebuffer" });
    fs.writeFileSync(outputFilename, newDocxBuffer);
    log(`Документ успешно создан: ${outputFilename}`);
    return newDocxBuffer;
  } catch (err) {
    log(`Ошибка при генерации DOCX: ${err.message}`);
  }
}

async function checkFile(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  removeFileAfterSend,
  openAndReplacePlaceholders,
};
