/**
 * Менеджер для работы с callback-запросами
 * @module callbackManager
 */

// Словарь для хранения обработчиков callback данных
const callbackHandlers = new Map();

/**
 * Регистрирует обработчик для определенного типа callback данных
 * @param {string} prefix - Префикс callback данных (например, "approve_")
 * @param {Function} handler - Функция-обработчик для данного типа callback
 */
function registerCallbackHandler(prefix, handler) {
  callbackHandlers.set(prefix, handler);
  console.log(`📝 Registered callback handler for prefix: ${prefix}`);
}

/**
 * Обрабатывает полученный callback запрос
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст callback запроса
 * @returns {Promise<boolean>} - Был ли обработан callback
 */
async function processCallback(bot, ctx) {
  try {
    const data = ctx.callbackQuery?.data;
    
    if (!data) {
      console.log('⚠️ Empty callback data received');
      return false;
    }
    
    console.log(`🔄 Processing callback data: ${data}`);
    
    // Находим подходящий обработчик по префиксу
    for (const [prefix, handler] of callbackHandlers.entries()) {
      if (data.startsWith(prefix)) {
        console.log(`🎯 Found handler for prefix: ${prefix}`);
        
        // Немедленно отправляем подтверждение о получении запроса
        await ctx.answerCbQuery('Запрос принят, обрабатываем...');
        
        // Извлекаем ID пользователя из данных
        const userId = data.substring(prefix.length);
        
        // Вызываем обработчик с нужными параметрами
        await handler(bot, ctx, userId);
        return true;
      }
    }
    
    console.log(`⚠️ No handler found for callback data: ${data}`);
    await ctx.answerCbQuery('Неизвестный тип запроса');
    return false;
  } catch (error) {
    console.error('❌ Error processing callback:', error);
    try {
      await ctx.answerCbQuery('Произошла ошибка: ' + error.message.substring(0, 50));
    } catch (e) {
      console.error('❌ Failed to send error callback answer:', e);
    }
    return false;
  }
}

module.exports = {
  registerCallbackHandler,
  processCallback
};