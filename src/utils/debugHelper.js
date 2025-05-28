/**
 * Вспомогательные функции для отладки
 * @module debugHelper
 */

/**
 * Выводит структуру объекта в консоль с ограничением глубины
 * @param {Object} obj - Объект для вывода
 * @param {number} [maxDepth=3] - Максимальная глубина вложенности
 * @param {number} [currentDepth=0] - Текущая глубина (для рекурсии)
 * @returns {Object} - Упрощенное представление объекта
 */
function simplifyObject(obj, maxDepth = 3, currentDepth = 0) {
  if (currentDepth >= maxDepth) {
    return typeof obj === 'object' && obj !== null 
      ? Array.isArray(obj) 
        ? '[Array]' 
        : '[Object]' 
      : obj;
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => simplifyObject(item, maxDepth, currentDepth + 1));
  }

  const result = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result[key] = simplifyObject(obj[key], maxDepth, currentDepth + 1);
    }
  }
  return result;
}

/**
 * Выводит структуру сообщения Telegram в консоль
 * @param {Object} message - Объект сообщения Telegram
 * @param {string} [prefix=''] - Префикс для вывода
 */
function logMessageStructure(message, prefix = '') {
  if (!message) {
    console.log(`${prefix}Сообщение отсутствует`);
    return;
  }

  // Получаем список всех ключей в сообщении
  const keys = Object.keys(message);
  console.log(`${prefix}📥 Поля сообщения: ${JSON.stringify(keys, null, 2)}`);

  // Проверяем наличие пересланного сообщения
  if (message.forward_origin || message.forward_from) {
    console.log(`${prefix}🔄 ОБНАРУЖЕНО ПЕРЕСЛАННОЕ СООБЩЕНИЕ (ФОРВАРД)`);
    
    // Выводим информацию о forward_origin, если есть
    if (message.forward_origin) {
      console.log(`${prefix}📩 forward_origin: ${JSON.stringify(simplifyObject(message.forward_origin), null, 2)}`);
      
      // Проверяем тип источника
      if (message.forward_origin.type) {
        console.log(`${prefix}📩 Тип источника: ${message.forward_origin.type}`);
      }
      
      // Проверяем информацию о канале/чате
      if (message.forward_origin.chat) {
        console.log(`${prefix}📩 Информация о чате: ${JSON.stringify(simplifyObject(message.forward_origin.chat), null, 2)}`);
      }
      
      // Проверяем информацию о пользователе
      if (message.forward_origin.sender_user) {
        console.log(`${prefix}📩 Информация о пользователе: ${JSON.stringify(simplifyObject(message.forward_origin.sender_user), null, 2)}`);
      }
    }
    
    // Выводим информацию о forward_from, если есть
    if (message.forward_from) {
      console.log(`${prefix}📩 forward_from: ${JSON.stringify(simplifyObject(message.forward_from), null, 2)}`);
    }
    
    // Выводим дату пересылки
    if (message.forward_date) {
      const date = new Date(message.forward_date * 1000);
      console.log(`${prefix}📩 Дата пересылки: ${date.toISOString()}`);
    }
  }

  // Проверяем наличие медиа
  if (message.photo || message.video || message.document || message.audio) {
    console.log(`${prefix}🖼️ ОБНАРУЖЕНО МЕДИА`);
    if (message.photo) console.log(`${prefix}📷 Фото: ${JSON.stringify(simplifyObject(message.photo), null, 2)}`);
    if (message.video) console.log(`${prefix}🎥 Видео: ${JSON.stringify(simplifyObject(message.video), null, 2)}`);
    if (message.document) console.log(`${prefix}📄 Документ: ${JSON.stringify(simplifyObject(message.document), null, 2)}`);
    if (message.audio) console.log(`${prefix}🎵 Аудио: ${JSON.stringify(simplifyObject(message.audio), null, 2)}`);
  }

  // Проверяем наличие текста или подписи
  if (message.text) {
    console.log(`${prefix}💬 Текст: "${message.text.substring(0, 100)}${message.text.length > 100 ? '...' : ''}"`);
  } else if (message.caption) {
    console.log(`${prefix}📝 Подпись: "${message.caption.substring(0, 100)}${message.caption.length > 100 ? '...' : ''}"`);
  }
}

module.exports = {
  logMessageStructure,
  simplifyObject
};
