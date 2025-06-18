/**
 * Утилиты для обработки ошибок Telegram API
 * @module errorHandler
 */

const { ADMIN_CHAT_ID, LAMP_THREAD_ID, MODULES } = require('../config')

/**
 * Проверяет, заблокирован ли бот пользователем
 * @param {Error} error - Объект ошибки
 * @returns {boolean} - true, если бот заблокирован
 */
function isBotBlocked(error) {
	return error.description?.includes('bot was blocked by the user')
}

/**
 * Проверяет, не может ли бот начать разговор с пользователем
 * @param {Error} error - Объект ошибки
 * @returns {boolean} - true, если бот не может инициировать диалог
 */
function cantInitiateConversation(error) {
	return error.description?.includes(
		"bot can't initiate conversation with a user"
	)
}

/**
 * Проверяет, связана ли ошибка с ограничениями доступа к пользователю
 * @param {Error} error - Объект ошибки
 * @returns {boolean} - true, если ошибка связана с доступом к пользователю
 */
function isUserAccessError(error) {
	return isBotBlocked(error) || cantInitiateConversation(error)
}

/**
 * Проверяет, является ли ошибка ошибкой устаревшего callback запроса
 * @param {Error} error - Объект ошибки
 * @returns {boolean} - true, если callback запрос устарел
 */
function isCallbackQueryExpired(error) {
	return (
		error.description?.includes('query is too old') ||
		error.description?.includes('query ID is invalid')
	)
}

/**
 * Проверяет, является ли ошибка ошибкой лимита запросов
 * @param {Error} error - Объект ошибки
 * @returns {boolean} - true, если ошибка связана с лимитом запросов
 */
function isRateLimitError(error) {
	return error.code === 429 || error.description?.includes('retry after')
}

/**
 * Проверяет, не найден ли запрос на вступление в чат
 * @param {Error} error - Объект ошибки
 * @returns {boolean} - true, если запрос не найден
 */
function isJoinRequestMissing(error) {
	return error.description?.includes('HIDE_REQUESTER_MISSING')
}

/**
 * Форматирует сообщение об ошибке в зависимости от её типа
 * @param {Error} error - Объект ошибки
 * @param {string} userId - ID пользователя
 * @returns {string} - Форматированное сообщение об ошибке
 */
function formatUserAccessError(error, userId) {
	if (isBotBlocked(error)) {
		return `Пользователь ${userId} заблокировал бота. Невозможно отправить сообщение.`
	}

	if (cantInitiateConversation(error)) {
		return `Пользователь ${userId} не начал диалог с ботом. Невозможно отправить сообщение.`
	}

	return `Ошибка доступа к пользователю ${userId}: ${
		error.description || error.message
	}`
}

/**
 * Отправляет ошибку в консоль и админский чат
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Error} error - Объект ошибки
 * @param {string} context - Контекст, в котором произошла ошибка
 * @param {Object} [options={}] - Дополнительные параметры
 * @param {boolean} [options.notifyAdmin=true] - Отправлять ли уведомление админу
 * @param {string|number} [options.userId] - ID пользователя, связанного с ошибкой
 * @param {string} [options.functionName] - Название функции, где произошла ошибка
 */
async function logError(bot, error, context, options = {}) {
	const { notifyAdmin = true, userId = null, functionName = null } = options

	// Логирование в консоль
	console.error(`❌ Ошибка: ${context || 'без контекста'}:`, error)

	// Если не нужно уведомлять админа, просто выходим
	if (!notifyAdmin || !bot) return

	try {
		// Формируем сообщение об ошибке
		let errorMessage = `🚨 <b>Ошибка в боте</b>\n\n`

		if (functionName) {
			errorMessage += `<b>Функция:</b> ${functionName}\n`
		}

		errorMessage += `<b>Контекст:</b> ${context || 'не указан'}\n`
		errorMessage += `<b>Ошибка:</b> ${error.message || 'неизвестная ошибка'}\n`

		if (userId) {
			errorMessage += `<b>Пользователь:</b> <a href="tg://user?id=${userId}">${userId}</a>\n`
		}

		// Добавляем специфическую информацию в зависимости от типа ошибки
		if (isUserAccessError(error) && userId) {
			errorMessage += `\n<i>${formatUserAccessError(error, userId)}</i>\n`
		}

		// Добавляем стек вызовов для нестандартных ошибок
		if (!isUserAccessError(error) && !isRateLimitError(error) && error.stack) {
			const stackTrace = error.stack.split('\n').slice(0, 3).join('\n')
			errorMessage += `\n<pre>${stackTrace}</pre>`
		}

		// Отправляем уведомление админам с игнорированием ошибок при отправке
		await bot.telegram
			.sendMessage(ADMIN_CHAT_ID, errorMessage, {
				message_thread_id: LAMP_THREAD_ID,
				parse_mode: 'HTML',
				disable_notification: isUserAccessError(error), // Отключаем уведомление для ошибок доступа
			})
			.catch(sendError => {
				console.error(
					'❌ Не удалось отправить уведомление об ошибке админам:',
					sendError.message
				)
			})
	} catch (notifyError) {
		console.error(
			'❌ Ошибка при формировании уведомления об ошибке:',
			notifyError
		)
	}
}

module.exports = {
	isBotBlocked,
	cantInitiateConversation,
	isUserAccessError,
	isRateLimitError,
	isJoinRequestMissing,
	formatUserAccessError,
	isCallbackQueryExpired,
	logError,
}
