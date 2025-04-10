/**
 * Функции для отправки сообщений в Telegram
 * @module messaging
 */

const {
	isUserAccessError,
	isRateLimitError,
	isCallbackQueryExpired,
	formatUserAccessError,
} = require('./errorHandler')
const { ADMIN_CHAT_ID, LAMP_THREAD_ID } = require('../config')

/**
 * Отправляет уведомление об ошибке администраторам
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Error} error - Объект ошибки
 * @param {Object} context - Контекст ошибки (информация о пользователе/операции)
 * @returns {Promise<void>}
 */
async function notifyAdminsAboutError(bot, error, context = {}) {
	try {
		const {
			userId,
			operation = 'неизвестная операция',
			additionalInfo = '',
		} = context

		// Формируем сообщение об ошибке
		let errorMessage = `⚠️ <b>Ошибка при отправке сообщения</b>\n`

		if (userId) {
			errorMessage += `👤 <b>Пользователь:</b> <a href="tg://user?id=${userId}">${userId}</a>\n`
		}

		errorMessage += `🔄 <b>Операция:</b> ${operation}\n`
		errorMessage += `❌ <b>Ошибка:</b> ${error.message}\n`

		if (isUserAccessError(error)) {
			errorMessage += `\n📌 <b>Тип ошибки:</b> ${formatUserAccessError(
				error,
				userId || 'неизвестный'
			)}\n`
		} else if (isRateLimitError(error)) {
			errorMessage += `\n⏱️ <b>Превышен лимит запросов API</b>\n`
		}

		if (additionalInfo) {
			errorMessage += `\n<i>${additionalInfo}</i>`
		}

		// Для критических ошибок добавляем стек вызовов
		if (!isUserAccessError(error) && !isRateLimitError(error)) {
			const stackTrace = error.stack
				? error.stack.split('\n').slice(0, 3).join('\n')
				: 'Стек недоступен'
			errorMessage += `\n<pre>${stackTrace}</pre>`
		}

		// Отправляем сообщение админам, но игнорируем ошибки при отправке самого уведомления
		await bot.telegram
			.sendMessage(ADMIN_CHAT_ID, errorMessage, {
				message_thread_id: LAMP_THREAD_ID,
				parse_mode: 'HTML',
				// Для ошибок доступа к пользователю отключаем звуковое уведомление
				disable_notification: isUserAccessError(error),
			})
			.catch(e =>
				console.error('Failed to send error notification to admins:', e.message)
			)
	} catch (notifyError) {
		console.error('Error sending admin notification about error:', notifyError)
	}
}

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
		await ctx.answerCbQuery(text, options)
		return true
	} catch (error) {
		// Игнорируем ошибки устаревших callback запросов
		if (isCallbackQueryExpired(error)) {
			console.log('⚠️ Попытка ответить на устаревший callback запрос:', text)
			return false
		}

		console.error('❌ Ошибка при ответе на callback запрос:', error)
		return false
	}
}

/**
 * Отправляет текстовое сообщение в Telegram с улучшенной обработкой ошибок
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {number|string} chatId - ID чата для отправки сообщения
 * @param {string} message - Текст сообщения
 * @param {Object} [options={}] - Дополнительные параметры сообщения
 * @param {Object} [errorOptions={}] - Опции для логирования ошибок
 * @returns {Promise<Object|null>} - Результат отправки сообщения или null при ошибке
 * @throws {Error} - Пробрасывает ошибки, не связанные с доступом к пользователю
 */
async function sendTelegramMessage(
	bot,
	chatId,
	message,
	options = {},
	errorOptions = {}
) {
	try {
		return await bot.telegram.sendMessage(chatId, message, options)
	} catch (error) {
		console.error(`Error sending message to ${chatId}:`, error.message)

		// Специальная обработка ошибки USER_ID_INVALID
		if (error.message.includes('USER_ID_INVALID')) {
			console.error(
				`⚠️ Пользователь ${chatId} недействителен (возможно удалил аккаунт или заблокировал бота)`
			)

			// Уведомляем администраторов о недействительном пользователе
			await notifyAdminsAboutError(bot, error, {
				userId: chatId,
				operation: errorOptions.context || 'Отправка сообщения',
				additionalInfo:
					'Пользователь недействителен (возможно удалил аккаунт или заблокировал бота)',
			})

			return null
		}

		// Если ошибка связана с ограничением запросов, пробуем повторить
		if (isRateLimitError(error)) {
			const retryAfter = error.parameters?.retry_after || 1
			console.log(`Rate limited. Retrying after ${retryAfter} seconds...`)

			await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
			return sendTelegramMessage(bot, chatId, message, options, errorOptions)
		}

		// Ключевое изменение: по умолчанию отправляем уведомления для всех ошибок
		// КРОМЕ случая, когда явно отключено для ошибок доступа
		const skipNotification =
			isUserAccessError(error) && errorOptions.skipUserAccessErrors === true

		if (!skipNotification) {
			await notifyAdminsAboutError(bot, error, {
				userId: chatId,
				operation: errorOptions.context || 'Отправка сообщения',
				additionalInfo: errorOptions.additionalInfo || '',
			})
		}

		// Ошибки доступа к пользователю не пробрасываем, а возвращаем null
		if (isUserAccessError(error)) {
			return null
		}

		// Другие ошибки пробрасываем дальше
		throw error
	}
}

/**
 * Отправляет медиа-сообщение в Telegram
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {number|string} chatId - ID чата для отправки медиа
 * @param {Object} content - Контент для отправки
 * @param {Object} [options={}] - Дополнительные параметры
 * @param {Object} [errorOptions={}] - Опции для логирования ошибок
 * @returns {Promise<Object|null>} - Результат отправки медиа
 */
async function sendTelegramMedia(
	bot,
	chatId,
	content,
	options = {},
	errorOptions = {}
) {
	try {
		return await bot.telegram.sendCopy(chatId, content, options)
	} catch (error) {
		console.error(`Error sending media to ${chatId}:`, error.message)

		// Если ошибка связана с ограничением запросов, пробуем повторить
		if (isRateLimitError(error)) {
			const retryAfter = error.parameters?.retry_after || 1
			console.log(`Rate limited. Retrying after ${retryAfter} seconds...`)

			await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
			return sendTelegramMedia(bot, chatId, content, options, errorOptions)
		}

		// Ключевое изменение: по умолчанию отправляем уведомления для всех ошибок
		// КРОМЕ случая, когда явно отключено для ошибок доступа
		const skipNotification =
			isUserAccessError(error) && errorOptions.skipUserAccessErrors === true

		if (!skipNotification) {
			await notifyAdminsAboutError(bot, error, {
				userId: chatId,
				operation: errorOptions.context || 'Отправка медиа',
				additionalInfo: errorOptions.additionalInfo || '',
			})
		}

		// Ошибки доступа к пользователю не пробрасываем, а возвращаем null
		if (isUserAccessError(error)) {
			return null
		}

		// Логирование дополнительных деталей ошибки
		if (error.response) {
			console.error('Error details:', JSON.stringify(error.response, null, 2))
		}

		throw error
	}
}

module.exports = {
	sendTelegramMessage,
	sendTelegramMedia,
	safeAnswerCallback,
	notifyAdminsAboutError,
}
