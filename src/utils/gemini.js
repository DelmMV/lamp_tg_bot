const axios = require('axios')
const { ADMIN_CHAT_ID, LAMP_THREAD_ID, MODULES } = require('../config')
const { sendTelegramMessage } = require('./messaging')

// Инициализация OpenRouter API
const OPENROUTER_API_KEY2 = process.env.OPENROUTER_API_KEY2

/**
 * Генерирует краткую сводку чата на основе сообщений
 * @param {Array} messages - Массив сообщений за период
 * @param {boolean} isEveningReport - Признак вечернего отчета
 * @returns {Promise<string>} Краткая сводка
 */
async function generateChatSummary(messages, isEveningReport = false) {
	try {
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

		// Определяем временной период для отчета
		const timePeriod = isEveningReport
			? 'за последние 12 часов (с 8:00 до 20:00)'
			: 'за последние 12 часов (с 20:00 до 8:00)'

		// Формируем промпт для модели с дополнительным контекстом
		const prompt = `Ты - ассистент для анализа моноколесного чата в Telegram. Создай краткую сводку обсуждений в чате ${timePeriod}.

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

		// Отправляем запрос к OpenRouter API с моделью deepseek-chat-v3-0324:free
		const response = await axios.post(
			'https://openrouter.ai/api/v1/chat/completions',
			{
				model: 'deepseek/deepseek-chat-v3-0324:free',
				messages: [
					{
						role: 'user',
						content: prompt,
					},
				],
				max_tokens: 1500,
			},
			{
				headers: {
					Authorization: `Bearer ${OPENROUTER_API_KEY2}`,
					'Content-Type': 'application/json',
					'HTTP-Referer': 'https://lamp_tg_bot', // Указываем источник запроса
					'X-Title': 'Lamp Telegram Bot', // Название приложения
				},
			}
		)

		// Извлекаем текст ответа
		return response.data.choices[0].message.content
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
			MODULES.CHAT_SUMMARY.REPORT_CHAT_ID,
			`📊 <b>Ежедневная сводка чата</b>\n\n${summary}`,
			{
				message_thread_id: MODULES.CHAT_SUMMARY.REPORT_THREAD_ID,
				parse_mode: 'HTML',
			}
		)
	} catch (error) {
		console.error('❌ Ошибка при отправке сводки:', error)
		throw error
	}
}

/**
 * Генерирует юмористический ответ на использование запрещенного слова
 * @param {string} forbiddenWord - Запрещенное слово
 * @param {string} fullMessage - Полное сообщение пользователя
 * @returns {Promise<string>} - Сгенерированный ответ
 */
async function generateForbiddenWordResponse(forbiddenWord, fullMessage = '') {
	const axios = require('axios')
	const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY2

	if (!OPENROUTER_API_KEY) {
		console.error('❌ Отсутствует API ключ OPENROUTER_API_KEY2')
		throw new Error('Отсутствует API ключ OPENROUTER_API_KEY2')
	}

	// Очищаем сообщение от лишних пробелов и переносов строк
	const cleanMessage = fullMessage.replace(/\s+/g, ' ').trim()

	const prompt = `Сгенерируй очень короткий юмористический ответ (одно предложение!) на использование нецензурного слова в чате.

Контекст сообщения: "${cleanMessage}"
Обнаруженное нецензурное слово: "${forbiddenWord}"

Важные правила:
- Используй современный разговорный стиль
- Добавь 1-2 подходящих эмодзи
- Сохраняй дружелюбный тон с легкой иронией
- НЕ повторяй само запрещенное слово
- Учитывай эмоциональный тон всего сообщения (агрессия/шутка/спор/etc)
- Если сообщение агрессивное - ответ должен быть более сдержанным
- Если сообщение шуточное - можно ответить более игриво
- Никаких нравоучений и морализаторства
- Ответ должен быть понятен всем
- Максимум 50-60 символов с пробелами`

	try {
		console.log('📡 Отправляем запрос к OpenRouter API для генерации ответа')
		console.log('💬 Обрабатываемое слово:', forbiddenWord)
		console.log('📝 Контекст сообщения:', cleanMessage)

		const response = await axios.post(
			'https://openrouter.ai/api/v1/chat/completions',
			{
				model: 'anthropic/claude-3-haiku',
				messages: [
					{
						role: 'user',
						content: prompt,
					},
				],
				max_tokens: 100,
			},
			{
				headers: {
					Authorization: `Bearer ${OPENROUTER_API_KEY}`,
					'Content-Type': 'application/json',
					'HTTP-Referer': 'https://lamp_tg_bot',
					'X-Title': 'Lamp Telegram Bot',
				},
			}
		)

		console.log('✅ Получен ответ от OpenRouter API')
		const generatedResponse = response.data.choices[0].message.content.trim()

		return generatedResponse
	} catch (error) {
		console.error('❌ Ошибка при генерации ответа:', error)
		// Возвращаем короткий стандартный ответ
		return '😅 Давай помягче с выражениями!'
	}
}

module.exports = {
	generateChatSummary,
	sendSummaryToAdmin,
	generateForbiddenWordResponse,
}
