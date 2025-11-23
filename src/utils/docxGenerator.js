const path = require("path");
const fs = require("fs");
const PizZip = require("pizzip");
const { DOMParser } = require("@xmldom/xmldom");
const { log, logError } = require("./helpers");

// Функция транслитерации кириллицы в латиницу
function transliterate(text) {
  const translitMap = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo',
    'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M',
    'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U',
    'Ф': 'F', 'Х': 'H', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Sch',
    'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya'
  };

  return text.split('').map(char => translitMap[char] || char).join('');
}

function removeFileAfterSend(filePath) {
  fs.unlink(filePath, (err) => {
    if (err) logError(`Ошибка удаления файла ${filePath}`, err);
    else log(`Удалён временный файл: ${filePath}`);
  });
}

// Упрощённый интерфейс для использования
async function openAndReplacePlaceholders(inputFilename, outputFilename, data) {
  // Транслитерация имени файла для совместимости с системами без поддержки кириллицы
  outputFilename = transliterate(outputFilename);
  
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
    logError(`Ошибка при генерации DOCX`, err);
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
  transliterate,
};
