const { Telegraf } = require('telegraf')
const { MongoClient, ObjectId } = require('mongodb')
const {
	connectToDatabase,
	closeDatabase,
	checkAndCancelExpiredRequests,
} = require('./db')
const {
	BOT_TOKEN,
	MONO_PITER_CHAT_ID,
	MEDIA_THREAD_ID,
	ADMIN_CHAT_ID,
	LAMP_THREAD_ID,
	JOIN_REQUEST,
	MODULES,
} = require('./config')
const { containsForbiddenWords } = require('./utils/contentFilter')
const { hasMediaHashtag } = require('./utils/helpers')
const { sendTelegramMessage, sendTelegramMedia } = require('./utils/messaging')
const {
	isUserAccessError,
	formatUserAccessError,
} = require('./utils/errorHandler')
const {
	handleMediaGroup,
	handleSingleMessage,
} = require('./handlers/mediaHandler')
const {
	handleDeleteCommand,
	handleAlarmCommand,
	checkForbiddenWords,
	handleHashtagMedia,
	handlePrivateMessage,
} = require('./handlers/messageHandler')
const { handleMessageForAds } = require('./handlers/adHandler')
const {
	handleNewChatMembers,
	handleChatJoinRequest,
} = require('./handlers/userHandler')
const {
	handleJoinRequestCallback,
	sendAdminQuestion,
	handleUserReply,
} = require('./handlers/joinRequestHandler')
const {
	startRequestCheckTimer,
	stopRequestCheckTimer,
	handleBanButton,
	handleConfirmBan,
	handleCancelBan,
	handleAcceptButton,
	handleConfirmAccept,
	handleCancelAccept,
} = require('./handlers/requestCheckHandler')
const { handleSummaryCommand } = require('./handlers/summaryHandler')
const { storeMessage } = require('./utils/chatStorage')
const { generateChatSummary, sendSummaryToAdmin } = require('./utils/gemini')
const { getLastHoursMessages } = require('./utils/chatStorage')

// Глобальная переменная для хранения экземпляра бота
let bot = null

/**
 * Инициализирует бота Telegram
 * @returns {Telegraf} Экземпляр бота
 */
function initBot() {
	try {
		const newBot = new Telegraf(BOT_TOKEN)
		console.log('🤖 Бот инициализирован')
		return newBot
	} catch (error) {
		console.error('❌ Ошибка при инициализации бота:', error)
		throw error
	}
}

/**
 * Настраивает обработчики команд бота
 * @param {Telegraf} botInstance - Экземпляр бота
 */
function setupCommandHandlers(botInstance) {
	try {
		// Обработчики команд
		botInstance.command('delete', ctx => handleDeleteCommand(botInstance, ctx))
		botInstance.command('alarm', ctx => handleAlarmCommand(botInstance, ctx))
		botInstance.command('summary', ctx =>
			handleSummaryCommand(botInstance, ctx)
		)
		console.log('✅ Обработчики команд настроены')
	} catch (error) {
		console.error('❌ Ошибка при настройке обработчиков команд:', error)
		throw error
	}
}

/**
 * Настраивает обработчики событий пользователей
 * @param {Telegraf} botInstance - Экземпляр бота
 */
function setupUserEventHandlers(botInstance) {
	try {
		botInstance.on('new_chat_members', ctx =>
			handleNewChatMembers(botInstance, ctx)
		)
		botInstance.on('chat_join_request', ctx =>
			handleChatJoinRequest(botInstance, ctx)
		)
		console.log('✅ Обработчики событий пользователей настроены')
	} catch (error) {
		console.error(
			'❌ Ошибка при настройке обработчиков событий пользователей:',
			error
		)
		throw error
	}
}

/**
 * Настраивает обработчик callback запросов (кнопки)
 * @param {Telegraf} botInstance - Экземпляр бота
 */
function setupCallbackQueryHandler(botInstance) {
	try {
		botInstance.on('callback_query', async ctx => {
			console.log('📢 Получен callback запрос:', ctx.callbackQuery.data)

			// Флаг, указывающий, что мы ответили на callback
			let callbackAnswered = false

			try {
				// Сразу подтверждаем получение запроса и устанавливаем флаг
				await ctx.answerCbQuery('Обрабатываем запрос...')
				callbackAnswered = true

				const data = ctx.callbackQuery.data

				// Обрабатываем запрос с кнопками бана
				if (data.startsWith('ban_user:')) {
					await handleBanButton(ctx)
					return
				}

				if (data.startsWith('confirm_ban:')) {
					await handleConfirmBan(ctx)
					return
				}

				if (data.startsWith('cancel_ban:')) {
					await handleCancelBan(ctx)
					return
				}

				// Обрабатываем запрос с кнопками принятия
				if (data.startsWith('accept_user:')) {
					await handleAcceptButton(ctx)
					return
				}

				if (data.startsWith('confirm_accept:')) {
					await handleConfirmAccept(ctx)
					return
				}

				if (data.startsWith('cancel_accept:')) {
					await handleCancelAccept(ctx)
					return
				}

				// Обрабатываем запрос с кнопками заявок
				await handleJoinRequestCallback(botInstance, ctx)
			} catch (error) {
				console.error('❌ Ошибка обработки callback запроса:', error)

				try {
					// Отправляем уведомление об ошибке администраторам
					await sendTelegramMessage(
						botInstance,
						ADMIN_CHAT_ID,
						`⚠️ <b>Ошибка при обработке callback</b>:\n<code>${ctx.callbackQuery.data}</code>\n\n${error.message}`,
						{ message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
					)

					// Уведомляем пользователя только если мы еще не ответили на callback
					if (!callbackAnswered && !isCallbackQueryExpired(error)) {
						await ctx
							.answerCbQuery(
								'Произошла ошибка: ' + error.message.substring(0, 200)
							)
							.catch(e => {
								// Игнорируем ошибки при ответе на устаревший callback
								if (!isCallbackQueryExpired(e)) {
									console.error(
										'❌ Ошибка при ответе на callback после ошибки:',
										e
									)
								}
							})
					}
				} catch (notifyError) {
					console.error(
						'❌ Ошибка при отправке уведомления об ошибке:',
						notifyError
					)
				}
			}
		})
		console.log('✅ Обработчик callback запросов настроен')
	} catch (error) {
		console.error(
			'❌ Ошибка при настройке обработчика callback запросов:',
			error
		)
		throw error
	}
}

/**
 * Настраивает обработчики медиа-сообщений
 * @param {Telegraf} botInstance - Экземпляр бота
 */
function setupMediaHandlers(botInstance) {
	try {
		botInstance.on(['photo', 'video'], async ctx => {
			try {
				// Обработка сообщений с хэштегом #media/#медиа
				if (ctx.message.caption && hasMediaHashtag(ctx.message.caption)) {
					if (ctx.message.media_group_id) {
						try {
							const messages = await ctx.telegram
								.getUpdates({
									allowed_updates: ['message'],
									limit: 50,
								})
								.then(res =>
									res
										.map(update => update.message)
										.filter(
											message =>
												message &&
												message.media_group_id === ctx.message.media_group_id
										)
								)
							await handleMediaGroup(botInstance, ctx, messages)
						} catch (error) {
							console.error('❌ Ошибка при получении медиа-группы:', error)

							// Отправляем уведомление об ошибке администраторам
							await sendTelegramMessage(
								botInstance,
								ADMIN_CHAT_ID,
								`⚠️ <b>Ошибка при получении медиа-группы</b>:\n${error.message}`,
								{ message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
							)
						}
					} else {
						await handleSingleMessage(botInstance, ctx)
					}
				}

				// Обработка личных сообщений с фото
				if (ctx.message.chat.type === 'private') {
					await handlePrivateMessage(botInstance, ctx)
				}
			} catch (error) {
				console.error('❌ Ошибка при обработке медиа-сообщения:', error)

				// Отправляем уведомление об ошибке администраторам
				await sendTelegramMessage(
					botInstance,
					ADMIN_CHAT_ID,
					`⚠️ <b>Ошибка при обработке медиа-сообщения</b>:\n${error.message}`,
					{ message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
				)
			}
		})
		console.log('✅ Обработчики медиа-сообщений настроены')
	} catch (error) {
		console.error(
			'❌ Ошибка при настройке обработчиков медиа-сообщений:',
			error
		)
		throw error
	}
}

/**
 * Настраивает специальный обработчик для пересланных сообщений (форвардов)
 * @param {Telegraf} botInstance - Экземпляр бота
 */
function setupForwardedMessageHandler(botInstance) {
	try {
		// Создаем специальный обработчик для пересланных сообщений
		botInstance.use(async (ctx, next) => {
			// Проверяем, что это сообщение и оно переслано
			if (ctx.message) {
				const message = ctx.message
				const hasForwardOrigin = !!message.forward_origin
				const hasForwardFrom = !!message.forward_from
				const hasForwardFromChat = !!message.forward_from_chat
				const hasForwardDate = !!message.forward_date
				const hasAnyForward =
					hasForwardOrigin ||
					hasForwardFrom ||
					hasForwardFromChat ||
					hasForwardDate

				if (hasAnyForward) {
					console.log(
						'🔁 ОБНАРУЖЕНО ПЕРЕСЛАННОЕ СООБЩЕНИЕ В СПЕЦИАЛЬНОМ ОБРАБОТЧИКЕ'
					)
					console.log('💬 Поля сообщения:', Object.keys(message))
					console.log('💬 Тип чата:', message.chat.type)
					console.log('💬 ID чата:', message.chat.id)

					// Проверяем наличие разных типов пересылки
					if (hasForwardOrigin) {
						console.log(
							'📩 forward_origin присутствует:',
							JSON.stringify(message.forward_origin, null, 2)
						)
					}
					if (hasForwardFrom) {
						console.log(
							'📩 forward_from присутствует:',
							JSON.stringify(message.forward_from, null, 2)
						)
					}
					if (hasForwardFromChat) {
						console.log(
							'📩 forward_from_chat присутствует:',
							JSON.stringify(message.forward_from_chat, null, 2)
						)
					}

					// Проверяем, что сообщение из целевого чата
					if (message.chat.id === MONO_PITER_CHAT_ID) {
						console.log(
							'✅ Пересланное сообщение из целевого чата, анализируем на рекламу'
						)

						// Отправляем на анализ рекламы
						try {
							await handleMessageForAds(botInstance, ctx)
						} catch (adError) {
							console.error(
								'❌ Ошибка при анализе пересланного сообщения на рекламу:',
								adError
							)
						}
					}
				}
			}

			// Продолжаем цепочку обработчиков
			return next()
		})

		console.log('✅ Специальный обработчик пересланных сообщений настроен')
	} catch (error) {
		console.error(
			'❌ Ошибка при настройке обработчика пересланных сообщений:',
			error
		)
	}
}

/**
 * Настраивает обработчик всех текстовых сообщений
 * @param {Telegraf} botInstance - Экземпляр бота
 */
function setupMessageHandler(botInstance) {
	try {
		botInstance.on('message', async ctx => {
			try {
				// Базовая проверка на пересланные сообщения
				const hasForwardOrigin = !!ctx.message.forward_origin
				const hasForwardFrom = !!ctx.message.forward_from
				const hasForwardFromChat = !!ctx.message.forward_from_chat
				const hasForwardDate = !!ctx.message.forward_date
				const hasAnyForward =
					hasForwardOrigin ||
					hasForwardFrom ||
					hasForwardFromChat ||
					hasForwardDate

				if (hasAnyForward) {
					console.log(
						'🔁 ОБНАРУЖЕНО ПЕРЕСЛАННОЕ СООБЩЕНИЕ В ОСНОВНОМ ОБРАБОТЧИКЕ'
					)
					console.log('💬 Поля сообщения:', Object.keys(ctx.message))
					console.log('💬 Тип чата:', ctx.message.chat.type)
					console.log('💬 ID чата:', ctx.message.chat.id)

					if (hasForwardOrigin) {
						console.log('📩 forward_origin присутствует')
					}
					if (hasForwardFrom) {
						console.log('📩 forward_from присутствует')
					}
					if (hasForwardFromChat) {
						console.log('📩 forward_from_chat присутствует')
					}
					if (hasForwardDate) {
						console.log('📩 forward_date присутствует')
					}
				}

				// Сохраняем сообщение
				storeMessage(ctx.message)

				// Проверяем, является ли сообщение личным
				if (ctx.message.chat.type === 'private') {
					const messagePreview = ctx.message.text
						? ctx.message.text.substring(0, 50) +
						  (ctx.message.text.length > 50 ? '...' : '')
						: '[не текстовое сообщение]'

					console.log('📩 Получено личное сообщение:', messagePreview)

					// Сначала пробуем обработать как ответ на вопрос администратора
					const isUserReply = await handleUserReply(botInstance, ctx)

					// Если это не ответ на вопрос администратора, обрабатываем как обычное личное сообщение
					if (!isUserReply) {
						const isHandled = await handlePrivateMessage(botInstance, ctx)
						if (isHandled) return // Если сообщение обработано, прекращаем выполнение
					}

					return // Прекращаем обработку для личных сообщений
				}

				// Для сообщений не из личного чата проверяем только необходимые условия
				if (ctx.message.reply_to_message) {
					const isHandled = await sendAdminQuestion(botInstance, ctx)
					if (isHandled) return
				}

				// Проверка на запрещенные слова
				const hasForbiddenWords = await checkForbiddenWords(botInstance, ctx)
				if (hasForbiddenWords) return

				// Анализ сообщения на наличие рекламы
				await handleMessageForAds(botInstance, ctx)

				// Обработка хэштегов медиа в ответах на сообщения
				await handleHashtagMedia(botInstance, ctx)
			} catch (error) {
				console.error('❌ Ошибка при обработке сообщения:', error)

				// Отправляем уведомление об ошибке администраторам, если это серьезная ошибка
				if (!isUserAccessError(error)) {
					await sendTelegramMessage(
						botInstance,
						ADMIN_CHAT_ID,
						`⚠️ <b>Ошибка при обработке сообщения</b>:\n${error.message}`,
						{ message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
					)
				}
			}
		})
		console.log('✅ Обработчик сообщений настроен')
	} catch (error) {
		console.error('❌ Ошибка при настройке обработчика сообщений:', error)
		throw error
	}
}

/**
 * Настраивает обработку ошибок бота
 * @param {Telegraf} botInstance - Экземпляр бота
 */
function setupErrorHandler(botInstance) {
	botInstance.catch(async (err, ctx) => {
		console.error(`❌ Ошибка бота: ${err.message}`)
		console.error('Стек ошибки:', err.stack)

		try {
			// Собираем контекст ошибки
			let errorContext = 'Глобальная ошибка обработки обновления'
			let userId = null

			if (ctx) {
				errorContext += ` (тип: ${ctx.updateType || 'неизвестный'})`
				userId = ctx.from?.id
			}

			// Отправляем подробную информацию об ошибке администраторам
			await logError(botInstance, err, errorContext, {
				userId,
				functionName: 'Telegraf global error handler',
			})
		} catch (notifyError) {
			console.error(
				'❌ Ошибка при отправке уведомления об ошибке:',
				notifyError
			)
		}
	})

	// Обработка необработанных исключений
	process.on('uncaughtException', async error => {
		try {
			await logError(botInstance, error, 'Необработанное исключение', {
				functionName: 'process.uncaughtException',
			})
		} catch (e) {
			console.error('❌ Ошибка при логировании необработанного исключения:', e)
		}

		// В продакшене можно закомментировать эту строку,
		// чтобы бот не перезапускался при каждой ошибке
		// process.exit(1);
	})

	// Обработка необработанных отказов промисов
	process.on('unhandledRejection', async (reason, promise) => {
		try {
			const error = reason instanceof Error ? reason : new Error(String(reason))
			await logError(botInstance, error, 'Необработанный отказ промиса', {
				functionName: 'process.unhandledRejection',
			})
		} catch (e) {
			console.error(
				'❌ Ошибка при логировании необработанного отказа промиса:',
				e
			)
		}
	})

	console.log('✅ Обработчик ошибок бота настроен')
}

/**
 * Настраивает обработку необработанных исключений и отказов промисов
 */
function setupProcessErrorHandlers() {
	// Обработка необработанных исключений
	process.on('uncaughtException', async error => {
		console.error('❌ Непойманное исключение:', error)

		// Отправляем сообщение администраторам о критической ошибке
		try {
			if (bot) {
				await bot.telegram
					.sendMessage(
						ADMIN_CHAT_ID,
						`⚠️ <b>КРИТИЧЕСКАЯ ОШИБКА БОТА</b>\n\n<pre>${
							error.stack || error.message
						}</pre>`,
						{ message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
					)
					.catch(e =>
						console.error('❌ Не удалось отправить уведомление об ошибке:', e)
					)
			}
		} catch (e) {
			console.error('❌ Ошибка при отправке уведомления об ошибке:', e)
		}

		// В продакшене можно закомментировать следующую строку,
		// чтобы бот не перезапускался при каждой ошибке
		// process.exit(1);
	})

	// Обработка необработанных отказов промисов
	process.on('unhandledRejection', async (reason, promise) => {
		console.error('❌ Непойманный отказ промиса:', reason)

		// Отправляем сообщение администраторам о необработанном отказе промиса
		try {
			if (bot) {
				await bot.telegram
					.sendMessage(
						ADMIN_CHAT_ID,
						`⚠️ <b>Необработанный отказ промиса</b>\n\n<pre>${
							reason.stack || String(reason)
						}</pre>`,
						{ message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
					)
					.catch(e =>
						console.error('❌ Не удалось отправить уведомление об ошибке:', e)
					)
			}
		} catch (e) {
			console.error('❌ Ошибка при отправке уведомления об ошибке:', e)
		}
	})

	// Обработка сигналов завершения
	process.on('SIGINT', async () => {
		console.log('🛑 Получен сигнал SIGINT. Завершение работы...')
		await safeShutdown('SIGINT')
	})

	process.on('SIGTERM', async () => {
		console.log('🛑 Получен сигнал SIGTERM. Завершение работы...')
		await safeShutdown('SIGTERM')
	})

	console.log('✅ Обработчики ошибок процесса настроены')
}

/**
 * Безопасное завершение работы бота
 * @async
 * @param {string} signal - Сигнал завершения
 */
async function safeShutdown(signal) {
	console.log(`\n${signal} получен. Завершаем работу...`)

	try {
		// Останавливаем таймер проверки заявок
		stopRequestCheckTimer()

		// Останавливаем бота
		if (bot) {
			await bot.stop(signal)
			console.log('🤖 Бот остановлен')
		}

		// Закрываем соединение с БД
		await closeDatabase()
		console.log('📦 Соединение с БД закрыто')

		process.exit(0)
	} catch (error) {
		console.error('❌ Ошибка при завершении работы:', error)
		process.exit(1)
	}
}

// Функция для автоматической отправки сводки
async function sendDailySummary(bot, isEveningReport = false) {
	try {
		// Получаем ID чата для мониторинга из константы MONO_PITER_CHAT_ID
		const messages = await getLastHoursMessages(MONO_PITER_CHAT_ID, 12)
		if (messages.length === 0) return

		// Генерируем сводку с указанием времени отчета
		const summary = await generateChatSummary(messages, isEveningReport)

		// Формируем заголовок в зависимости от времени отчета
		const title = isEveningReport
			? `📊 <b>Вечерняя сводка чата (20:00)</b>\n\n`
			: `📊 <b>Утренняя сводка чата (8:00)</b>\n\n`

		// Отправляем сводку
		await sendTelegramMessage(bot, ADMIN_CHAT_ID, title + summary, {
			message_thread_id: LAMP_THREAD_ID,
			parse_mode: 'HTML',
		})
	} catch (error) {
		console.error('❌ Ошибка при отправке сводки чата:', error)
	}
}

// Настройка таймера для отправки сводки два раза в день (8:00 и 20:00)
function setupDailySummaryTimer(bot) {
	// Получаем текущую дату и время
	const now = new Date()

	// Создаем даты для следующих 8:00 и 20:00
	const nextMorningReport = new Date(now)
	nextMorningReport.setHours(8, 0, 0, 0)

	const nextEveningReport = new Date(now)
	nextEveningReport.setHours(20, 0, 0, 0)

	// Если текущее время уже после 8:00, переносим на следующий день
	if (now >= nextMorningReport) {
		nextMorningReport.setDate(nextMorningReport.getDate() + 1)
	}

	// Если текущее время уже после 20:00, переносим на следующий день
	if (now >= nextEveningReport) {
		nextEveningReport.setDate(nextEveningReport.getDate() + 1)
	}

	// Рассчитываем время до следующего отчета
	const timeUntilMorningReport = nextMorningReport - now
	const timeUntilEveningReport = nextEveningReport - now

	// Устанавливаем таймеры для утреннего отчета (8:00)
	setTimeout(() => {
		sendDailySummary(bot, false) // Утренний отчет
		// Устанавливаем повторение каждые 24 часа
		setInterval(() => sendDailySummary(bot, false), 24 * 60 * 60 * 1000)
	}, timeUntilMorningReport)

	// Устанавливаем таймеры для вечернего отчета (20:00)
	setTimeout(() => {
		sendDailySummary(bot, true) // Вечерний отчет
		// Устанавливаем повторение каждые 24 часа
		setInterval(() => sendDailySummary(bot, true), 24 * 60 * 60 * 1000)
	}, timeUntilEveningReport)

	console.log('✅ Таймеры сводок настроены: 8:00 и 20:00 ежедневно')
}

/**
 * Запускает бота
 * @async
 */
async function startBot() {
	try {
		console.log('🚀 Запуск бота...')

		// Инициализируем бота
		bot = initBot()

		// Подключаемся к БД (общая для всего приложения)
		const database = await connectToDatabase()
		console.log('✅ Подключение к базе данных установлено')

		// Передаем экземпляр БД для инициализации модуля requestCheckHandler
		// Не создаём отдельное подключение, т.к. MongoDB использует пулы соединений
		// и модуль requestCheckHandler будет использовать то же самое соединение

		// Настраиваем обработчики
		setupCommandHandlers(bot)
		setupUserEventHandlers(bot)
		setupCallbackQueryHandler(bot)
		setupForwardedMessageHandler(bot)
		setupMediaHandlers(bot)
		setupMessageHandler(bot)
		setupErrorHandler(bot)
		setupProcessErrorHandlers()

		// Запускаем таймер проверки заявок
		startRequestCheckTimer(bot)

		// Настраиваем таймер ежедневной сводки
		setupDailySummaryTimer(bot)

		// Запускаем бота
		await bot.launch()
		console.log('🚀 Бот запущен')

		// Настраиваем обработчики завершения
		process.once('SIGINT', () => safeShutdown('SIGINT'))
		process.once('SIGTERM', () => safeShutdown('SIGTERM'))
	} catch (error) {
		console.error('❌ Ошибка при запуске бота:', error)
		process.exit(1)
	}
}

// Запускаем бота
startBot()
