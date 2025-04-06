/**
 * Функции для отправки сообщений в Telegram
 * @module messaging
 */

/**
 * Отправляет текстовое сообщение в Telegram
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {number|string} chatId - ID чата для отправки сообщения
 * @param {string} message - Текст сообщения
 * @param {Object} [options={}] - Дополнительные параметры сообщения
 * @returns {Promise<Object>} - Результат отправки сообщения
 */
async function sendTelegramMessage(bot, chatId, message, options = {}) {
  try {
    return await bot.telegram.sendMessage(chatId, message, options);
  } catch (error) {
    console.error(`Error sending message to ${chatId}:`, error.message);
    
    // Попытка повторной отправки при временных ошибках
    if (error.code === 429 || error.description?.includes('retry after')) {
      const retryAfter = error.parameters?.retry_after || 1;
      console.log(`Rate limited. Retrying after ${retryAfter} seconds...`);
      
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return sendTelegramMessage(bot, chatId, message, options);
    }
    
    throw error;
  }
}

/**
 * Отправляет медиа-сообщение в Telegram
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {number|string} chatId - ID чата для отправки медиа
 * @param {Object} content - Контент для отправки
 * @param {Object} [options={}] - Дополнительные параметры
 * @returns {Promise<Object>} - Результат отправки медиа
 */
async function sendTelegramMedia(bot, chatId, content, options = {}) {
  try {
    return await bot.telegram.sendCopy(chatId, content, options);
  } catch (error) {
    console.error(`Error sending media to ${chatId}:`, error.message);
    
    // Логирование дополнительных деталей ошибки
    if (error.response) {
      console.error('Error details:', JSON.stringify(error.response, null, 2));
    }
    
    throw error;
  }
}

module.exports = {
  sendTelegramMessage,
  sendTelegramMedia
};