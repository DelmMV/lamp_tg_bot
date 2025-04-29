/**
 * Модуль для обработки проверки и отмены просроченных заявок
 * @module handlers/requestCheckHandler
 */

const { MongoClient } = require('mongodb')
const {
	MONGO_URL,
	DB_NAME,
	ADMIN_CHAT_ID,
	LAMP_THREAD_ID,
	MONO_PITER_CHAT_ID,
	JOIN_REQUEST,
} = require('../config')
const { banUser } = require('../db')

// Добавляем константы для кнопок
const BAN_BUTTON = 'ban_user'
const CONFIRM_BAN_BUTTON = 'confirm_ban'
const CANCEL_BAN_BUTTON = 'cancel_ban'
const ACCEPT_BUTTON = 'accept_user'
const CONFIRM_ACCEPT_BUTTON = 'confirm_accept'
const CANCEL_ACCEPT_BUTTON = 'cancel_accept'

/** @type {import('mongodb').Db} */
let db = null

// Таймер для проверки заявок
let checkRequestsTimer = null

/**
 * Устанавливает соединение с базой данных
 * @async
 * @returns {Promise<import('mongodb').Db>} Экземпляр подключения к БД
 */
async function connectToDatabase() {
	try {
		const client = new MongoClient(MONGO_URL)
		await client.connect()
		db = client.db(DB_NAME)
		console.log('Connected to MongoDB')
		return db
	} catch (error) {
		console.error('MongoDB connection error:', error)
		throw error
	}
}

/**
 * Проверяет и отменяет просроченные заявки
 * @async
 * @param {Telegraf} bot - Экземпляр бота для отправки уведомлений
 * @returns {Promise<Array<Object>>} Список отмененных заявок
 */
async function checkAndCancelExpiredRequests(bot) {
	try {
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
							ADMIN_CHAT_ID,
							`⚠️ <b>Заявка автоматически отменена</b>\n\n` +
								`👤 Пользователь: ID ${request.userId}\n` +
								`❌ Причина: Пользователь недействителен (возможно удалил аккаунт)\n` +
								`⏱ Время создания: ${request.createdAt.toLocaleString()}`,
							{
								message_thread_id: LAMP_THREAD_ID,
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
							ADMIN_CHAT_ID,
							`⚠️ <b>Заявка автоматически отменена</b>\n\n` +
								`👤 Пользователь: <a href="tg://user?id=${request.userId}">${
									request.username || 'Неизвестный'
								}</a>\n` +
								`⏱ Время создания: ${request.createdAt.toLocaleString()}\n` +
								`⏳ Время жизни: ${adminTimeFormat}`,
							{
								message_thread_id: LAMP_THREAD_ID,
								parse_mode: 'HTML',
								reply_markup: {
									inline_keyboard: [
										[
											{
												text: '❌ Бан',
												callback_data: `${BAN_BUTTON}:${request.userId}`,
											},
										],
									],
								},
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
					await bot.telegram.sendMessage(
						ADMIN_CHAT_ID,
						`⚠️ <b>Ошибка при отмене заявки</b>\n\n` +
							`👤 Пользователь: <a href="tg://user?id=${request.userId}">${
								request.username || 'Неизвестный'
							}</a>\n` +
							`❌ Ошибка: ${error.message}`,
						{
							message_thread_id: LAMP_THREAD_ID,
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
			clearInterval(checkRequestsTimer)
		}

		// Запускаем проверку сразу при старте
		checkAndCancelExpiredRequests(botInstance).catch(error => {
			console.error('❌ Ошибка при проверке заявок:', error)
		})

		// Устанавливаем периодическую проверку
		checkRequestsTimer = setInterval(() => {
			checkAndCancelExpiredRequests(botInstance).catch(error => {
				console.error('❌ Ошибка при проверке заявок:', error)
			})
		}, JOIN_REQUEST.CHECK_INTERVAL_MINUTES * 60 * 1000)

		console.log('✅ Таймер проверки заявок запущен')
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

	// Отправляем новое сообщение с подтверждением
	await ctx.reply(
		`⚠️ <b>Подтверждение бана</b>\n\n` +
			`Вы уверены, что хотите забанить пользователя? Это действие необратимо.`,
		{
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[
						{
							text: '❌ Точно забанить',
							callback_data: `${CONFIRM_BAN_BUTTON}:${userId}`,
						},
						{ text: '✅ Нет', callback_data: `${CANCEL_BAN_BUTTON}:${userId}` },
					],
				],
			},
		}
	)
}

async function handleConfirmBan(ctx) {
	const userId = ctx.callbackQuery.data.split(':')[1]

	try {
		// Проверяем статус пользователя в группе
		try {
			const chatMember = await ctx.telegram.getChatMember(
				MONO_PITER_CHAT_ID,
				userId
			)

			// Если пользователь уже заблокирован, выходим
			if (chatMember.status === 'kicked') {
				await ctx.editMessageText(
					`ℹ️ Пользователь <a href="tg://user?id=${userId}">${
						chatMember.user.first_name
					} ${chatMember.user.last_name || ''}</a> уже заблокирован в группе`,
					{
						parse_mode: 'HTML',
					}
				)
				return
			}
		} catch (error) {
			// Если пользователь не найден в группе, это нормально - продолжаем
			if (!error.message.includes('user not found')) {
				throw error
			}
		}

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

		// Получаем информацию о пользователе
		let userInfo = `ID: ${userId}`
		try {
			const user = await ctx.telegram.getChatMember(MONO_PITER_CHAT_ID, userId)
			userInfo = `<a href="tg://user?id=${userId}">${user.user.first_name} ${
				user.user.last_name || ''
			}</a>`
		} catch (error) {
			console.error('Ошибка при получении информации о пользователе:', error)
		}

		// Получаем информацию о том, кто забанил
		const adminInfo = `<a href="tg://user?id=${ctx.from.id}">${
			ctx.from.first_name
		} ${ctx.from.last_name || ''}</a>`

		await ctx.editMessageText(
			`✅ Пользователь ${userInfo} заблокирован в группе\n` +
				`Заявка отклонена и пользователь уведомлен\n` +
				`👮‍♂️ Забанил: ${adminInfo}`,
			{ parse_mode: 'HTML' }
		)
	} catch (error) {
		console.error('Ошибка при блокировке пользователя:', error)
		await ctx.editMessageText(
			`❌ Произошла ошибка при блокировке пользователя: ${error.message}`,
			{ parse_mode: 'HTML' }
		)
	}
}

async function handleCancelBan(ctx) {
	await ctx.editMessageText(`✅ Действие отменено`, { parse_mode: 'HTML' })
}

// Добавляем обработчики для кнопок принятия
async function handleAcceptButton(ctx) {
	const userId = ctx.callbackQuery.data.split(':')[1]

	// Отправляем новое сообщение с подтверждением
	await ctx.reply(
		`⚠️ <b>Подтверждение принятия</b>\n\n` +
			`Вы уверены, что хотите принять пользователя в группу?`,
		{
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
		}
	)
}

async function handleConfirmAccept(ctx) {
	const userId = ctx.callbackQuery.data.split(':')[1]

	try {
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

		await ctx.editMessageText(
			`✅ Пользователь принят в группу\n` + `Пользователь уведомлен`,
			{ parse_mode: 'HTML' }
		)
	} catch (error) {
		// Специальная обработка ошибки HIDE_REQUESTER_MISSING
		if (error.message.includes('HIDE_REQUESTER_MISSING')) {
			console.log(
				`ℹ️ Заявка пользователя ${userId} уже была обработана (принята или отменена)`
			)

			// Обновляем сообщение с информацией о том, что заявка уже обработана
			await ctx.editMessageText(
				`ℹ️ Заявка пользователя уже была обработана (принята или отменена)`,
				{ parse_mode: 'HTML' }
			)
			return
		}

		// Специальная обработка ошибки USER_ALREADY_PARTICIPANT
		if (error.message.includes('USER_ALREADY_PARTICIPANT')) {
			console.log(`ℹ️ Пользователь ${userId} уже является участником группы`)

			// Обновляем сообщение с информацией о том, что пользователь уже в группе
			await ctx.editMessageText(
				`ℹ️ Пользователь уже является участником группы`,
				{ parse_mode: 'HTML' }
			)
			return
		}

		// Для других ошибок
		console.error('Ошибка при принятии пользователя:', error)
		await ctx.editMessageText(
			`❌ Произошла ошибка при принятии пользователя: ${error.message}`,
			{ parse_mode: 'HTML' }
		)
	}
}

async function handleCancelAccept(ctx) {
	await ctx.editMessageText(`✅ Действие отменено`, { parse_mode: 'HTML' })
}

module.exports = {
	connectToDatabase,
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
