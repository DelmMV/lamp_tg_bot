const { GoogleGenerativeAI } = require('@google/generative-ai')
const { BOT_TOKEN, ADMIN_CHAT_ID, LAMP_THREAD_ID } = require('../config')
const { sendTelegramMessage } = require('./messaging')

// Инициализация Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

/**
 * Генерирует краткую сводку чата на основе сообщений
 * @param {Array} messages - Массив сообщений за период
 * @returns {Promise<string>} Краткая сводка
 */
async function generateChatSummary(messages) {
	try {
		const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

		// Подготовка сообщений для анализа
		const preparedMessages = messages.map(msg => {
			// Извлекаем основную информацию из сообщения
			const from = msg.from?.first_name || msg.from?.username || 'Аноним'
			const text = msg.text || ''
			const caption = msg.caption || ''
			const content = text || caption || '[медиа]'

			// Формируем дату в читаемом формате
			let dateStr = ''
			if (msg.date) {
				if (msg.date instanceof Date) {
					dateStr = msg.date.toLocaleString('ru-RU')
				} else {
					dateStr = new Date(msg.date * 1000).toLocaleString('ru-RU')
				}
			}

			return `[${dateStr}] ${from}: ${content}`
		})

		// Формируем промпт для Gemini с дополнительным контекстом
		const prompt = `Ты - ассистент для анализа моноколесного чата в Telegram. Создай краткую сводку обсуждений в чате за указанный период.

Требования к сводке:
1. Выдели 3-7 основных тем обсуждения
2. Кратко опиши каждую тему (1-2 предложения)
3. Отметь активных участников дискуссий
4. Выдели важные решения или договоренности
5. Укажи наиболее обсуждаемые вопросы

Формат результата:
- Крупные темы должны быть выделены как заголовки
- Используй маркированные списки для подпунктов
- Сохраняй фактическую информацию
- Не придумывай информацию, которой нет в сообщениях
- Придерживайся объективного и нейтрального тона

Вот сообщения чата (${preparedMessages.length} сообщений):
${preparedMessages.join('\n')}`

		const result = await model.generateContent(prompt)
		const response = await result.response
		return response.text()
	} catch (error) {
		console.error('❌ Ошибка при генерации сводки:', error)
		throw error
	}
}

/**
 * Отправляет сводку в админ чат
 * @param {Telegraf} bot - Экземпляр бота
 * @param {string} summary - Текст сводки
 */
async function sendSummaryToAdmin(bot, summary) {
	try {
		await sendTelegramMessage(
			bot,
			ADMIN_CHAT_ID,
			`📊 <b>Ежедневная сводка чата</b>\n\n${summary}`,
			{ message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
		)
	} catch (error) {
		console.error('❌ Ошибка при отправке сводки:', error)
		throw error
	}
}

module.exports = {
	generateChatSummary,
	sendSummaryToAdmin,
}
