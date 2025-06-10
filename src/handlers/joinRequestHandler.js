/**
 * Обработчики запросов на вступление в чат
 * @module joinRequestHandler
 */

const { sendTelegramMessage } = require('../utils/messaging')
const { checkUserBan } = require('../utils/userBan')
const {
	logError,
	isUserAccessError,
	formatUserAccessError,
} = require('../utils/errorHandler')
const {
	getJoinRequestByUserId,
	addMessageToJoinRequest,
	updateJoinRequestStatusWithData,
	saveUserButtonMessage,
} = require('../db')
const {
	ADMIN_CHAT_ID,
	LAMP_THREAD_ID,
	MONO_PITER_CHAT_ID,
} = require('../config')

/**
 * Хранит информацию об ожидаемых вопросах от администраторов
 * @type {Map<string, Object>}
 */
const pendingQuestions = new Map()

// --- Шаблоны ответов ---
const REPLY_TEMPLATES = [
	{
		id: 'video',
		button: 'Видео-кружочек',
		text: `Чтобы мы могли убедиться, что вы не бот, а живой человек, запишите, пожалуйста, видео-кружочек, где вы рядом с колесом. Это займет всего пару секунд😊`,
	},
	{
		id: 'mono',
		button: 'Только моноколеса',
		text: `Привет! Наша группа — только для владельцев моноколёс.
Без колеса, увы, доступ закрыт.
Но зато у нас есть отличная моношкола @MonoPiterSchool — приходи учиться! 😉
Возвращайся к нам, когда будешь на моноколесе!`,
	},
	// Можно добавить новые шаблоны здесь
]

/**
 * Обрабатывает нажатие на кнопку задания вопроса
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @param {string} userId - ID пользователя, которому задается вопрос
 */
async function handleAskQuestion(bot, ctx, userId) {
	try {
		console.log(`❓ Подготовка запроса вопроса для пользователя ${userId}`)

		// Убедимся, что userId - это число
		const userIdNum = parseInt(userId, 10)
		if (isNaN(userIdNum)) {
			console.error(`❌ Некорректный ID пользователя: ${userId}`)
			return await ctx.reply('Ошибка: некорректный ID пользователя')
		}

		// Получаем информацию о пользователе
		const joinRequest = await getJoinRequestByUserId(userIdNum)
		console.log('📄 Данные о заявке:', joinRequest ? 'Найдены' : 'Не найдены')

		if (!joinRequest) {
			console.error(`❌ Пользователь ${userIdNum} не найден в заявках`)
			return await ctx.reply('Пользователь не найден или запрос уже обработан')
		}

		const userInfo = `${joinRequest.firstName} ${joinRequest.lastName || ''}`
		console.log(`👤 Информация о пользователе: ${userInfo}`)

		// Проверяем, есть ли уже активные запросы вопросов для этого администратора
		const adminId = ctx.from.id
		let activeRequestsForAdmin = 0

		for (const [key, data] of pendingQuestions.entries()) {
			if (data.adminId === adminId) {
				activeRequestsForAdmin++
			}
		}

		// Формируем сообщение с запросом
		const message = `<b>Вопрос для пользователя ${userInfo} (ID: ${userIdNum})</b>

<i>Чтобы отправить вопрос, просто ответьте на это сообщение.</i>

${
	activeRequestsForAdmin > 0
		? `<b>⚠️ У вас уже есть ${activeRequestsForAdmin} активных запросов вопросов. </b>
Если будете отвечать на этот запрос, в начале ответа укажите ID пользователя в формате:
<code>${userIdNum}: Ваш вопрос</code>`
		: ''
}`

		let sentMsg
		try {
			// Отправляем запрос на ввод вопроса с принудительным ответом
			sentMsg = await ctx.reply(message, {
				reply_markup: {
					force_reply: true,
					selective: true,
					inline_keyboard: [
						[{ text: 'Отмена', callback_data: `cancel_question_${userIdNum}` }],
					],
				},
				parse_mode: 'HTML',
			})

			console.log(
				'📨 Отправлен запрос на ввод вопроса, ID сообщения:',
				sentMsg.message_id
			)
		} catch (error) {
			await logError(
				bot,
				error,
				'Ошибка при отправке запроса на ввод вопроса',
				{
					userId: adminId,
					functionName: 'handleAskQuestion',
				}
			)

			await ctx
				.reply(
					'Произошла ошибка при отправке запроса. Пожалуйста, попробуйте позже.'
				)
				.catch(replyError =>
					console.error(
						'❌ Не удалось отправить сообщение об ошибке:',
						replyError
					)
				)

			return
		}

		// Сохраняем информацию о запросе в памяти
		const requestKey = `${ctx.from.id}_${sentMsg.message_id}`
		pendingQuestions.set(requestKey, {
			userId: userIdNum,
			adminId: ctx.from.id,
			messageId: sentMsg.message_id,
			timestamp: Date.now(),
		})

		console.log('🔑 Сохранен ключ запроса:', requestKey)
		console.log(
			'📋 Текущие ожидающие вопросы:',
			Array.from(pendingQuestions.keys())
		)

		// Установка тайм-аута для удаления запроса через 30 минут
		setTimeout(() => {
			if (pendingQuestions.has(requestKey)) {
				console.log(`⏱️ Истекло время ожидания для запроса ${requestKey}`)
				pendingQuestions.delete(requestKey)
				try {
					ctx.reply(
						`Время ожидания вопроса для пользователя ${userInfo} (ID: ${userIdNum}) истекло. При необходимости нажмите кнопку "Задать вопрос" снова.`
					)
				} catch (e) {
					console.error('❌ Ошибка при отправке уведомления о таймауте:', e)
				}
			}
		}, 30 * 60 * 1000) // 30 минут

		console.log('✅ Процесс запроса вопроса завершен успешно')
	} catch (error) {
		await logError(bot, error, 'Общая ошибка при запросе вопроса', {
			userId: ctx.from?.id,
			functionName: 'handleAskQuestion',
		})

		try {
			await ctx.reply('Ошибка при запросе вопроса: ' + error.message)
		} catch (replyError) {
			console.error('❌ Не удалось отправить сообщение об ошибке:', replyError)
		}
	}
}

/**
 * Отправляет вопрос от админа пользователю
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @returns {Promise<boolean>} - Было ли сообщение обработано как вопрос
 */
async function sendAdminQuestion(bot, ctx) {
	try {
		// Проверяем, что это ответ на сообщение
		if (!ctx.message || !ctx.message.reply_to_message) {
			return false
		}

		// Используем ID администратора для поиска его текущих вопросов
		const adminId = ctx.from.id

		// Находим все ожидающие вопросы этого администратора
		let foundUserIds = []

		for (const [key, data] of pendingQuestions.entries()) {
			if (data.adminId === adminId) {
				foundUserIds.push(data.userId)
			}
		}

		if (foundUserIds.length === 0) {
			return false
		}

		// Если есть только один ожидающий вопрос, используем его
		// Если их несколько, администратору нужно будет указать ID пользователя
		let targetUserId

		if (foundUserIds.length === 1) {
			targetUserId = foundUserIds[0]
		} else {
			// Проверяем, не указан ли ID пользователя в тексте ответа
			const question = ctx.message.text || ''
			const userIdMatch = question.match(/^(\d+):/)

			if (userIdMatch) {
				const parsedId = parseInt(userIdMatch[1], 10)
				if (foundUserIds.includes(parsedId)) {
					targetUserId = parsedId
					// Удаляем ID пользователя из сообщения
					ctx.message.text = question.replace(/^\d+:\s*/, '')
				} else {
					await ctx.reply(`❌ ID пользователя ${parsedId} не найден в ваших текущих запросах вопросов.
 Активные запросы вопросов: ${foundUserIds.join(', ')}`)
					return true
				}
			} else {
				await ctx.reply(`❓ У вас несколько активных запросов вопросов. Пожалуйста, укажите ID пользователя в формате:
 <ID пользователя>: ваш вопрос
 
 Например: ${foundUserIds[0]}: Какая у вас модель моноколеса?
 
 Активные запросы вопросов: ${foundUserIds.join(', ')}`)
				return true
			}
		}

		// Получаем данные о пользователе для проверки
		const joinRequest = await getJoinRequestByUserId(targetUserId)
		if (!joinRequest) {
			await ctx.reply(
				`Заявка для пользователя с ID ${targetUserId} не найдена или уже обработана.`
			)

			// Очищаем устаревшие запросы
			for (const [key, data] of pendingQuestions.entries()) {
				if (data.userId === targetUserId) {
					pendingQuestions.delete(key)
				}
			}

			return true
		}

		// Получаем текст вопроса
		const question = ctx.message.text

		if (!question || question.trim() === '') {
			await ctx.reply('❌ Пожалуйста, введите текст вопроса.')
			return true
		}

		// Проверка на команду отмены
		if (question === '/cancel') {
			// Удаляем все запросы для этого пользователя
			for (const [key, data] of pendingQuestions.entries()) {
				if (data.userId === targetUserId && data.adminId === adminId) {
					pendingQuestions.delete(key)
				}
			}

			await ctx.reply('❌ Запрос вопроса отменен.')
			return true
		}

		// Отправляем вопрос пользователю
		const messageSent = await sendTelegramMessage(
			bot,
			targetUserId,
			`Вопрос от администратора: ${question}`
		)

		// Проверяем результат отправки
		if (messageSent === null) {
			// Если сообщение не отправлено (null), пользователь, вероятно, заблокировал бота
			await ctx.reply(`❌ Не удалось отправить вопрос пользователю ${
				joinRequest.firstName
			} ${joinRequest.lastName || ''} (ID: ${targetUserId}).
 Пользователь, вероятно, заблокировал бота или ограничил доступ к своему аккаунту.`)

			// Очищаем все запросы для этого пользователя
			for (const [key, data] of pendingQuestions.entries()) {
				if (data.userId === targetUserId && data.adminId === adminId) {
					pendingQuestions.delete(key)
				}
			}

			return true
		}

		// Сообщение успешно отправлено - продолжаем обработку
		// Сохраняем вопрос в истории диалога
		await addMessageToJoinRequest(targetUserId, question, 'admin')

		// Уведомляем администратора
		await ctx.reply(
			`✅ Вопрос успешно отправлен пользователю ${joinRequest.firstName} ${
				joinRequest.lastName || ''
			} (ID: ${targetUserId}). Ожидаем ответ.`,
			{
				reply_markup: {
					inline_keyboard: [
						[{ text: 'Задать вопрос', callback_data: `ask_${targetUserId}` }],
					],
				},
			}
		)

		// Очищаем соответствующие записи из pendingQuestions
		for (const [key, data] of pendingQuestions.entries()) {
			if (data.userId === targetUserId && data.adminId === adminId) {
				pendingQuestions.delete(key)
			}
		}

		return true
	} catch (error) {
		console.error('❌ Ошибка при отправке вопроса администратора:', error)
		return false
	}
}

/**
 * Обрабатывает ответ пользователя на вопрос администратора
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @returns {Promise<boolean>} - Результат обработки
 */
async function handleUserReply(bot, ctx) {
	// Проверяем, что сообщение пришло в личку боту
	if (ctx.message.chat.type !== 'private') return false

	const { from } = ctx.message
	const userId = from.id

	try {
		// Проверяем, не забанен ли пользователь
		const isBanned = await checkUserBan(userId)
		if (isBanned) {
			console.log(`🚫 Пользователь ${userId} забанен, игнорируем сообщение`)
			await sendTelegramMessage(
				bot,
				userId,
				`⚠️ <b>Вы заблокированы в группе</b>\n`,
				{ parse_mode: 'HTML' }
			)
			return true
		}

		// Получаем информацию о заявке пользователя
		const joinRequest = await getJoinRequestByUserId(userId)
		if (!joinRequest) {
			console.log(`⚠️ Заявка пользователя ${userId} не найдена`)
			return false
		}

		// Проверяем статус заявки
		if (joinRequest.status !== 'pending') {
			console.log(
				`⚠️ Заявка пользователя ${userId} имеет статус: ${joinRequest.status}`
			)

			// Для отклоненных заявок можем отправить сообщение пользователю
			if (joinRequest.status === 'rejected') {
				await sendTelegramMessage(
					bot,
					userId,
					'Ваша заявка на вступление была отклонена ранее. Если вы хотите подать новую заявку, пожалуйста, сделайте это через основную группу.'
				)
				return true // Сообщение обработано
			}

			return false // Для других статусов просто игнорируем
		}

		const message = ctx.message.text || 'Пользователь отправил медиа-файл'
		console.log(
			`📝 Содержимое сообщения: ${message.substring(0, 50)}${
				message.length > 50 ? '...' : ''
			}`
		)

		// Сохраняем ответ в истории диалога
		try {
			await addMessageToJoinRequest(userId, message, 'user')
		} catch (dbError) {
			console.error('❌ Ошибка при сохранении сообщения в БД:', dbError)
			// Продолжаем выполнение даже при ошибке сохранения
		}

		// Формируем ссылку на пользователя
		const userLink = `<a href="tg://user?id=${userId}">${
			joinRequest.firstName
		} ${joinRequest.lastName || ''}</a>`

		// Проверяем наличие различных типов медиа
		const hasMedia =
			ctx.message.photo ||
			ctx.message.video ||
			ctx.message.video_note ||
			ctx.message.voice ||
			ctx.message.audio ||
			ctx.message.document

		if (hasMedia) {
			// Определяем тип медиа и соответствующий метод отправки
			let mediaType = ''
			let mediaFileId = ''
			let mediaOptions = {
				message_thread_id: LAMP_THREAD_ID,
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[{ text: '✅ Принять', callback_data: `accept_user:${userId}` }],
						[{ text: '❓ Задать вопрос', callback_data: `ask_${userId}` }],
					],
				},
			}

			try {
				if (ctx.message.photo) {
					mediaType = 'photo'
					mediaFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id
					mediaOptions.caption = `📸 Фото от ${userLink}`
					const sentMsg = await bot.telegram.sendPhoto(
						ADMIN_CHAT_ID,
						mediaFileId,
						mediaOptions
					)
					if (sentMsg) await saveUserButtonMessage(userId, sentMsg.message_id)
				} else if (ctx.message.video) {
					mediaType = 'video'
					mediaFileId = ctx.message.video.file_id
					mediaOptions.caption = `🎥 Видео от ${userLink}`
					const sentMsg = await bot.telegram.sendVideo(
						ADMIN_CHAT_ID,
						mediaFileId,
						mediaOptions
					)
					if (sentMsg) await saveUserButtonMessage(userId, sentMsg.message_id)
				} else if (ctx.message.video_note) {
					mediaType = 'video_note'
					mediaFileId = ctx.message.video_note.file_id

					// Сначала отправляем сам видео-кружок без кнопок
					await bot.telegram.sendVideoNote(ADMIN_CHAT_ID, mediaFileId, {
						message_thread_id: LAMP_THREAD_ID,
					})

					// Затем отправляем текстовое сообщение с кнопками
					const sentMsg = await sendTelegramMessage(
						bot,
						ADMIN_CHAT_ID,
						`📹 <b>Видео-сообщение от ${userLink}</b>`,
						{
							message_thread_id: LAMP_THREAD_ID,
							parse_mode: 'HTML',
							reply_markup: {
								inline_keyboard: [
									[
										{
											text: '✅ Принять',
											callback_data: `accept_user:${userId}`,
										},
									],
									[
										{
											text: '❓ Задать вопрос',
											callback_data: `ask_${userId}`,
										},
									],
								],
							},
						}
					)
					if (sentMsg) await saveUserButtonMessage(userId, sentMsg.message_id)
				} else if (ctx.message.voice) {
					mediaType = 'voice'
					mediaFileId = ctx.message.voice.file_id
					mediaOptions.caption = `🎤 Голосовое сообщение от ${userLink}`
					const sentMsg = await bot.telegram.sendVoice(
						ADMIN_CHAT_ID,
						mediaFileId,
						mediaOptions
					)
					if (sentMsg) await saveUserButtonMessage(userId, sentMsg.message_id)
				} else if (ctx.message.audio) {
					mediaType = 'audio'
					mediaFileId = ctx.message.audio.file_id
					mediaOptions.caption = `🎵 Аудио от ${userLink}`
					const sentMsg = await bot.telegram.sendAudio(
						ADMIN_CHAT_ID,
						mediaFileId,
						mediaOptions
					)
					if (sentMsg) await saveUserButtonMessage(userId, sentMsg.message_id)
				} else if (ctx.message.document) {
					mediaType = 'document'
					mediaFileId = ctx.message.document.file_id
					mediaOptions.caption = `📄 Документ от ${userLink}`
					const sentMsg = await bot.telegram.sendDocument(
						ADMIN_CHAT_ID,
						mediaFileId,
						mediaOptions
					)
					if (sentMsg) await saveUserButtonMessage(userId, sentMsg.message_id)
				}
			} catch (mediaError) {
				console.error('❌ Ошибка при отправке медиафайла:', mediaError)
				// Отправляем уведомление об ошибке администраторам
				await sendTelegramMessage(
					bot,
					ADMIN_CHAT_ID,
					`⚠️ <b>Ошибка при отправке медиафайла от ${userLink}</b>:\n${mediaError.message}`,
					{ message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
				)
			}
		} else {
			// Если нет медиа-файла, отправляем текстовое сообщение
			const adminMessage =
				`💬 <b>Ответ от пользователя ${userLink}:</b>\n${message}`.trim()
			const replyMarkup = {
				inline_keyboard: [
					[
						{ text: '✅ Принять', callback_data: `accept_user:${userId}` },
						{ text: '❓ Задать вопрос', callback_data: `ask_${userId}` },
					],
					[
						{
							text: 'Шаблоны ответов',
							callback_data: `reply_templates:${userId}`,
						},
					],
				],
			}
			const sentMsg = await sendTelegramMessage(
				bot,
				ADMIN_CHAT_ID,
				adminMessage,
				{
					message_thread_id: LAMP_THREAD_ID,
					parse_mode: 'HTML',
					reply_markup: replyMarkup,
				}
			)

			// Сохраняем ID сообщения с кнопками в БД
			if (sentMsg) {
				await saveUserButtonMessage(userId, sentMsg.message_id)
			}
		}

		console.log(`✅ Ответ пользователя успешно обработан`)
		return true // Сообщение обработано
	} catch (error) {
		console.error('❌ Ошибка при обработке ответа пользователя:', error)
		return false
	}
}

/**
 * Обрабатывает нажатия на кнопки управления заявками и шаблонами ответов
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст callback query
 */
async function handleJoinRequestCallback(bot, ctx) {
	try {
		const data = ctx.callbackQuery.data
		console.log('📥 Получены данные callback:', data)

		if (!data) {
			console.error('❌ Получены пустые данные callback')
			return
		}

		// --- Шаблоны ответов ---
		if (data.startsWith('reply_templates:')) {
			// Открыть меню шаблонов отдельным сообщением (reply на заявку)
			const userId = data.split(':')[1]
			const keyboard = REPLY_TEMPLATES.map(tpl => [
				{
					text: tpl.button || tpl.text.slice(0, 20) + '...',
					callback_data: `choose_template:${userId}:${tpl.id}`,
				},
			])
			keyboard.push([
				{ text: 'Назад', callback_data: `back_to_request_menu:${userId}` },
			])
			// Отправляем только если это callback с кнопки в заявке (иначе редактируем)
			if (
				ctx.callbackQuery.message.reply_to_message ||
				ctx.callbackQuery.message.text.includes('подал(а) заявку')
			) {
				// reply на заявку
				await bot.telegram.sendMessage(ctx.chat.id, 'Выберите шаблон ответа:', {
					reply_markup: { inline_keyboard: keyboard },
					reply_to_message_id: ctx.callbackQuery.message.message_id,
				})
			} else {
				// если это уже меню шаблонов — просто редактируем
				await ctx.editMessageText('Выберите шаблон ответа:', {
					reply_markup: { inline_keyboard: keyboard },
				})
			}
			await ctx.answerCbQuery('Выберите шаблон ответа')
			return
		}
		if (data.startsWith('choose_template:')) {
			// Подтверждение отправки шаблона — редактируем текущее сообщение
			const [, userId, templateId] = data.split(':')
			const template = REPLY_TEMPLATES.find(t => t.id === templateId)
			if (!template) {
				await ctx.answerCbQuery('Шаблон не найден')
				return
			}
			const confirmKeyboard = [
				[
					{
						text: 'Отправить',
						callback_data: `send_template:${userId}:${templateId}`,
					},
					{ text: 'Назад', callback_data: `reply_templates:${userId}` },
				],
			]
			await ctx.editMessageText(
				`Выбран шаблон:\n\n<code>${template.text}</code>\n\nОтправить в личку пользователю?`,
				{
					parse_mode: 'HTML',
					reply_markup: { inline_keyboard: confirmKeyboard },
				}
			)
			await ctx.answerCbQuery()
			return
		}
		if (data.startsWith('send_template:')) {
			// Отправка шаблона в личку, уведомляем об успехе/ошибке, не удаляем сообщение
			const [, userId, templateId] = data.split(':')
			const template = REPLY_TEMPLATES.find(t => t.id === templateId)
			if (!template) {
				await ctx.answerCbQuery('Шаблон не найден')
				return
			}
			try {
				await bot.telegram.sendMessage(userId, template.text)
				// Получаем username и имя пользователя для уведомления
				let userInfo = `ID: ${userId}`
				try {
					const user = await bot.telegram.getChat(userId)
					if (user.username) {
						userInfo = `@${user.username} (ID: ${userId})`
					} else if (user.first_name || user.last_name) {
						userInfo = `${user.first_name || ''} ${
							user.last_name || ''
						} (ID: ${userId})`
					}
				} catch (e) {
					/* ignore */
				}
				await ctx.editMessageText(
					`✅ Сообщение отправлено пользователю ${userInfo}.`,
					{
						reply_markup: { inline_keyboard: [] },
					}
				)
				await ctx.answerCbQuery('Шаблон отправлен')
			} catch (err) {
				await ctx.editMessageText(
					'❌ Не удалось отправить шаблон пользователю. Возможно, он заблокировал бота.',
					{
						reply_markup: { inline_keyboard: [] },
					}
				)
				await ctx.answerCbQuery('Ошибка отправки')
			}
			return
		}
		if (data.startsWith('back_to_request_menu:')) {
			// Возврат к начальному меню (кнопки "Задать вопрос", "Бан", "Шаблоны ответов")
			const userId = data.split(':')[1]
			const keyboard = [
				[
					{ text: '❓ Задать вопрос', callback_data: `ask_${userId}` },
					{ text: '❌ Бан', callback_data: `ban_user:${userId}` },
				],
				[
					{
						text: 'Шаблоны ответов',
						callback_data: `reply_templates:${userId}`,
					},
				],
			]
			await ctx.editMessageReplyMarkup({ inline_keyboard: keyboard })
			await ctx.answerCbQuery('Меню заявки')
			return
		}
		if (data.startsWith('cancel_templates:')) {
			// Скрыть меню шаблонов (больше не используем, но оставим на всякий случай)
			await ctx.editMessageReplyMarkup({ inline_keyboard: [] })
			await ctx.answerCbQuery('Отменено')
			return
		}
		// --- /Шаблоны ответов ---

		// --- Существующая логика ---
		if (data.startsWith('ask_')) {
			const userId = data.split('_')[1]
			console.log(`❓ Обработка запроса на вопрос для пользователя ${userId}`)
			await handleAskQuestion(bot, ctx, userId)
		} else if (data.startsWith('cancel_question_')) {
			// Обработка нажатия на кнопку "Отмена" при запросе вопроса
			const userId = parseInt(data.split('_')[2], 10)
			const adminId = ctx.from.id

			console.log(
				`❌ Отмена запроса вопроса для пользователя ${userId} от админа ${adminId}`
			)

			// Удаляем все запросы для этого пользователя от данного админа
			for (const [key, data] of pendingQuestions.entries()) {
				if (data.userId === userId && data.adminId === adminId) {
					pendingQuestions.delete(key)
				}
			}

			// Удаляем сообщение с запросом вопроса
			try {
				await ctx.deleteMessage()
				console.log(`❌ Сообщение с запросом вопроса удалено`)
			} catch (deleteError) {
				// Если не удалось удалить сообщение, редактируем его
				console.error(`❌ Ошибка при удалении сообщения:`, deleteError)
				try {
					await ctx.editMessageText(`<b>Вопрос для пользователя отменен</b>`, {
						parse_mode: 'HTML',
						reply_markup: { inline_keyboard: [] }, // Убираем все кнопки
					})
				} catch (editError) {
					console.error(`❌ Ошибка при редактировании сообщения:`, editError)
				}
			}

			// Отвечаем на callback запрос
			if (ctx.callbackQuery && typeof ctx.callbackQuery.answer === 'function') {
				await ctx.callbackQuery.answer('Запрос вопроса отменен')
			}
		} else {
			console.error('❓ Неизвестный формат данных callback:', data)
			// Не отвечаем на callback здесь
		}
	} catch (error) {
		console.error('❌ Ошибка при обработке callback запроса:', error)
		// Не отвечаем на callback при ошибке, пробрасываем ошибку дальше
		throw error
	}
}

module.exports = {
	handleAskQuestion,
	sendAdminQuestion,
	handleUserReply,
	handleJoinRequestCallback,
}
