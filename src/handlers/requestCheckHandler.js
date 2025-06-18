/**
 * Модуль для обработки проверки и отмены просроченных заявок
 * @module handlers/requestCheckHandler
 */

const {
	ADMIN_CHAT_ID,
	LAMP_THREAD_ID,
	MONO_PITER_CHAT_ID,
	JOIN_REQUEST,
	MODULES,
} = require('../config')
const { banUser, connectToDatabase, getDb } = require('../db')

// Добавляем константы для кнопок
const BAN_BUTTON = 'ban_user'
const CONFIRM_BAN_BUTTON = 'confirm_ban'
const CANCEL_BAN_BUTTON = 'cancel_ban'
const ACCEPT_BUTTON = 'accept_user'
const CONFIRM_ACCEPT_BUTTON = 'confirm_accept'
const CANCEL_ACCEPT_BUTTON = 'cancel_accept'

// Таймер для проверки заявок
let checkRequestsTimer = null

/**
 * Проверяет и отменяет просроченные заявки
 * @async
 * @param {Telegraf} bot - Экземпляр бота для отправки уведомлений
 * @returns {Promise<Array<Object>>} Список отмененных заявок
 */
async function checkAndCancelExpiredRequests(bot) {
	try {
		// Получаем экземпляр БД
		await connectToDatabase()
		const db = getDb()

		if (!db) {
			throw new Error('❌ Не удалось получить экземпляр базы данных')
		}

		const joinRequestsCollection = db.collection('joinRequests')
		const now = new Date()
		const lifetimeMinutes = JOIN_REQUEST.LIFETIME_MINUTES

		// Находим все просроченные заявки
		const expiredRequests = await joinRequestsCollection
			.find({
				status: 'pending',
				createdAt: {
					$lt: new Date(now.getTime() - lifetimeMinutes * 60 * 1000),
				},
			})
			.toArray()

		// Отменяем каждую просроченную заявку
		const canceledRequests = []
		for (const request of expiredRequests) {
			try {
				// Проверяем, не была ли заявка уже отменена
				if (request.status === 'expired') {
					console.log(`ℹ️ Заявка ${request._id} уже отменена, пропускаем`)
					continue
				}

				// Проверяем статус заявки в Telegram
				try {
					const chatMember = await bot.telegram.getChatMember(
						MONO_PITER_CHAT_ID,
						request.userId
					)

					// Если пользователь уже в группе или заблокирован, пропускаем
					if (chatMember.status !== 'left') {
						// Обновляем статус в базе данных
						await joinRequestsCollection.updateOne(
							{ _id: request._id },
							{
								$set: {
									status: 'expired',
									updatedAt: new Date(),
									reason: `Пользователь уже в группе (статус: ${chatMember.status})`,
								},
							}
						)
						continue
					}
				} catch (error) {
					// Специальная обработка ошибки USER_ID_INVALID
					if (error.message.includes('USER_ID_INVALID')) {
						// Обновляем статус в базе данных
						await joinRequestsCollection.updateOne(
							{ _id: request._id },
							{
								$set: {
									status: 'expired',
									updatedAt: new Date(),
									reason:
										'Пользователь недействителен (возможно удалил аккаунт)',
								},
							}
						)

						// Отправляем уведомление в админ-канал
						await bot.telegram.sendMessage(
							MODULES.SPAM_DETECTION.REPORT_CHAT_ID,
							`⚠️ <b>Заявка автоматически отменена</b>\n\n` +
								`👤 Пользователь: ID ${request.userId}\n` +
								`❌ Причина: Пользователь недействителен (возможно удалил аккаунт)\n` +
								`⏱ Время создания: ${request.createdAt.toLocaleString()}`,
							{
								message_thread_id: MODULES.SPAM_DETECTION.REPORT_THREAD_ID,
								parse_mode: 'HTML',
							}
						)
						continue
					}

					// Обрабатываем ошибку user is deactivated
					if (error.message.includes('user is deactivated')) {
						// Обновляем статус в базе данных
						await joinRequestsCollection.updateOne(
							{ _id: request._id },
							{
								$set: {
									status: 'expired',
									updatedAt: new Date(),
									reason: 'Пользователь деактивировал аккаунт',
								},
							}
						)
						continue
					}

					// Обрабатываем ошибку member not found
					if (error.message.includes('member not found')) {
						// Обновляем статус в базе данных
						await joinRequestsCollection.updateOne(
							{ _id: request._id },
							{
								$set: {
									status: 'expired',
									updatedAt: new Date(),
									reason: 'Пользователь не найден в группе',
								},
							}
						)

						// Пытаемся отклонить заявку в Telegram несмотря на ошибку при проверке статуса
						try {
							await bot.telegram.declineChatJoinRequest(
								MONO_PITER_CHAT_ID,
								request.userId
							)
							console.log(
								`✅ Заявка ${request._id} успешно отменена в Telegram`
							)
							canceledRequests.push(request)
						} catch (declineError) {
							// Если произошла другая ошибка при отклонении заявки, логируем ее
							console.error(
								`❌ Ошибка при отмене заявки ${request._id} в Telegram:`,
								declineError.message
							)
						}

						continue
					}

					// Для других ошибок
					await joinRequestsCollection.updateOne(
						{ _id: request._id },
						{
							$set: {
								status: 'expired',
								updatedAt: new Date(),
								reason: `Ошибка при проверке статуса: ${error.message}`,
							},
						}
					)

					// Все равно пытаемся отклонить заявку в Telegram
					try {
						await bot.telegram.declineChatJoinRequest(
							MONO_PITER_CHAT_ID,
							request.userId
						)
						console.log(
							`✅ Заявка ${request._id} успешно отменена в Telegram, несмотря на ошибку статуса`
						)
						canceledRequests.push(request)
					} catch (declineError) {
						// Если произошла другая ошибка при отклонении заявки, логируем ее
						console.error(
							`❌ Ошибка при отмене заявки ${request._id} в Telegram:`,
							declineError.message
						)
					}

					continue
				}

				// Отклоняем заявку в Telegram
				try {
					await bot.telegram.declineChatJoinRequest(
						MONO_PITER_CHAT_ID,
						request.userId
					)

					// Обновляем статус в базе данных
					const result = await joinRequestsCollection.updateOne(
						{ _id: request._id },
						{
							$set: {
								status: 'expired',
								updatedAt: new Date(),
								reason: 'Автоматически отменена по истечении времени',
							},
						}
					)

					if (result.modifiedCount > 0) {
						canceledRequests.push(request)

						// Отправляем уведомление пользователю
						try {
							const hours = Math.floor(lifetimeMinutes / 60)
							const minutes = lifetimeMinutes % 60
							const timeFormat =
								hours > 0 ? `${hours} ч. ${minutes} мин.` : `${minutes} мин.`

							await bot.telegram.sendMessage(
								request.userId,
								`⚠️ <b>Ваша заявка на вступление в группу отклонена</b>\n\n` +
									`Время ожидания ответа истекло (${timeFormat})\n` +
									`Вы можете подать новую заявку в любое время`,
								{ parse_mode: 'HTML' }
							)
						} catch (userNotifyError) {
							// Определяем тип ошибки для более точного логирования
							const errorType = userNotifyError.message.includes(
								'USER_ID_INVALID'
							)
								? 'Пользователь недействителен (возможно удалил аккаунт)'
								: userNotifyError.message.includes(
										'bot was blocked by the user'
								  )
								? 'Пользователь заблокировал бота'
								: userNotifyError.message.includes('user is deactivated')
								? 'Пользователь деактивировал аккаунт'
								: 'Неизвестная ошибка'

							// Логируем только нестандартные ошибки
							if (
								!userNotifyError.message.includes(
									'bot was blocked by the user'
								) &&
								!userNotifyError.message.includes('USER_ID_INVALID') &&
								!userNotifyError.message.includes('user is deactivated')
							) {
								console.error(
									`❌ Нестандартная ошибка при отправке уведомления пользователю ${request.userId}:`,
									userNotifyError
								)
							} else {
								console.log(
									`ℹ️ Стандартная ошибка при отправке уведомления пользователю ${request.userId}: ${errorType}`
								)
							}

							// Обновляем статус в базе данных с более точной причиной
							await joinRequestsCollection.updateOne(
								{ _id: request._id },
								{
									$set: {
										status: 'expired',
										updatedAt: new Date(),
										reason: `Автоматически отменена по истечении времени (${errorType})`,
									},
								}
							)
						}

						// Отправляем уведомление в админ-канал
						const adminHours = Math.floor(lifetimeMinutes / 60)
						const adminMinutes = lifetimeMinutes % 60
						const adminTimeFormat =
							adminHours > 0
								? `${adminHours} ч. ${adminMinutes} мин.`
								: `${adminMinutes} мин.`

						await bot.telegram.sendMessage(
							MODULES.SPAM_DETECTION.REPORT_CHAT_ID,
							`⚠️ <b>Заявка автоматически отменена</b>\n\n` +
								`👤 Пользователь: <a href="tg://user?id=${request.userId}">${
									request.username || 'Неизвестный'
								}</a>\n` +
								`⏱ Время создания: ${request.createdAt.toLocaleString()}\n` +
								`⏳ Время жизни: ${adminTimeFormat}`,
							{
								message_thread_id: MODULES.SPAM_DETECTION.REPORT_THREAD_ID,
								parse_mode: 'HTML',
							}
						)
					}
				} catch (error) {
					// Обрабатываем ошибку HIDE_REQUESTER_MISSING
					if (error.message.includes('HIDE_REQUESTER_MISSING')) {
						// Обновляем статус в базе данных
						await joinRequestsCollection.updateOne(
							{ _id: request._id },
							{
								$set: {
									status: 'expired',
									updatedAt: new Date(),
									reason: 'Заявка уже была отменена',
								},
							}
						)
						continue
					}

					// Обрабатываем ошибку member not found
					if (error.message.includes('member not found')) {
						// Обновляем статус в базе данных
						await joinRequestsCollection.updateOne(
							{ _id: request._id },
							{
								$set: {
									status: 'expired',
									updatedAt: new Date(),
									reason: 'Заявка не найдена в Telegram',
								},
							}
						)
						continue
					}

					// Обрабатываем ошибку USER_ID_INVALID
					if (error.message.includes('USER_ID_INVALID')) {
						// Обновляем статус в базе данных
						await joinRequestsCollection.updateOne(
							{ _id: request._id },
							{
								$set: {
									status: 'expired',
									updatedAt: new Date(),
									reason:
										'Пользователь недействителен (возможно удалил аккаунт)',
								},
							}
						)
						continue
					}

					// Обрабатываем ошибку user is deactivated
					if (error.message.includes('user is deactivated')) {
						// Обновляем статус в базе данных
						await joinRequestsCollection.updateOne(
							{ _id: request._id },
							{
								$set: {
									status: 'expired',
									updatedAt: new Date(),
									reason: 'Пользователь деактивировал аккаунт',
								},
							}
						)
						continue
					}

					// Для других ошибок отправляем уведомление в админ-канал
					console.error(
						`❌ Неизвестная ошибка при отмене заявки ${request._id} пользователя ${request.userId}:`,
						error.message
					)

					await bot.telegram.sendMessage(
						MODULES.SPAM_DETECTION.REPORT_CHAT_ID,
						`⚠️ <b>Ошибка при отмене заявки</b>\n\n` +
							`👤 Пользователь: <a href="tg://user?id=${request.userId}">${
								request.username || 'Неизвестный'
							}</a>\n` +
							`❌ Ошибка: ${error.message}`,
						{
							message_thread_id: MODULES.SPAM_DETECTION.REPORT_THREAD_ID,
							parse_mode: 'HTML',
						}
					)
				}
			} catch (error) {
				// Логируем только критические ошибки
				if (
					!error.message.includes('HIDE_REQUESTER_MISSING') &&
					!error.message.includes('user is deactivated')
				) {
					console.error(
						`❌ Критическая ошибка при обработке заявки пользователя ${request.userId}:`,
						error
					)
				}
			}
		}

		return canceledRequests
	} catch (error) {
		console.error('❌ Критическая ошибка при проверке заявок:', error)
		return []
	}
}

/**
 * Запускает периодическую проверку заявок
 * @param {Telegraf} botInstance - Экземпляр бота
 */
function startRequestCheckTimer(botInstance) {
	try {
		// Очищаем предыдущий таймер, если он существует
		if (checkRequestsTimer) {
			console.log('Таймер проверки заявок уже запущен, перезапускаем')
			clearInterval(checkRequestsTimer)
		}

		// Устанавливаем периодическую проверку
		checkRequestsTimer = setInterval(async () => {
			try {
				// Проверяем базу данных и выполняем проверку заявок
				await checkAndCancelExpiredRequests(botInstance)
			} catch (error) {
				console.error('❌ Ошибка при проверке заявок:', error)
			}
		}, JOIN_REQUEST.CHECK_INTERVAL_MINUTES * 60 * 1000)

		console.log(
			`✅ Таймер проверки заявок запущен с интервалом ${JOIN_REQUEST.CHECK_INTERVAL_MINUTES} минут`
		)
	} catch (error) {
		console.error('❌ Ошибка при запуске таймера проверки заявок:', error)
	}
}

/**
 * Останавливает таймер проверки заявок
 */
function stopRequestCheckTimer() {
	if (checkRequestsTimer) {
		clearInterval(checkRequestsTimer)
		checkRequestsTimer = null
		console.log('✅ Таймер проверки заявок остановлен')
	}
}

// Добавляем обработчики для кнопок бана
async function handleBanButton(ctx) {
	const userId = ctx.callbackQuery.data.split(':')[1]

	try {
		// Получаем текущее сообщение
		const message = ctx.callbackQuery.message

		// Если это видео-кружок, используем другой подход
		if (message.video_note) {
			// Получаем ID видео-кружка
			const videoNoteFileId = message.video_note.file_id

			// Формируем текст для сообщения
			const userName = message.from
				? `${message.from.first_name} ${message.from.last_name || ''}`
				: 'пользователя'
			const text = `📹 Видео-сообщение от ${userName}`

			// Удаляем оригинальное сообщение
			await ctx.deleteMessage()

			// Отправляем кружок
			await ctx.telegram.sendVideoNote(message.chat.id, videoNoteFileId)

			// Отправляем новое сообщение с текстом и кнопками
			await ctx.telegram.sendMessage(message.chat.id, text, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '❌ Забанить',
								callback_data: `${CONFIRM_BAN_BUTTON}:${userId}`,
							},
							{
								text: '✅ Отмена',
								callback_data: `${CANCEL_BAN_BUTTON}:${userId}`,
							},
						],
					],
				},
			})

			return
		}

		// Получаем текущий текст сообщения
		let currentText = message.text || message.caption || ''

		// Если текст пустой, добавляем сообщение о типе медиа
		if (!currentText) {
			if (message.video) {
				currentText = '📹 Видео-сообщение'
			} else if (message.photo) {
				currentText = '🖼 Фото-сообщение'
			} else if (message.voice) {
				currentText = '🎤 Голосовое сообщение'
			} else if (message.audio) {
				currentText = '🎵 Аудио-сообщение'
			} else if (message.document) {
				currentText = '📄 Документ'
			} else {
				currentText = '📝 Сообщение'
			}

			// Добавляем информацию об отправителе, если она доступна
			if (message.from) {
				currentText += ` от ${message.from.first_name} ${
					message.from.last_name || ''
				}`
			}
		}

		// Проверяем, есть ли в сообщении медиа
		if (
			message.photo ||
			message.video ||
			message.document ||
			message.audio ||
			message.voice
		) {
			// Для сообщений с медиа используем editMessageCaption
			await ctx.editMessageCaption(currentText, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '❌ Забанить',
								callback_data: `${CONFIRM_BAN_BUTTON}:${userId}`,
							},
							{
								text: '✅ Отмена',
								callback_data: `${CANCEL_BAN_BUTTON}:${userId}`,
							},
						],
					],
				},
			})
		} else {
			// Для текстовых сообщений используем editMessageText
			await ctx.editMessageText(currentText, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '❌ Забанить',
								callback_data: `${CONFIRM_BAN_BUTTON}:${userId}`,
							},
							{
								text: '✅ Отмена',
								callback_data: `${CANCEL_BAN_BUTTON}:${userId}`,
							},
						],
					],
				},
			})
		}
	} catch (error) {
		console.error(
			'Ошибка при обновлении сообщения для подтверждения бана:',
			error
		)
		// Сообщаем о проблеме в оригинальном сообщении
		await ctx.answerCbQuery('Ошибка при обновлении сообщения: ' + error.message)
	}
}

async function handleConfirmBan(ctx) {
	const userId = ctx.callbackQuery.data.split(':')[1]

	try {
		// Получаем исходное сообщение
		const message = ctx.callbackQuery.message

		// Получаем текст сообщения
		let originalText = message.text || message.caption || ''

		// Если текст пустой, добавляем сообщение о типе медиа
		if (!originalText) {
			if (message.video) {
				originalText = '📹 Видео-сообщение'
			} else if (message.photo) {
				originalText = '🖼 Фото-сообщение'
			} else if (message.video_note) {
				originalText = '⚪ Видео-кружок'
			} else if (message.voice) {
				originalText = '🎤 Голосовое сообщение'
			} else if (message.audio) {
				originalText = '🎵 Аудио-сообщение'
			} else if (message.document) {
				originalText = '📄 Документ'
			} else {
				originalText = '📝 Сообщение'
			}

			// Добавляем информацию об отправителе, если она доступна
			if (message.from) {
				originalText += ` от ${message.from.first_name} ${
					message.from.last_name || ''
				}`
			}
		}

		// Выводим в лог для дебага
		console.log('Текст перед баном:', originalText)

		// Проверяем статус пользователя в группе
		let userIsAlreadyBanned = false
		let userInfo = `ID: ${userId}`

		try {
			const chatMember = await ctx.telegram.getChatMember(
				MONO_PITER_CHAT_ID,
				userId
			)

			// Сохраняем информацию о пользователе
			userInfo = `<a href="tg://user?id=${userId}">${
				chatMember.user.first_name
			} ${chatMember.user.last_name || ''}</a>`

			// Если пользователь уже заблокирован, выходим
			if (chatMember.status === 'kicked') {
				userIsAlreadyBanned = true
				const banText = `\n\nℹ️ Пользователь ${userInfo} уже заблокирован в группе`
				const newText = originalText + banText

				// Обновляем сообщение, сохраняя исходный текст
				if (
					message.photo ||
					message.video ||
					message.document ||
					message.audio ||
					message.voice ||
					message.video_note
				) {
					await ctx.editMessageCaption(newText, { parse_mode: 'HTML' })
				} else {
					await ctx.editMessageText(newText, { parse_mode: 'HTML' })
				}
				return
			}
		} catch (error) {
			// Если пользователь не найден в группе, это нормально - продолжаем
			if (!error.message.includes('user not found')) {
				throw error
			}
		}

		if (userIsAlreadyBanned) return

		// Сначала пытаемся отклонить заявку
		try {
			await ctx.telegram.declineChatJoinRequest(MONO_PITER_CHAT_ID, userId)
		} catch (declineError) {
			// Если ошибка HIDE_REQUESTER_MISSING, значит заявка уже была отклонена
			// или пользователь заблокировал бота - это нормальная ситуация
			if (!declineError.message.includes('HIDE_REQUESTER_MISSING')) {
				throw declineError
			}
		}

		// Затем баним пользователя
		await ctx.telegram.banChatMember(MONO_PITER_CHAT_ID, userId)

		// Сохраняем информацию о бане в БД
		await banUser(userId, ctx.from.id, 'Забанен администратором')

		// Пытаемся отправить уведомление пользователю
		try {
			await ctx.telegram.sendMessage(
				userId,
				`⚠️ <b>Вы заблокированы в группе</b>\n`,
				{ parse_mode: 'HTML' }
			)
		} catch (notifyError) {
			// Если пользователь заблокировал бота, это нормальная ситуация
			if (!notifyError.message.includes('bot was blocked by the user')) {
				console.error(
					'Ошибка при отправке уведомления пользователю:',
					notifyError
				)
			}
		}

		// Получаем информацию о том, кто забанил
		const adminInfo = `<a href="tg://user?id=${ctx.from.id}">${
			ctx.from.first_name
		} ${ctx.from.last_name || ''}</a>`

		// Добавляем информацию о бане к исходному сообщению
		const banText =
			`\n\n❌ <b>Пользователь ${userInfo} заблокирован в группе</b>\n` +
			`Заявка отклонена и пользователь уведомлен\n` +
			`👮‍♂️ Забанил: ${adminInfo}`

		const newText = originalText + banText

		// Обновляем сообщение, сохраняя исходный текст
		if (
			message.photo ||
			message.video ||
			message.document ||
			message.audio ||
			message.voice ||
			message.video_note
		) {
			// Для сообщений с медиа используем editMessageCaption
			await ctx.editMessageCaption(newText, {
				parse_mode: 'HTML',
			})
		} else {
			// Для текстовых сообщений используем editMessageText
			await ctx.editMessageText(newText, {
				parse_mode: 'HTML',
			})
		}
	} catch (error) {
		// Получаем исходное сообщение для обработки ошибок
		const message = ctx.callbackQuery.message
		let originalText = message.text || message.caption || ''

		// Если текст пустой, добавляем сообщение о типе медиа
		if (!originalText) {
			if (message.video) {
				originalText = '📹 Видео-сообщение'
			} else if (message.photo) {
				originalText = '🖼 Фото-сообщение'
			} else if (message.video_note) {
				originalText = '⚪ Видео-кружок'
			} else if (message.voice) {
				originalText = '🎤 Голосовое сообщение'
			} else if (message.audio) {
				originalText = '🎵 Аудио-сообщение'
			} else if (message.document) {
				originalText = '📄 Документ'
			} else {
				originalText = '📝 Сообщение'
			}

			// Добавляем информацию об отправителе, если она доступна
			if (message.from) {
				originalText += ` от ${message.from.first_name} ${
					message.from.last_name || ''
				}`
			}
		}

		// Добавляем информацию об ошибке к исходному сообщению
		const errorText = `\n\n❌ <b>Произошла ошибка при блокировке пользователя:</b> ${error.message}`
		const newText = originalText + errorText

		console.error('Ошибка при блокировке пользователя:', error)

		// Обновляем сообщение, сохраняя исходный текст
		try {
			if (
				message.photo ||
				message.video ||
				message.document ||
				message.audio ||
				message.voice ||
				message.video_note
			) {
				// Для сообщений с медиа используем editMessageCaption
				await ctx.editMessageCaption(newText, {
					parse_mode: 'HTML',
				})
			} else {
				// Для текстовых сообщений используем editMessageText
				await ctx.editMessageText(newText, {
					parse_mode: 'HTML',
				})
			}
		} catch (updateError) {
			console.error('Ошибка при обновлении сообщения с ошибкой:', updateError)
		}
	}
}

async function handleCancelBan(ctx) {
	try {
		// Получаем текущее сообщение
		const message = ctx.callbackQuery.message

		// Получаем ID пользователя из callback_data
		const userId = ctx.callbackQuery.data.split(':')[1]

		// Получаем текущий текст сообщения
		let currentText = message.text || message.caption || ''

		// Если текст пустой, добавляем сообщение о типе медиа
		if (!currentText) {
			if (message.video) {
				currentText = '📹 Видео-сообщение'
			} else if (message.photo) {
				currentText = '🖼 Фото-сообщение'
			} else if (message.voice) {
				currentText = '🎤 Голосовое сообщение'
			} else if (message.audio) {
				currentText = '🎵 Аудио-сообщение'
			} else if (message.document) {
				currentText = '📄 Документ'
			} else {
				currentText = '📝 Сообщение'
			}

			// Добавляем информацию об отправителе, если она доступна
			if (message.from) {
				currentText += ` от ${message.from.first_name} ${
					message.from.last_name || ''
				}`
			}
		}

		// Проверяем, есть ли в сообщении медиа
		if (
			message.photo ||
			message.video ||
			message.document ||
			message.audio ||
			message.voice
		) {
			// Для сообщений с медиа используем editMessageCaption
			await ctx.editMessageCaption(currentText, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '❌ Бан',
								callback_data: `${BAN_BUTTON}:${userId}`,
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
			})
		} else {
			// Для текстовых сообщений используем editMessageText
			await ctx.editMessageText(currentText, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '❓ Задать вопрос',
								callback_data: `ask_${userId}`,
							},
							{
								text: '❌ Бан',
								callback_data: `${BAN_BUTTON}:${userId}`,
							},
						],
					],
				},
			})
		}

		await ctx.answerCbQuery('Отменено')
	} catch (error) {
		console.error('Ошибка при отмене бана:', error)
		await ctx.answerCbQuery('Ошибка при отмене: ' + error.message)
	}
}

// Добавляем обработчики для кнопок принятия
async function handleAcceptButton(ctx) {
	const userId = ctx.callbackQuery.data.split(':')[1]

	try {
		// Получаем текущее сообщение
		const message = ctx.callbackQuery.message

		// Если это видео-кружок, используем другой подход
		if (message.video_note) {
			// Получаем ID видео-кружка
			const videoNoteFileId = message.video_note.file_id

			// Формируем текст для сообщения
			const userName = message.from
				? `${message.from.first_name} ${message.from.last_name || ''}`
				: 'пользователя'
			const text = `📹 Видео-сообщение от ${userName}`

			// Удаляем оригинальное сообщение
			await ctx.deleteMessage()

			// Отправляем кружок
			await ctx.telegram.sendVideoNote(message.chat.id, videoNoteFileId)

			// Отправляем новое сообщение с текстом и кнопками
			await ctx.telegram.sendMessage(message.chat.id, text, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '✅ Принять',
								callback_data: `${CONFIRM_ACCEPT_BUTTON}:${userId}`,
							},
							{
								text: '❌ Отмена',
								callback_data: `${CANCEL_ACCEPT_BUTTON}:${userId}`,
							},
						],
					],
				},
			})

			return
		}

		// Получаем текущий текст сообщения
		let currentText = message.text || message.caption || ''

		// Если текст пустой, добавляем сообщение о типе медиа
		if (!currentText) {
			if (message.video) {
				currentText = '📹 Видео-сообщение'
			} else if (message.photo) {
				currentText = '🖼 Фото-сообщение'
			} else if (message.voice) {
				currentText = '🎤 Голосовое сообщение'
			} else if (message.audio) {
				currentText = '🎵 Аудио-сообщение'
			} else if (message.document) {
				currentText = '📄 Документ'
			} else {
				currentText = '📝 Сообщение'
			}

			// Добавляем информацию об отправителе, если она доступна
			if (message.from) {
				currentText += ` от ${message.from.first_name} ${
					message.from.last_name || ''
				}`
			}
		}

		// Проверяем, есть ли в сообщении медиа
		if (
			message.photo ||
			message.video ||
			message.document ||
			message.audio ||
			message.voice
		) {
			// Для сообщений с медиа используем editMessageCaption
			await ctx.editMessageCaption(currentText, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '✅ Принять',
								callback_data: `${CONFIRM_ACCEPT_BUTTON}:${userId}`,
							},
							{
								text: '❌ Отмена',
								callback_data: `${CANCEL_ACCEPT_BUTTON}:${userId}`,
							},
						],
					],
				},
			})
		} else {
			// Для текстовых сообщений используем editMessageText
			await ctx.editMessageText(currentText, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '✅ Принять',
								callback_data: `${CONFIRM_ACCEPT_BUTTON}:${userId}`,
							},
							{
								text: '❌ Отмена',
								callback_data: `${CANCEL_ACCEPT_BUTTON}:${userId}`,
							},
						],
					],
				},
			})
		}
	} catch (error) {
		console.error(
			'Ошибка при обновлении сообщения для подтверждения принятия:',
			error
		)
		// Сообщаем о проблеме в оригинальном сообщении
		await ctx.answerCbQuery('Ошибка при обновлении сообщения: ' + error.message)
	}
}

async function handleConfirmAccept(ctx) {
	const userId = ctx.callbackQuery.data.split(':')[1]

	try {
		// Получаем исходное сообщение
		const message = ctx.callbackQuery.message

		// Получаем текст сообщения
		let originalText = message.text || message.caption || ''

		// Если текст пустой, добавляем сообщение о типе медиа
		if (!originalText) {
			if (message.video) {
				originalText = '📹 Видео-сообщение'
			} else if (message.photo) {
				originalText = '🖼 Фото-сообщение'
			} else if (message.video_note) {
				originalText = '⚪ Видео-кружок'
			} else if (message.voice) {
				originalText = '🎤 Голосовое сообщение'
			} else if (message.audio) {
				originalText = '🎵 Аудио-сообщение'
			} else if (message.document) {
				originalText = '📄 Документ'
			} else {
				originalText = '📝 Сообщение'
			}

			// Добавляем информацию об отправителе, если она доступна
			if (message.from) {
				originalText += ` от ${message.from.first_name} ${
					message.from.last_name || ''
				}`
			}
		}

		// Выводим в лог для дебага
		console.log('Текст перед принятием:', originalText)

		// Принимаем пользователя в группу
		await ctx.telegram.approveChatJoinRequest(MONO_PITER_CHAT_ID, userId)

		// Отправляем уведомление пользователю
		try {
			await ctx.telegram.sendMessage(
				userId,
				`✅ <b>Ваша заявка на вступление в группу одобрена</b>\n\n` +
					`Добро пожаловать в группу!`,
				{ parse_mode: 'HTML' }
			)
		} catch (notifyError) {
			console.error(
				'Ошибка при отправке уведомления пользователю:',
				notifyError
			)
		}

		// Добавляем информацию о принятии к исходному сообщению
		const acceptText =
			'\n\n✅ <b>Пользователь принят в группу. Пользователь уведомлен.</b>'
		const newText = originalText + acceptText

		// Обновляем сообщение, сохраняя исходный текст
		if (
			message.photo ||
			message.video ||
			message.document ||
			message.audio ||
			message.voice ||
			message.video_note
		) {
			// Для сообщений с медиа используем editMessageCaption
			await ctx.editMessageCaption(newText, {
				parse_mode: 'HTML',
			})
		} else {
			// Для текстовых сообщений используем editMessageText
			await ctx.editMessageText(newText, {
				parse_mode: 'HTML',
			})
		}
	} catch (error) {
		// Получаем исходное сообщение для обработки ошибок
		const message = ctx.callbackQuery.message
		let originalText = message.text || message.caption || ''

		// Если текст пустой, добавляем сообщение о типе медиа
		if (!originalText) {
			if (message.video) {
				originalText = '📹 Видео-сообщение'
			} else if (message.photo) {
				originalText = '🖼 Фото-сообщение'
			} else if (message.video_note) {
				originalText = '⚪ Видео-кружок'
			} else if (message.voice) {
				originalText = '🎤 Голосовое сообщение'
			} else if (message.audio) {
				originalText = '🎵 Аудио-сообщение'
			} else if (message.document) {
				originalText = '📄 Документ'
			} else {
				originalText = '📝 Сообщение'
			}

			// Добавляем информацию об отправителе, если она доступна
			if (message.from) {
				originalText += ` от ${message.from.first_name} ${
					message.from.last_name || ''
				}`
			}
		}

		let errorText = ''

		// Специальная обработка ошибки HIDE_REQUESTER_MISSING
		if (error.message.includes('HIDE_REQUESTER_MISSING')) {
			console.log(
				`ℹ️ Заявка пользователя ${userId} уже была обработана (принята или отменена)`
			)
			errorText =
				'\n\nℹ️ <b>Заявка пользователя уже была обработана (принята или отменена)</b>'
		}
		// Специальная обработка ошибки USER_ALREADY_PARTICIPANT
		else if (error.message.includes('USER_ALREADY_PARTICIPANT')) {
			console.log(`ℹ️ Пользователь ${userId} уже является участником группы`)
			errorText = '\n\nℹ️ <b>Пользователь уже является участником группы</b>'
		}
		// Для других ошибок
		else {
			console.error('Ошибка при принятии пользователя:', error)
			errorText = `\n\n❌ <b>Произошла ошибка при принятии пользователя:</b> ${error.message}`
		}

		// Добавляем сообщение об ошибке к исходному тексту
		const newText = originalText + errorText

		// Обновляем сообщение, сохраняя исходный текст
		try {
			if (
				message.photo ||
				message.video ||
				message.document ||
				message.audio ||
				message.voice ||
				message.video_note
			) {
				// Для сообщений с медиа используем editMessageCaption
				await ctx.editMessageCaption(newText, {
					parse_mode: 'HTML',
				})
			} else {
				// Для текстовых сообщений используем editMessageText
				await ctx.editMessageText(newText, {
					parse_mode: 'HTML',
				})
			}
		} catch (updateError) {
			console.error('Ошибка при обновлении сообщения с ошибкой:', updateError)
		}
	}
}

async function handleCancelAccept(ctx) {
	// Получаем ID пользователя из callback_data
	const userId = ctx.callbackQuery.data.split(':')[1]

	try {
		// Получаем исходное сообщение
		const message = ctx.callbackQuery.message

		// Получаем текст сообщения
		let originalText = message.text || message.caption || ''

		// Если текст пустой, добавляем сообщение о типе медиа
		if (!originalText) {
			if (message.video) {
				originalText = '📹 Видео-сообщение'
			} else if (message.photo) {
				originalText = '🖼 Фото-сообщение'
			} else if (message.video_note) {
				originalText = '⚪ Видео-кружок'
			} else if (message.voice) {
				originalText = '🎤 Голосовое сообщение'
			} else if (message.audio) {
				originalText = '🎵 Аудио-сообщение'
			} else if (message.document) {
				originalText = '📄 Документ'
			} else {
				originalText = '📝 Сообщение'
			}

			// Добавляем информацию об отправителе, если она доступна
			if (message.from) {
				originalText += ` от ${message.from.first_name} ${
					message.from.last_name || ''
				}`
			}
		}

		// Выводим в лог для дебага
		console.log('Текст сообщения:', originalText)

		// Для любого сообщения восстанавливаем исходные кнопки "Принять" и "Задать вопрос"
		const keyboard = [
			[{ text: '✅ Принять', callback_data: `${ACCEPT_BUTTON}:${userId}` }],
			[{ text: '❓ Задать вопрос', callback_data: `ask_${userId}` }],
		]

		// Возвращаем исходный интерфейс с соответствующими кнопками
		if (
			message.photo ||
			message.video ||
			message.document ||
			message.audio ||
			message.voice ||
			message.video_note
		) {
			// Для сообщений с медиа используем editMessageCaption
			await ctx.editMessageCaption(originalText, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: keyboard,
				},
			})
		} else {
			// Для текстовых сообщений используем editMessageText
			await ctx.editMessageText(originalText, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: keyboard,
				},
			})
		}
	} catch (error) {
		console.error('Ошибка при отмене принятия:', error)
		// В случае ошибки просто выводим сообщение "Действие отменено"
		await ctx.editMessageText(`✅ Действие отменено`, { parse_mode: 'HTML' })
	}
}

module.exports = {
	checkAndCancelExpiredRequests,
	startRequestCheckTimer,
	stopRequestCheckTimer,
	handleBanButton,
	handleConfirmBan,
	handleCancelBan,
	handleAcceptButton,
	handleConfirmAccept,
	handleCancelAccept,
}
