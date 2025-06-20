/**
 * Обработчики текстовых сообщений
 * @module messageHandler
 */

const { containsForbiddenWords } = require('../utils/contentFilter')
const { sendTelegramMessage } = require('../utils/messaging')
const { hasMediaHashtag } = require('../utils/helpers')
const { checkUserBan } = require('../utils/userBan')
const { handleMessageForAds } = require('./adHandler')
const { generateForbiddenWordResponse } = require('../utils/gemini')
const {
	deleteComment,
	getJoinRequestByUserId,
	saveUserButtonMessage,
} = require('../db')
const {
	ADMIN_CHAT_ID,
	MONO_PITER_CHAT_ID,
	LAMP_THREAD_ID,
	MODULES,
} = require('../config')
const { handleMediaGroup, handleSingleMessage } = require('./mediaHandler')

/**
 * Обрабатывает команду удаления комментария
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 */
async function handleDeleteCommand(bot, ctx) {
	if (ctx.message.chat.id !== ADMIN_CHAT_ID) return

	const [, commentId] = ctx.message.text.split(' ')
	if (!commentId) {
		return await ctx.reply(
			'Неверный формат команды. Используйте /delete <commentId>'
		)
	}

	try {
		const result = await deleteComment(commentId)
		await ctx.reply(result.message)
	} catch (error) {
		console.error('Error processing delete command:', error)
		await ctx.reply('Произошла ошибка при удалении комментария.')
	}
}

/**
 * Обрабатывает команду тревоги
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 */
async function handleAlarmCommand(bot, ctx) {
	const [, ...textParts] = ctx.message.text.split(' ')
	const text = textParts.join(' ')

	if (!text.includes(',')) {
		return await ctx.reply(
			'Пожалуйста, введите через запятую текст с описанием и ссылку на сообщения после команды /alarm.'
		)
	}

	const [description, link] = text.split(',').map(part => part.trim())

	if (!/^(http|https):\/\/.*/i.test(link)) {
		return await ctx.reply(
			'Пожалуйста, введите корректную ссылку на сообщение.'
		)
	}

	const message = `
Новый тревожный сигнал от пользователя <a href="tg://user?id=${
		ctx.message.from.id
	}">${ctx.message.from.first_name} ${ctx.message.from.last_name || ''}</a>:
Ссылка на пост: ${link}
Описание: ${description}
  `.trim()

	await sendTelegramMessage(bot, ADMIN_CHAT_ID, message, {
		message_thread_id: LAMP_THREAD_ID,
		parse_mode: 'HTML',
	})
	await ctx.reply('Ваш тревожный сигнал отправлен администратору.')
}

/**
 * Проверяет сообщение на запрещенные слова
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @returns {Promise<boolean>} - Найдены ли запрещенные слова
 */
async function checkForbiddenWords(bot, ctx) {
	const messageText = ctx.message.text
	if (!messageText || ctx.message.chat.id !== MONO_PITER_CHAT_ID) return false

	// Проверяем, включен ли модуль
	if (!MODULES.FORBIDDEN_WORDS.ENABLED) return false

	try {
		const result = containsForbiddenWords(messageText)
		if (result.found) {
			const messageLink = `https://t.me/${ctx.message.chat.username}/${ctx.message.message_thread_id}/${ctx.message.message_id}`

			// Генерируем юмористический ответ с учетом контекста всего сообщения
			let userMessage = await generateForbiddenWordResponse(
				result.word,
				messageText
			)

			// Ответ пользователю, если включено
			if (MODULES.FORBIDDEN_WORDS.REPLY_TO_USER) {
				await ctx.reply(userMessage, {
					reply_to_message_id: ctx.message.message_id,
					parse_mode: 'HTML',
				})
			}

			// Уведомление модераторам
			const moderMessage = `В <a href="${messageLink}">сообщении</a> от <a href="tg://user?id=${
				ctx.message.from.id
			}">${ctx.message.from.first_name} ${
				ctx.message.from.last_name || ''
			}</a> обнаружены не допустимые слова!${
				MODULES.FORBIDDEN_WORDS.SHOW_WORD_TO_MODS
					? `\nЗапрещенное слово: "${result.word}"`
					: ''
			}`

			await sendTelegramMessage(
				bot,
				MODULES.FORBIDDEN_WORDS.REPORT_CHAT_ID,
				moderMessage,
				{
					message_thread_id: MODULES.FORBIDDEN_WORDS.REPORT_THREAD_ID,
					parse_mode: 'HTML',
				}
			)

			return true
		}
	} catch (error) {
		console.error('Error checking forbidden words:', error)
	}

	return false
}

/**
 * Обрабатывает сообщение с хэштегом медиа
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 */
async function handleHashtagMedia(bot, ctx) {
	const replyMessage = ctx.message.reply_to_message
	if (!replyMessage) return

	if (hasMediaHashtag(ctx.message.text)) {
		if (replyMessage.media_group_id) {
			try {
				const messages = await ctx.telegram
					.getUpdates({
						allowed_updates: ['message'],
						limit: 50,
					})
					.then(res =>
						res
							.map(update =>
								update.message.text
									? update.message.reply_to_message
									: update.message
							)
							.filter(
								message =>
									message &&
									message.media_group_id === replyMessage.media_group_id
							)
					)
				await handleMediaGroup(bot, ctx, messages)
			} catch (error) {
				console.error('Error handling media group with hashtag:', error)
			}
		} else {
			await handleSingleMessage(bot, ctx)
		}
	}
}

/**
 * Пересылает сообщение пользователя администраторам
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @param {Object} from - Данные отправителя
 * @returns {Promise<boolean>} - Результат операции
 */
async function forwardMessageToAdmins(bot, ctx, from) {
	try {
		const userLink = `<a href="tg://user?id=${from.id}">${from.first_name} ${
			from.last_name || ''
		}</a>`

		// Получаем текст сообщения из разных полей
		const messageText =
			ctx.message.text || ctx.message.caption || '[нет текста]'

		// Формируем подпись для медиа-файла
		const mediaCaption = `
👤 <b>Отправитель:</b> ${userLink}

${messageText !== '[нет текста]' ? `💬 <b>Сообщение:</b>\n${messageText}` : ''}
        `.trim()

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
						[{ text: '✅ Принять', callback_data: `accept_user:${from.id}` }],
						[{ text: '❓ Задать вопрос', callback_data: `ask_${from.id}` }],
					],
				},
			}

			if (ctx.message.photo) {
				mediaType = 'photo'
				mediaFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id
				mediaOptions.caption = mediaCaption
				const sentMsg = await ctx.telegram.sendPhoto(
					ADMIN_CHAT_ID,
					mediaFileId,
					mediaOptions
				)
				if (sentMsg) await saveUserButtonMessage(from.id, sentMsg.message_id)
			} else if (ctx.message.video) {
				mediaType = 'video'
				mediaFileId = ctx.message.video.file_id
				mediaOptions.caption = mediaCaption
				const sentMsg = await ctx.telegram.sendVideo(
					ADMIN_CHAT_ID,
					mediaFileId,
					mediaOptions
				)
				if (sentMsg) await saveUserButtonMessage(from.id, sentMsg.message_id)
			} else if (ctx.message.video_note) {
				mediaType = 'video_note'
				mediaFileId = ctx.message.video_note.file_id

				// Сначала отправляем сам видео-кружок без кнопок
				await ctx.telegram.sendVideoNote(ADMIN_CHAT_ID, mediaFileId, {
					message_thread_id: LAMP_THREAD_ID,
				})

				// Затем отправляем текстовое сообщение с кнопками
				const textMessage = `📹 <b>Видео-сообщение от ${userLink}</b>`
				const sentMsg = await sendTelegramMessage(
					bot,
					ADMIN_CHAT_ID,
					textMessage,
					{
						message_thread_id: LAMP_THREAD_ID,
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '✅ Принять',
										callback_data: `accept_user:${from.id}`,
									},
								],
								[{ text: '❓ Задать вопрос', callback_data: `ask_${from.id}` }],
							],
						},
					}
				)

				if (sentMsg) await saveUserButtonMessage(from.id, sentMsg.message_id)
			} else if (ctx.message.voice) {
				mediaType = 'voice'
				mediaFileId = ctx.message.voice.file_id
				mediaOptions.caption = `🎤 Голосовое сообщение от ${userLink}`
				const sentMsg = await ctx.telegram.sendVoice(
					ADMIN_CHAT_ID,
					mediaFileId,
					mediaOptions
				)
				if (sentMsg) await saveUserButtonMessage(from.id, sentMsg.message_id)
			} else if (ctx.message.audio) {
				mediaType = 'audio'
				mediaFileId = ctx.message.audio.file_id
				mediaOptions.caption = `🎵 Аудио от ${userLink}`
				const sentMsg = await ctx.telegram.sendAudio(
					ADMIN_CHAT_ID,
					mediaFileId,
					mediaOptions
				)
				if (sentMsg) await saveUserButtonMessage(from.id, sentMsg.message_id)
			} else if (ctx.message.document) {
				mediaType = 'document'
				mediaFileId = ctx.message.document.file_id
				mediaOptions.caption = `📄 Документ от ${userLink}`
				const sentMsg = await ctx.telegram.sendDocument(
					ADMIN_CHAT_ID,
					mediaFileId,
					mediaOptions
				)
				if (sentMsg) await saveUserButtonMessage(from.id, sentMsg.message_id)
			}
		} else {
			// Если нет медиа-файла, отправляем текстовое сообщение
			const adminMessage = `
👤 <b>Отправитель:</b> ${userLink}

💬 <b>Сообщение:</b>
${messageText}
            `.trim()

			// Отправляем сообщение администраторам
			const sentMsg = await sendTelegramMessage(
				bot,
				ADMIN_CHAT_ID,
				adminMessage,
				{
					message_thread_id: LAMP_THREAD_ID,
					parse_mode: 'HTML',
					// Добавляем кнопки для действий с заявкой
					reply_markup: {
						inline_keyboard: [
							[{ text: '✅ Принять', callback_data: `accept_user:${from.id}` }],
							[{ text: '❓ Задать вопрос', callback_data: `ask_${from.id}` }],
						],
					},
				}
			)

			// Сохраняем ID сообщения с кнопками в БД
			if (sentMsg) {
				await saveUserButtonMessage(from.id, sentMsg.message_id)
			}
		}

		console.log(
			`✅ Сообщение от пользователя ${from.id} переслано администраторам`
		)
		return true
	} catch (error) {
		console.error('❌ Ошибка при пересылке сообщения администраторам:', error)
		return false
	}
}

/**
 * Отправляет стандартный ответ пользователю без активной заявки
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} from - Данные отправителя
 */
async function sendStandardResponseToUser(bot, from) {
	try {
		await sendTelegramMessage(
			bot,
			from.id,
			'Здравствуйте! Если вы хотите вступить в сообщество МоноПитер, пожалуйста, отправьте запрос на вступление через группу. Почитать о нашем сообществе можно на этом сайте http://монопитер.рф'
		)
		console.log(`✅ Отправлен стандартный ответ пользователю ${from.id}`)
	} catch (error) {
		console.error(
			`❌ Ошибка при отправке стандартного ответа пользователю ${from.id}:`,
			error
		)
	}
}

/**
 * Обрабатывает личное сообщение
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @returns {Promise<boolean>} - Результат обработки сообщения
 */
async function handlePrivateMessage(bot, ctx) {
	if (ctx.message.chat.type !== 'private') return false

	const { from } = ctx.message
	const userId = from.id

	try {
		console.log(`📩 Обработка личного сообщения от пользователя ${userId}`)

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

		// Проверяем, есть ли заявка (любого статуса)
		let joinRequest = null
		try {
			joinRequest = await getJoinRequestByUserId(userId)
		} catch (dbError) {
			console.error('❌ Ошибка при получении данных о заявке:', dbError)
			// При ошибке БД считаем, что заявки нет - отправляем стандартное сообщение
			await sendStandardResponseToUser(bot, from)
			return true
		}

		// Если заявки нет совсем - отправляем стандартный ответ
		if (!joinRequest) {
			console.log(
				`📎 Заявка для пользователя ${userId} не найдена - отправляем стандартный ответ`
			)
			await sendStandardResponseToUser(bot, from)
			return true
		}

		// Обрабатываем в зависимости от статуса заявки
		console.log(
			`📝 Пользователь ${userId} имеет заявку со статусом: ${joinRequest.status}`
		)

		switch (joinRequest.status) {
			case 'pending':
				// У пользователя активная заявка - пересылаем сообщение администраторам
				return await forwardMessageToAdmins(bot, ctx, from)

			case 'approved':
				// Заявка одобрена - отправляем пользователю сообщение об одобрении
				await sendTelegramMessage(
					bot,
					userId,
					'Ваша заявка была одобрена. Если у вас возникли вопросы, вы можете задать их в общем чате МоноПитера.'
				)
				return true

			case 'rejected':
				// Заявка отклонена - отправляем пользователю сообщение об отклонении
				await sendTelegramMessage(
					bot,
					userId,
					'Ваша заявка на вступление была отклонена. Если вы хотите подать новую заявку, пожалуйста, сделайте это через основную группу.'
				)
				return true

			default:
				// Неизвестный статус - на всякий случай отправляем стандартный ответ
				console.log(`⚠️ Неизвестный статус заявки: ${joinRequest.status}`)
				await sendStandardResponseToUser(bot, from)
				return true
		}
	} catch (error) {
		console.error('❌ Ошибка при обработке личного сообщения:', error)

		// В случае ошибки отправляем сообщение об ошибке администраторам
		try {
			const userLink = `<a href="tg://user?id=${from.id}">${from.first_name} ${
				from.last_name || ''
			}</a>`
			await sendTelegramMessage(
				bot,
				ADMIN_CHAT_ID,
				`⚠️ <b>Ошибка при обработке сообщения от ${userLink}</b>:\n\n${error.message}`,
				{ message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
			)
		} catch (sendError) {
			console.error(
				'❌ Ошибка при отправке сообщения админам об ошибке:',
				sendError
			)
		}

		// Отправляем пользователю сообщение об ошибке
		try {
			await sendTelegramMessage(
				bot,
				userId,
				'Извините, произошла ошибка при обработке вашего сообщения. Пожалуйста, попробуйте позже.'
			)
		} catch (userMessageError) {
			console.error(
				'❌ Не удалось отправить сообщение пользователю об ошибке:',
				userMessageError
			)
		}

		return true
	}
}

module.exports = {
	handleDeleteCommand,
	handleAlarmCommand,
	checkForbiddenWords,
	handleHashtagMedia,
	handlePrivateMessage,
	forwardMessageToAdmins,
	sendStandardResponseToUser,
}
