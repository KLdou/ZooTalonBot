/**
 * Модуль валидации данных для ZooTalonBot
 * Содержит функции для проверки корректности введённых пользователем данных
 */

/**
 * Валидация ФИО - должно содержать минимум 2 слова (Фамилия Имя)
 * @param {string} fio - ФИО для проверки
 * @returns {{valid: boolean, error?: string}}
 */
function validateFIO(fio) {
  if (!fio || typeof fio !== "string" || fio.trim().length === 0) {
    return { valid: false, error: "ФИО не может быть пустым" };
  }
  
  const parts = fio.trim().split(/\s+/);
  if (parts.length < 2) {
    return { valid: false, error: "ФИО должно содержать минимум Фамилию и Имя" };
  }
  
  return { valid: true };
}

/**
 * Валидация даты - проверка на корректность формата
 * @param {string} dateString - Дата для проверки
 * @returns {{valid: boolean, error?: string}}
 */
function validateDate(dateString) {
  if (!dateString) {
    return { valid: false, error: "Дата не может быть пустой" };
  }
  
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return { valid: false, error: "Некорректный формат даты" };
  }
  
  return { valid: true };
}

/**
 * Валидация телефона - базовая проверка на наличие
 * @param {string} phone - Телефон для проверки
 * @returns {{valid: boolean, error?: string}}
 */
function validatePhone(phone) {
  if (!phone || phone.trim().length === 0) {
    return { valid: false, error: "Телефон не может быть пустым" };
  }
  
  return { valid: true };
}

/**
 * Валидация адреса - базовая проверка на наличие
 * @param {string} address - Адрес для проверки
 * @returns {{valid: boolean, error?: string}}
 */
function validateAddress(address) {
  if (!address || address.trim().length === 0) {
    return { valid: false, error: "Адрес не может быть пустым" };
  }
  
  return { valid: true };
}

/**
 * Валидация клиники - базовая проверка на наличие
 * @param {string} clinic - Название клиники для проверки
 * @returns {{valid: boolean, error?: string}}
 */
function validateClinic(clinic) {
  if (!clinic || clinic.trim().length === 0) {
    return { valid: false, error: "Клиника не может быть пустой" };
  }
  
  return { valid: true };
}

/**
 * Валидация имени животного - базовая проверка на наличие
 * @param {string|string[]} animalName - Имя животного для проверки
 * @returns {{valid: boolean, error?: string}}
 */
function validateAnimalName(animalName) {
  if (!animalName) {
    return { valid: false, error: "Имя животного не может быть пустым" };
  }
  
  // Если это массив - проверяем каждый элемент
  if (Array.isArray(animalName)) {
    if (animalName.length === 0) {
      return { valid: false, error: "Имя животного не может быть пустым" };
    }
    for (const name of animalName) {
      if (!name || name.trim().length === 0) {
        return { valid: false, error: "Имя животного не может быть пустым" };
      }
    }
  } else {
    if (animalName.trim().length === 0) {
      return { valid: false, error: "Имя животного не может быть пустым" };
    }
  }
  
  return { valid: true };
}

/**
 * Валидация типа животного - базовая проверка на наличие
 * @param {string} animalType - Тип животного для проверки
 * @returns {{valid: boolean, error?: string}}
 */
function validateAnimalType(animalType) {
  if (!animalType || animalType.trim().length === 0) {
    return { valid: false, error: "Тип животного не может быть пустым" };
  }
  
  return { valid: true };
}

/**
 * Валидация типа обращения - базовая проверка на наличие
 * @param {string} type - Тип обращения для проверки
 * @returns {{valid: boolean, error?: string}}
 */
function validateType(type) {
  if (!type || type.trim().length === 0) {
    return { valid: false, error: "Цель визита не может быть пустой" };
  }
  
  return { valid: true };
}

/**
 * Общая валидация всех полей объекта baseData
 * @param {Object} baseData - Объект с данными пользователя
 * @returns {Object} - Объект с ошибками { fieldName: "error message", ... }
 */
function validateAllFields(baseData) {
  const errors = {};
  
  // Валидация ФИО (расширенная)
  const fioCheck = validateFIO(baseData.fio);
  if (!fioCheck.valid) {
    errors.fio = fioCheck.error;
  }
  
  // Валидация даты (расширенная, если дата указана)
  if (baseData.date) {
    const dateCheck = validateDate(baseData.date);
    if (!dateCheck.valid) {
      errors.date = dateCheck.error;
    }
  }
  
  // Базовые проверки на пустоту для обязательных полей
  const phoneCheck = validatePhone(baseData.phone);
  if (!phoneCheck.valid) {
    errors.phone = phoneCheck.error;
  }
  
  const addressCheck = validateAddress(baseData.address);
  if (!addressCheck.valid) {
    errors.address = addressCheck.error;
  }
  
  const clinicCheck = validateClinic(baseData.clinic);
  if (!clinicCheck.valid) {
    errors.clinic = clinicCheck.error;
  }
  
  const animalNameCheck = validateAnimalName(baseData.animal_name);
  if (!animalNameCheck.valid) {
    errors.animal_name = animalNameCheck.error;
  }
  
  const animalTypeCheck = validateAnimalType(baseData.animal_type);
  if (!animalTypeCheck.valid) {
    errors.animal_type = animalTypeCheck.error;
  }
  
  const typeCheck = validateType(baseData.type);
  if (!typeCheck.valid) {
    errors.type = typeCheck.error;
  }
  
  return errors;
}

module.exports = {
  validateFIO,
  validateDate,
  validatePhone,
  validateAddress,
  validateClinic,
  validateAnimalName,
  validateAnimalType,
  validateType,
  validateAllFields,
};
