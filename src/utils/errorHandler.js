/**
 * Утилиты для обработки ошибок Telegram API
 * @module errorHandler
 */

/**
 * Проверяет, заблокирован ли бот пользователем
 * @param {Error} error - Объект ошибки
 * @returns {boolean} - true, если бот заблокирован
 */
function isBotBlocked(error) {
  return error.description?.includes('bot was blocked by the user');
}

/**
 * Проверяет, не может ли бот начать разговор с пользователем
 * @param {Error} error - Объект ошибки
 * @returns {boolean} - true, если бот не может инициировать диалог
 */
function cantInitiateConversation(error) {
  return error.description?.includes('bot can\'t initiate conversation with a user');
}

/**
 * Проверяет, связана ли ошибка с ограничениями доступа к пользователю
 * @param {Error} error - Объект ошибки
 * @returns {boolean} - true, если ошибка связана с доступом к пользователю
 */
function isUserAccessError(error) {
  return isBotBlocked(error) || cantInitiateConversation(error);
}

/**
 * Проверяет, является ли ошибка ошибкой устаревшего callback запроса
 * @param {Error} error - Объект ошибки
 * @returns {boolean} - true, если callback запрос устарел
 */
function isCallbackQueryExpired(error) {
  return error.description?.includes('query is too old') || 
         error.description?.includes('query ID is invalid');
}

/**
 * Проверяет, является ли ошибка ошибкой лимита запросов
 * @param {Error} error - Объект ошибки
 * @returns {boolean} - true, если ошибка связана с лимитом запросов
 */
function isRateLimitError(error) {
  return error.code === 429 || error.description?.includes('retry after');
}

/**
 * Проверяет, не найден ли запрос на вступление в чат
 * @param {Error} error - Объект ошибки
 * @returns {boolean} - true, если запрос не найден
 */
function isJoinRequestMissing(error) {
  return error.description?.includes('HIDE_REQUESTER_MISSING');
}

/**
 * Форматирует сообщение об ошибке в зависимости от её типа
 * @param {Error} error - Объект ошибки
 * @param {string} userId - ID пользователя
 * @returns {string} - Форматированное сообщение об ошибке
 */
function formatUserAccessError(error, userId) {
  if (isBotBlocked(error)) {
    return `Пользователь ${userId} заблокировал бота. Невозможно отправить сообщение.`;
  }
  
  if (cantInitiateConversation(error)) {
    return `Пользователь ${userId} не начал диалог с ботом. Невозможно отправить сообщение.`;
  }
  
  return `Ошибка доступа к пользователю ${userId}: ${error.description || error.message}`;
}

module.exports = {
  isBotBlocked,
  cantInitiateConversation,
  isUserAccessError,
  isRateLimitError,
  isJoinRequestMissing,
  formatUserAccessError,
  isCallbackQueryExpired,
};