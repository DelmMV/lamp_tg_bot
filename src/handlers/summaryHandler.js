const { generateChatSummary, sendSummaryToAdmin } = require('../utils/gemini')
const {
	getLast24HoursMessages,
	getMessagesByDateRange,
} = require('../utils/chatStorage')
const {
	ADMIN_CHAT_ID,
	MONO_PITER_CHAT_ID,
	LAMP_THREAD_ID,
} = require('../config')
const { sendTelegramMessage } = require('../utils/messaging')

/**
 * Парсит аргументы команды summary
 * @param {string} text - Текст сообщения
 * @returns {Object} Объект с параметрами
 */
function parseSummaryArgs(text) {
	// Формат: /summary [chatId] [days|date1-date2]
	const args = text.split(' ').filter(arg => arg.trim().length > 0)

	// По умолчанию - за последние 24 часа из основного чата
	const result = {
		chatId: MONO_PITER_CHAT_ID,
		period: '1', // 1 день
		startDate: null,
		endDate: null,
	}

	if (args.length > 1) {
		// Проверяем, является ли первый аргумент chatId
		if (!isNaN(args[1])) {
			result.chatId = args[1]
		}

		// Проверяем параметр периода
		if (args.length > 2) {
			const periodArg = args[args.length - 1]

			// Проверяем формат даты (date1-date2)
			if (periodArg.includes('-')) {
				const [start, end] = periodArg.split('-')
				try {
					// Пробуем разобрать даты в формате DD.MM.YYYY
					const parseDate = dateStr => {
						const [day, month, year] = dateStr.split('.')
						return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
					}

					result.startDate = parseDate(start)
					// Устанавливаем конец дня для конечной даты
					result.endDate = parseDate(end)
					result.endDate.setHours(23, 59, 59, 999)

					// Проверяем корректность дат
					if (isNaN(result.startDate) || isNaN(result.endDate)) {
						result.startDate = null
						result.endDate = null
					} else {
						result.period = 'custom'
					}
				} catch (error) {
					console.error('❌ Ошибка при разборе дат:', error)
				}
			} else if (!isNaN(periodArg)) {
				// Если передано число дней
				result.period = periodArg
			}
		}
	}

	return result
}

/**
 * Получает сообщения в соответствии с параметрами
 * @param {Object} params - Параметры запроса
 * @returns {Promise<Array>} Массив сообщений
 */
async function getMessagesForSummary(params) {
	const { chatId, period, startDate, endDate } = params

	if (period === 'custom' && startDate && endDate) {
		return await getMessagesByDateRange(chatId, startDate, endDate)
	} else {
		// Если указан период в днях, но не 1
		if (period !== '1') {
			const daysAgo = parseInt(period)
			const startDate = new Date()
			startDate.setDate(startDate.getDate() - daysAgo)
			startDate.setHours(0, 0, 0, 0)

			const endDate = new Date()

			return await getMessagesByDateRange(chatId, startDate, endDate)
		} else {
			// Стандартный случай - за последние 24 часа
			return await getLast24HoursMessages(chatId)
		}
	}
}

/**
 * Форматирует информацию о периоде для отображения
 * @param {Object} params - Параметры запроса
 * @returns {string} Отформатированная строка
 */
function formatPeriodInfo(params) {
	const { period, startDate, endDate } = params

	if (period === 'custom' && startDate && endDate) {
		const formatDate = date => {
			return date.toLocaleDateString('ru-RU')
		}
		return `с ${formatDate(startDate)} по ${formatDate(endDate)}`
	} else if (period === '1') {
		return 'за последние 24 часа'
	} else {
		return `за последние ${period} дней`
	}
}

/**
 * Отправляет справку по использованию команды /summary
 * @param {Context} ctx - Контекст сообщения
 */
async function sendSummaryHelp(ctx) {
	const helpText = `
<b>Использование команды /summary:</b>

Без параметров: сводка за последние 24 часа из основного чата
<code>/summary</code>

С указанием чата: сводка за последние 24 часа из указанного чата
<code>/summary [chat_id]</code>

С указанием периода в днях:
<code>/summary [chat_id] [кол-во_дней]</code>

С указанием периода дат (формат DD.MM.YYYY):
<code>/summary [chat_id] [начальная_дата-конечная_дата]</code>

Примеры:
<code>/summary</code> - последние 24 часа из основного чата
<code>/summary -1001234567890</code> - последние 24 часа из указанного чата
<code>/summary 7</code> - последние 7 дней из основного чата
<code>/summary -1001234567890 7</code> - последние 7 дней из указанного чата
<code>/summary 01.05.2023-10.05.2023</code> - период из основного чата
<code>/summary -1001234567890 01.05.2023-10.05.2023</code> - период из указанного чата
`

	await ctx.reply(helpText, { parse_mode: 'HTML' })
}

/**
 * Обрабатывает команду /summary
 * @param {Telegraf} bot - Экземпляр бота
 * @param {Context} ctx - Контекст сообщения
 */
async function handleSummaryCommand(bot, ctx) {
	try {
		// Отладка: выводим ID чата и ID из конфига
		console.log(
			`📊 Команда /summary: chat.id=${ctx.chat.id}, ADMIN_CHAT_ID=${ADMIN_CHAT_ID}`
		)

		// Проверяем, что команда вызвана в админ чате (учитываем разные типы)
		const chatIdStr = ctx.chat.id.toString()
		const adminChatIdStr = ADMIN_CHAT_ID.toString()

		if (chatIdStr !== adminChatIdStr) {
			console.log(`❌ Доступ запрещен: ${chatIdStr} !== ${adminChatIdStr}`)
			await ctx.reply('Эта команда доступна только в админ чате')
			return
		}

		// Проверяем, запрошена ли справка
		if (
			ctx.message.text.includes('help') ||
			ctx.message.text.includes('помощь')
		) {
			await sendSummaryHelp(ctx)
			return
		}

		// Отправляем сообщение о начале генерации
		const processingMsg = await ctx.reply('🔄 Генерирую сводку...')

		// Парсим аргументы команды
		const params = parseSummaryArgs(ctx.message.text)

		// Получаем сообщения в соответствии с параметрами
		const messages = await getMessagesForSummary(params)

		if (messages.length === 0) {
			await ctx.telegram.editMessageText(
				ctx.chat.id,
				processingMsg.message_id,
				null,
				`❌ Нет сообщений ${formatPeriodInfo(params)}`
			)
			return
		}

		// Генерируем сводку
		const summary = await generateChatSummary(messages)

		// Формируем заголовок с информацией о периоде
		const periodInfo = formatPeriodInfo(params)
		const title = `📊 <b>Сводка чата ${periodInfo}</b>\n\n`

		// Отправляем сводку с полным текстом
		await sendTelegramMessage(bot, ADMIN_CHAT_ID, title + summary, {
			message_thread_id: LAMP_THREAD_ID,
			parse_mode: 'HTML',
		})

		// Удаляем сообщение о генерации
		await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id)
	} catch (error) {
		console.error('❌ Ошибка при обработке команды /summary:', error)
		await ctx.reply(
			'Произошла ошибка при генерации сводки. Используйте /summary help для получения справки.'
		)
	}
}

module.exports = {
	handleSummaryCommand,
}
