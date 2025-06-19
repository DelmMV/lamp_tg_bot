/**
 * Модуль для анализа и обнаружения рекламы в сообщениях
 * @module adDetection
 */

const axios = require('axios')
const config = require('../config')

// Кэш для хранения результатов анализа сообщений
// Ключ - ID сообщения, значение - объект с результатами анализа и временем кэширования
const analysisCache = new Map()

/**
 * Анализирует сообщение на наличие рекламы с использованием ИИ
 * @async
 * @param {Object} message - Объект сообщения Telegram
 * @param {boolean} [forceRefresh=false] - Принудительно обновить анализ, игнорируя кэш
 * @returns {Promise<Object>} Результат анализа с оценкой и объяснениями
 */
async function analyzeMessageForAds(message, forceRefresh = false) {
	console.log(
		`🔍 Начало анализа сообщения ID: ${message.message_id} на наличие рекламы`
	)

	// Проверяем настройки модуля
	const { ENABLED, MIN_MESSAGE_LENGTH, CACHE_RESULTS } =
		config.MODULES.AD_DETECTION
	console.log(
		`⚙️ Настройки модуля: ENABLED=${ENABLED}, MIN_MESSAGE_LENGTH=${MIN_MESSAGE_LENGTH}, CACHE_RESULTS=${CACHE_RESULTS}`
	)

	if (!ENABLED) {
		console.log('❌ Модуль анализа рекламы отключен в настройках')
		return {
			isLikelyAd: false,
			adProbability: 0,
			adTypes: [],
			explanation: 'Модуль анализа рекламы отключен',
		}
	}

	// Получаем текст сообщения, учитывая пересланные сообщения (репосты)
	console.log('💬 Извлекаем текст сообщения...')

	// Проверяем, является ли сообщение пересланным
	// Детальный анализ всех возможных полей, связанных с пересылкой
	console.log('🔍 Детальный анализ полей пересылки:')
	console.log('- forward_origin:', message.forward_origin ? 'ЕСТЬ' : 'нет')
	console.log('- forward_from:', message.forward_from ? 'ЕСТЬ' : 'нет')
	console.log(
		'- forward_from_chat:',
		message.forward_from_chat ? 'ЕСТЬ' : 'нет'
	)
	console.log(
		'- forward_from_message_id:',
		message.forward_from_message_id || 'нет'
	)
	console.log('- forward_signature:', message.forward_signature || 'нет')
	console.log('- forward_sender_name:', message.forward_sender_name || 'нет')
	console.log(
		'- forward_date:',
		message.forward_date
			? new Date(message.forward_date * 1000).toISOString()
			: 'нет'
	)

	// Проверяем наличие разных типов пересылки
	const hasForwardOrigin = !!message.forward_origin
	const hasForwardFrom = !!message.forward_from
	const hasForwardFromChat = !!message.forward_from_chat
	const hasAnyForward =
		hasForwardOrigin ||
		hasForwardFrom ||
		hasForwardFromChat ||
		!!message.forward_date

	console.log(
		`🔁 Результат проверки: сообщение ${
			hasAnyForward ? 'является пересланным' : 'не является пересланным'
		}`
	)

	// Используем расширенную проверку на пересланные сообщения
	const isForwarded = hasAnyForward

	// Извлекаем текст сообщения с учетом всех возможных мест его хранения
	let messageText = ''

	// Проверяем все возможные места хранения текста
	if (message.text) {
		messageText = message.text
		console.log('💬 Текст найден в message.text')
	} else if (message.caption) {
		messageText = message.caption
		console.log('💬 Текст найден в message.caption')
	} else if (message.forward_origin?.message?.text) {
		messageText = message.forward_origin.message.text
		console.log('💬 Текст найден в message.forward_origin.message.text')
	} else if (message.forward_origin?.message?.caption) {
		messageText = message.forward_origin.message.caption
		console.log('💬 Текст найден в message.forward_origin.message.caption')
	} else {
		console.log('❌ Текст не найден ни в одном из ожидаемых мест')

		// Проверяем дополнительные места для пересланных сообщений
		if (message.forward_text) {
			messageText = message.forward_text
			console.log('💬 Текст найден в message.forward_text')
		} else if (message.forward_caption) {
			messageText = message.forward_caption
			console.log('💬 Текст найден в message.forward_caption')
		} else {
			// Если текст не найден, используем пустую строку
			messageText = ''
		}
	}

	// Для пересланных сообщений добавляем дополнительную информацию
	if (isForwarded) {
		// Добавляем информацию об источнике репоста
		const source =
			message.forward_origin?.sender_user?.username ||
			message.forward_origin?.chat?.title ||
			message.forward_from?.username ||
			message.forward_from?.first_name ||
			message.forward_from_chat?.title ||
			message.forward_sender_name ||
			'Неизвестный источник'

		let sourceType = 'неизвестного источника'
		if (message.forward_origin?.chat?.type === 'channel') {
			sourceType = 'канала'
		} else if (message.forward_origin?.chat?.type === 'group') {
			sourceType = 'группы'
		} else if (message.forward_from) {
			sourceType = 'пользователя'
		} else if (message.forward_from_chat?.type === 'channel') {
			sourceType = 'канала'
		} else if (message.forward_from_chat?.type === 'group') {
			sourceType = 'группы'
		}

		console.log(`📩 Репост из ${sourceType}: ${source}`)

		// Добавляем информацию об источнике в текст для анализа
		if (messageText.length > 0) {
			messageText = `[Репост из ${sourceType}: ${source}] ${messageText}`
		} else {
			messageText = `[Репост из ${sourceType}: ${source}]`
		}
	}

	console.log(
		`💬 Текст сообщения для анализа: "${messageText.substring(0, 100)}${
			messageText.length > 100 ? '...' : ''
		}" (длина: ${messageText.length})`
	)

	// Если сообщение переслано, уменьшаем минимальную длину для анализа
	const effectiveMinLength = isForwarded
		? Math.max(10, MIN_MESSAGE_LENGTH / 2)
		: MIN_MESSAGE_LENGTH

	// Проверяем длину сообщения, учитывая разные пороги для обычных и пересланных сообщений
	if (messageText.length < effectiveMinLength) {
		console.log(
			`❌ Сообщение слишком короткое для анализа (${messageText.length} < ${effectiveMinLength} символов)`
		)
		return {
			isLikelyAd: false,
			adProbability: 0,
			adTypes: [],
			explanation: `Сообщение слишком короткое для анализа (${messageText.length} < ${effectiveMinLength} символов)`,
		}
	}
	console.log(
		`✅ Длина сообщения (${messageText.length}) достаточна для анализа (порог: ${effectiveMinLength})`
	)

	// Проверяем наличие разрешенных маркетплейсов в сообщении
	const { ALLOWED_MARKETPLACES } = config.MODULES.AD_DETECTION
	if (ALLOWED_MARKETPLACES && ALLOWED_MARKETPLACES.length > 0) {
		const hasAllowedMarketplace = ALLOWED_MARKETPLACES.some(marketplace =>
			messageText.toLowerCase().includes(marketplace.toLowerCase())
		)
		if (hasAllowedMarketplace) {
			console.log('✅ Обнаружена ссылка на разрешенный маркетплейс')
			return {
				isLikelyAd: false,
				adProbability: 0,
				adTypes: [],
				explanation: 'Сообщение содержит ссылку на разрешенный маркетплейс',
			}
		}
	}

	// Проверяем кэш, если включен
	if (CACHE_RESULTS && !forceRefresh) {
		console.log('🔍 Проверяем кэш для сообщения ID:', message.message_id)
		const cachedResult = analysisCache.get(message.message_id)
		if (cachedResult) {
			console.log('💾 Найден результат в кэше, возвращаем его')
			return cachedResult.result
		}
		console.log('ℹ️ Результат в кэше не найден')
	}

	// Подготавливаем данные о сообщении для анализа
	console.log('📝 Подготавливаем данные о сообщении для анализа')

	if (isForwarded) {
		console.log('📬 Детальная информация о пересылке:', {
			forward_origin: message.forward_origin ? 'есть' : 'нет',
			forward_from: message.forward_from ? 'есть' : 'нет',
			origin_type: message.forward_origin?.chat?.type || 'N/A',
			origin_title: message.forward_origin?.chat?.title || 'N/A',
			origin_username: message.forward_origin?.chat?.username || 'N/A',
		})
	}

	// Создаем расширенный объект с информацией о сообщении
	const messageInfo = {
		text: messageText,
		isForwarded: isForwarded,
		// Расширенная информация о пересланных сообщениях
		forward: {
			source:
				message.forward_origin?.sender_user?.username ||
				message.forward_origin?.chat?.title ||
				message.forward_from?.username ||
				message.forward_from?.first_name ||
				null,
			type:
				message.forward_origin?.chat?.type ||
				(message.forward_from ? 'user' : null),
			date: message.forward_date
				? new Date(message.forward_date * 1000).toISOString()
				: null,
			isChannel: message.forward_origin?.chat?.type === 'channel',
			isGroup: message.forward_origin?.chat?.type === 'group',
			isUser:
				!!message.forward_from ||
				message.forward_origin?.sender_user?.type === 'user',
		},
		// Информация о медиа и содержимом
		hasMedia: !!message.photo || !!message.video || !!message.document,
		mediaType: message.photo
			? 'photo'
			: message.video
			? 'video'
			: message.document
			? 'document'
			: null,
		// Поиск специфических паттернов в тексте
		hasLinks:
			messageText.includes('http') ||
			messageText.includes('t.me/') ||
			messageText.includes('@'),
		hasPhoneNumbers: /\+?\d{10,15}/.test(messageText),
		hasEmails: /\S+@\S+\.\S+/.test(messageText),
		// Дополнительные паттерны для поиска рекламы
		hasPricePatterns: /\d+(\.\d+)? ?(\$|\u20ac|\u20bd|\u0440уб|руб|rub)/i.test(
			messageText
		),
		hasPromotionalWords:
			/(акция|скидка|распродажа|промокод|купон|бесплатно|sale|discount|promo|offer|buy|free)/i.test(
				messageText
			),
	}

	console.log('📊 Информация о сообщении:', {
		isForwarded: messageInfo.isForwarded,
		forward: messageInfo.isForwarded
			? {
					source: messageInfo.forward.source,
					type: messageInfo.forward.type,
					isChannel: messageInfo.forward.isChannel,
					isGroup: messageInfo.forward.isGroup,
					isUser: messageInfo.forward.isUser,
			  }
			: 'N/A',
		hasMedia: messageInfo.hasMedia,
		mediaType: messageInfo.mediaType,
		hasLinks: messageInfo.hasLinks,
		hasPhoneNumbers: messageInfo.hasPhoneNumbers,
		hasEmails: messageInfo.hasEmails,
		hasPricePatterns: messageInfo.hasPricePatterns,
		hasPromotionalWords: messageInfo.hasPromotionalWords,
	})

	try {
		// Формируем промпт для модели
		console.log('📝 Формируем промпт для модели AI')
		const prompt = `Ты - ассистент для анализа сообщений на наличие рекламы. Проанализируй следующее сообщение и определи, содержит ли оно рекламу.

Информация о сообщении:
- Текст: "${messageInfo.text}"
- Переслано: ${messageInfo.isForwarded ? 'Да' : 'Нет'}
${messageInfo.forwardSource ? `- Источник: ${messageInfo.forwardSource}` : ''}
- Содержит медиа: ${messageInfo.hasMedia ? 'Да' : 'Нет'}
- Содержит ссылки: ${messageInfo.hasLinks ? 'Да' : 'Нет'}
- Содержит телефоны: ${messageInfo.hasPhoneNumbers ? 'Да' : 'Нет'}
- Содержит email: ${messageInfo.hasEmails ? 'Да' : 'Нет'}

Проанализируй сообщение и ответь в формате JSON:
{
  "isLikelyAd": true/false,
  "adProbability": число от 0 до 100,
  "adTypes": ["тип рекламы 1", "тип рекламы 2", ...],
  "explanation": "Объяснение почему это реклама или почему нет"
}

Типы рекламы могут включать: "коммерческая реклама", "спам", "партнерская ссылка", "продажа товаров/услуг", "реклама канала/группы", "крипто/инвестиции", "мошенничество", "другое".

Оценивай вероятность рекламы по шкале от 0 до 100, где:
- 0-30: точно не реклама (личный опыт, обсуждение без коммерческого интереса)
- 31-50: маловероятно реклама (указание бренда в контексте, без призыва к действию)
- 51-70: неопределенно (возможные косвенные упоминания)
- 71-85: вероятно реклама (явное продвижение без прямого призыва)
- 86-100: точно реклама (прямые призывы к покупке/использованию)

Важные критерии:
1. Сообщения о личном опыте использования продукта/услуги без призыва к покупке НЕ считай рекламой
2. Упоминание бренда в контексте решения проблемы - НЕ реклама
3. Отзывы и рекомендации без коммерческой выгоды - НЕ реклама
4. Сообщения со ссылками на коммерческие сайты + призывом к действию - реклама

Примеры:
- "Пользуюсь Xiaomi 3 года, батарея держит отлично" → НЕ реклама
- "Купите Xiaomi по ссылке: myshop.com/xiaomi" → реклама`

		// Отправляем запрос к OpenRouter API с моделью deepseek-chat-v3-0324:free
		const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY

		if (!OPENROUTER_API_KEY) {
			console.error('❌ Отсутствует API ключ для OpenRouter')
			throw new Error('Отсутствует API ключ для OpenRouter')
		}

		console.log(
			'📡 Отправляем запрос к OpenRouter API с моделью deepseek-chat-v3-0324:free'
		)

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
				max_tokens: 1000,
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

		// Извлекаем и парсим JSON из ответа
		console.log('🔍 Извлекаем и парсим JSON из ответа')
		const responseText = response.data.choices[0].message.content
		console.log(
			'💬 Ответ от API:',
			responseText.substring(0, 200) + (responseText.length > 200 ? '...' : '')
		)

		const jsonMatch = responseText.match(/\{[\s\S]*\}/)

		let result
		if (jsonMatch) {
			console.log('✅ Найден JSON в ответе')
			try {
				result = JSON.parse(jsonMatch[0])
				console.log('✅ JSON успешно парсинг')
				console.log('📊 Результат анализа:', {
					isLikelyAd: result.isLikelyAd,
					adProbability: result.adProbability,
					adTypes: result.adTypes,
				})
			} catch (parseError) {
				console.error('❌ Ошибка парсинга JSON:', parseError)
				throw new Error(`Ошибка парсинга JSON: ${parseError.message}`)
			}
		} else {
			console.error('❌ Не удалось найти JSON в ответе')
			throw new Error('Не удалось извлечь JSON из ответа')
		}

		// Сохраняем результат в кэш, если включен
		if (CACHE_RESULTS) {
			console.log(
				'💾 Сохраняем результат в кэш для сообщения ID:',
				message.message_id
			)
			analysisCache.set(message.message_id, {
				result,
				timestamp: Date.now(),
			})
		}

		console.log('✅ Анализ завершен, возвращаем результат')
		return result
	} catch (error) {
		console.error('❌ Ошибка при анализе рекламы:', error)
		return {
			isLikelyAd: false,
			adProbability: 0,
			adTypes: [],
			explanation: `Ошибка при анализе: ${error.message}`,
		}
	}
}

/**
 * Форматирует результат анализа рекламы для отображения
 * @param {Object} analysisResult - Результат анализа
 * @param {Object} message - Объект сообщения
 * @returns {string} Форматированный текст анализа
 */
function formatAdAnalysisResult(analysisResult, message) {
	console.log(
		'📝 Форматируем результат анализа рекламы для сообщения ID:',
		message.message_id
	)

	// Проверяем, что результат анализа не пустой
	if (!analysisResult) {
		console.error('❌ Результат анализа отсутствует')
		return ''
	}

	const { adProbability, adTypes, explanation } = analysisResult
	console.log(
		`📊 Данные для форматирования: вероятность=${adProbability}, типы=[${
			adTypes?.join(', ') || 'не указаны'
		}]`
	)

	const { MIN_PROBABILITY_THRESHOLD } = config.MODULES.AD_DETECTION
	console.log(`📊 Порог вероятности: ${MIN_PROBABILITY_THRESHOLD}%`)

	// Если вероятность ниже порога, возвращаем пустую строку
	if (adProbability < MIN_PROBABILITY_THRESHOLD) {
		console.log(
			`❌ Вероятность рекламы (${adProbability}%) ниже порога (${MIN_PROBABILITY_THRESHOLD}%), пропускаем`
		)
		return ''
	}

	console.log(
		`✅ Вероятность рекламы (${adProbability}%) превышает порог (${MIN_PROBABILITY_THRESHOLD}%), формируем результат`
	)

	// Определяем эмодзи в зависимости от вероятности
	let emoji = '🟢'
	if (adProbability >= 80) emoji = '🔴'
	else if (adProbability >= 60) emoji = '🟠'
	else if (adProbability >= 40) emoji = '🟡'
	console.log(`🚀 Выбран эмодзи ${emoji} для вероятности ${adProbability}%`)

	// Форматируем информацию о сообщении
	let messageInfo = ''
	console.log('📝 Формируем информацию о сообщении')

	// Добавляем информацию о пересылке
	if (message.forward_origin || message.forward_from) {
		console.log(
			'📩 Сообщение является пересылкой, добавляем информацию об источнике'
		)

		const source =
			message.forward_origin?.sender_user?.username ||
			message.forward_origin?.chat?.title ||
			message.forward_from?.username ||
			message.forward_from?.first_name ||
			'Неизвестный источник'

		const sourceType =
			message.forward_origin?.chat?.type === 'channel'
				? 'канала'
				: message.forward_origin?.chat?.type === 'group'
				? 'группы'
				: 'пользователя'

		console.log(`📬 Источник: ${sourceType} "${source}"`)
		messageInfo += `
📩 <b>Репост из ${sourceType}:</b> ${source}`

		// Добавляем ссылку на оригинальное сообщение, если доступно
		if (
			message.forward_origin?.chat?.username &&
			message.forward_origin?.message_id
		) {
			const originalLink = `https://t.me/${message.forward_origin.chat.username}/${message.forward_origin.message_id}`
			console.log(
				`🔗 Добавляем ссылку на оригинальное сообщение: ${originalLink}`
			)
			messageInfo += `
🔗 <a href="${originalLink}">Оригинальное сообщение</a>`
		} else {
			console.log('ℹ️ Недостаточно данных для ссылки на оригинальное сообщение')
		}
	} else {
		console.log('ℹ️ Сообщение не является пересылкой')
	}

	// Формируем полный текст анализа
	const formattedText = `${emoji} <b>Анализ рекламы</b> ${messageInfo}

<b>Вероятность рекламы:</b> ${adProbability}%
<b>Тип рекламы:</b> ${adTypes.join(', ') || 'Не определен'}
<b>Объяснение:</b> ${explanation}`

	console.log(
		`✅ Сформирован результат анализа для сообщения ID: ${message.message_id}`
	)
	return formattedText
}

/**
 * Очищает устаревшие записи в кэше
 */
function cleanupCache() {
	const { CACHE_TTL_MINUTES } = config.MODULES.AD_DETECTION
	const now = Date.now()
	const ttl = CACHE_TTL_MINUTES * 60 * 1000

	let expiredCount = 0
	for (const [key, value] of analysisCache.entries()) {
		if (now - value.timestamp > ttl) {
			analysisCache.delete(key)
			expiredCount++
		}
	}

	if (expiredCount > 0) {
		console.log(
			`🧹 Очищено ${expiredCount} устаревших записей из кэша анализа рекламы`
		)
	}
}

// Запускаем периодическую очистку кэша (каждый час)
const CACHE_CLEANUP_INTERVAL = 60 * 60 * 1000 // 1 час
setInterval(cleanupCache, CACHE_CLEANUP_INTERVAL)

module.exports = {
	analyzeMessageForAds,
	formatAdAnalysisResult,
	cleanupCache,
}
