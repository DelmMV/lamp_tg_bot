/**
 * Обработчики медиа-сообщений
 * @module mediaHandler
 */

const { sendTelegramMessage, sendTelegramMedia } = require('../utils/messaging')
const { getRandomKaomoji } = require('../utils/helpers')
const {
	MONO_PITER_CHAT_ID,
	MEDIA_THREAD_ID,
	ADMIN_CHAT_ID,
	LAMP_THREAD_ID,
	MODULES,
} = require('../config')

/**
 * Обрабатывает группу медиа-сообщений
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @param {Array} messages - Массив сообщений в медиа-группе
 */
async function handleMediaGroup(bot, ctx, messages) {
	try {
		const media = messages
			.map(message => {
				if (message.photo) {
					return {
						type: 'photo',
						media: message.photo[message.photo.length - 1].file_id,
						caption: message.caption || '',
					}
				} else if (message.video) {
					return {
						type: 'video',
						media: message.video.file_id,
						caption: message.caption || '',
					}
				}
				return null
			})
			.filter(Boolean)

		if (media.length > 0) {
			await bot.telegram.sendMediaGroup(MONO_PITER_CHAT_ID, media, {
				message_thread_id: MEDIA_THREAD_ID,
			})

			// Отправляем ссылку на оригинальное сообщение
			const linkMessage = `https://t.me/${ctx.message.chat.username}/${ctx.message.message_thread_id}/${ctx.message.message_id}`
			await sendTelegramMessage(bot, MONO_PITER_CHAT_ID, linkMessage, {
				message_thread_id: MEDIA_THREAD_ID,
			})
		}
	} catch (error) {
		console.error('Error handling media group:', error)
		await sendTelegramMessage(
			bot,
			ADMIN_CHAT_ID,
			`Ошибка при обработке медиа-группы: ${error.message}`,
			{ message_thread_id: LAMP_THREAD_ID }
		)
	}
}

/**
 * Обрабатывает отдельное медиа-сообщение
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 */
async function handleSingleMessage(bot, ctx) {
	try {
		const {
			chat: { username },
			message_id,
			message_thread_id,
			caption,
			text,
			photo,
			video,
		} = ctx.message

		const mediaOptions = {
			message_thread_id: MEDIA_THREAD_ID,
			caption: `
${getRandomKaomoji()}
${caption || text || ''}
https://t.me/${username}/${message_thread_id}/${message_id}
      `.trim(),
		}

		if (photo) {
			await bot.telegram.sendPhoto(
				MONO_PITER_CHAT_ID,
				photo[photo.length - 1].file_id,
				mediaOptions
			)
		} else if (video) {
			await bot.telegram.sendVideo(
				MONO_PITER_CHAT_ID,
				video.file_id,
				mediaOptions
			)
		}

		// Обработка пересланного сообщения, если есть
		const replyMessage = ctx.message.reply_to_message
		if (replyMessage) {
			if (replyMessage.photo) {
				const photo = replyMessage.photo
				await bot.telegram.sendPhoto(
					MONO_PITER_CHAT_ID,
					photo[photo.length - 1].file_id,
					mediaOptions
				)
			} else if (replyMessage.video) {
				const video = replyMessage.video
				await bot.telegram.sendVideo(
					MONO_PITER_CHAT_ID,
					video.file_id,
					mediaOptions
				)
			}
		}
	} catch (error) {
		console.error('Error handling single media:', error)
		await sendTelegramMessage(
			bot,
			ADMIN_CHAT_ID,
			`Ошибка при обработке медиа: ${error.message}`,
			{ message_thread_id: LAMP_THREAD_ID }
		)
	}
}

module.exports = {
	handleMediaGroup,
	handleSingleMessage,
}
