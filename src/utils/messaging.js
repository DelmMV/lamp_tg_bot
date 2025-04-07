/**
 * Функции для отправки сообщений в Telegram
 * @module messaging
 */
 
 const { isUserAccessError, isRateLimitError, isCallbackQueryExpired } = require('./errorHandler');
 
 /**
  * Безопасно отвечает на callback запрос с обработкой ошибок
  * @async
  * @param {Object} ctx - Контекст Telegraf
  * @param {string} text - Текст ответа
  * @param {Object} [options={}] - Дополнительные опции
  * @returns {Promise<boolean>} - Успешность операции
  */
 async function safeAnswerCallback(ctx, text, options = {}) {
   try {
     await ctx.answerCbQuery(text, options);
     return true;
   } catch (error) {
     // Игнорируем ошибки устаревших callback запросов
     if (isCallbackQueryExpired(error)) {
       console.log('⚠️ Попытка ответить на устаревший callback запрос:', text);
       return false;
     }
     
     console.error('❌ Ошибка при ответе на callback запрос:', error);
     return false;
   }
 }

 /**
  * Отправляет текстовое сообщение в Telegram с улучшенной обработкой ошибок
  * @async
  * @param {Object} bot - Экземпляр бота Telegraf
  * @param {number|string} chatId - ID чата для отправки сообщения
  * @param {string} message - Текст сообщения
  * @param {Object} [options={}] - Дополнительные параметры сообщения
  * @returns {Promise<Object|null>} - Результат отправки сообщения или null при ошибке
  * @throws {Error} - Пробрасывает ошибки, не связанные с доступом к пользователю
  */
 async function sendTelegramMessage(bot, chatId, message, options = {}) {
   try {
     return await bot.telegram.sendMessage(chatId, message, options);
   } catch (error) {
     console.error(`Error sending message to ${chatId}:`, error.message);
     
     // Если ошибка связана с ограничением запросов, пробуем повторить
     if (isRateLimitError(error)) {
       const retryAfter = error.parameters?.retry_after || 1;
       console.log(`Rate limited. Retrying after ${retryAfter} seconds...`);
       
       await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
       return sendTelegramMessage(bot, chatId, message, options);
     }
     
     // Ошибки доступа к пользователю не пробрасываем, а возвращаем null
     if (isUserAccessError(error)) {
       return null;
     }
     
     // Другие ошибки пробрасываем дальше
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
  sendTelegramMedia,
  safeAnswerCallback
};