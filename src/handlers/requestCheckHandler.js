/**
 * Модуль для обработки проверки и отмены просроченных заявок
 * @module handlers/requestCheckHandler
 */

const { MongoClient, ObjectId } = require('mongodb')
const {
	MONGO_URL,
	DB_NAME,
	ADMIN_CHAT_ID,
	LAMP_THREAD_ID,
	MONO_PITER_CHAT_ID,
	JOIN_REQUEST,
} = require('../config')

// Добавляем константы для кнопок
const BAN_BUTTON = 'ban_user'
const CONFIRM_BAN_BUTTON = 'confirm_ban'
const CANCEL_BAN_BUTTON = 'cancel_ban'

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
				// Отклоняем заявку в Telegram
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
						console.error(
							`❌ Ошибка при отправке уведомления пользователю ${request.userId}:`,
							userNotifyError
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
				console.error(
					`❌ Ошибка при отмене заявки пользователя ${request.userId}:`,
					error
				)

				// Отправляем уведомление об ошибке в админ-канал
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
		}

		return canceledRequests
	} catch (error) {
		console.error('Error checking and canceling expired requests:', error)
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
		// Баним пользователя в группе
		await ctx.telegram.banChatMember(MONO_PITER_CHAT_ID, userId)

		// Отклоняем заявку на вступление
		await ctx.telegram.declineChatJoinRequest(MONO_PITER_CHAT_ID, userId)

		// Отправляем уведомление пользователю
		try {
			await ctx.telegram.sendMessage(
				userId,
				`⚠️ <b>Ваша заявка на вступление в группу отклонена</b>\n\n` +
					`Вы заблокированы в группе.`,
				{ parse_mode: 'HTML' }
			)
		} catch (notifyError) {
			console.error(
				'Ошибка при отправке уведомления пользователю:',
				notifyError
			)
		}

		await ctx.editMessageText(
			`✅ Пользователь заблокирован в группе\n` +
				`Заявка отклонена и пользователь уведомлен`,
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

module.exports = {
	connectToDatabase,
	checkAndCancelExpiredRequests,
	startRequestCheckTimer,
	stopRequestCheckTimer,
	handleBanButton,
	handleConfirmBan,
	handleCancelBan,
}
