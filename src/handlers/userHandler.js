/**
 * Обработчики событий, связанных с пользователями
 * @module userHandler
 */
const { sendTelegramMessage } = require('../utils/messaging')
const { determineRegistrationYear } = require('../utils/helpers')
const {
	ADMIN_CHAT_ID,
	LAMP_THREAD_ID,
	MONO_PITER_CHAT_ID,
} = require('../config')
const { saveJoinRequest } = require('../db')
const {
	isUserAccessError,
	formatUserAccessError,
} = require('../utils/errorHandler')

/**
 * Обрабатывает новых участников чата
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 */
async function handleNewChatMembers(bot, ctx) {
	const { from, new_chat_member } = ctx.message

	// Проверяем, что сообщение из целевого чата
	if (ctx.message.chat.id !== MONO_PITER_CHAT_ID) return

	try {
		const isInvited = from.id !== new_chat_member.id

		// Формируем сообщение в зависимости от того, был ли пользователь приглашен
		const message = isInvited
			? `<a href="tg://user?id=${from.id}">${from.first_name} ${
					from.last_name || ''
			  }</a> принял в группу <a href="tg://user?id=${new_chat_member.id}">${
					new_chat_member.first_name
			  } ${new_chat_member.last_name || ''}</a>`
			: `<a href="tg://user?id=${from.id}">${from.first_name} ${
					from.last_name || ''
			  }</a> принят(а) в группу`

		console.log(
			`New user added: ${new_chat_member.first_name} ${
				new_chat_member.last_name || ''
			}`
		)

		// Отправляем уведомление администраторам
		await sendTelegramMessage(bot, ADMIN_CHAT_ID, message, {
			message_thread_id: LAMP_THREAD_ID,
			parse_mode: 'HTML',
		})

		// Отправляем приветственное сообщение новому участнику
		try {
			const welcomeMessage = createWelcomeMessage(new_chat_member.first_name)
			await sendTelegramMessage(bot, new_chat_member.id, welcomeMessage, {
				parse_mode: 'HTML',
			})
			console.log(
				`✅ Приветственное сообщение отправлено пользователю ${new_chat_member.id}`
			)
		} catch (messageError) {
			// Вот тут был пропущен блок catch для внутреннего try
			console.error(
				'❌ Не удалось отправить приветственное сообщение:',
				messageError
			)

			// Уведомляем администраторов только если ошибка связана с доступом к пользователю
			if (isUserAccessError(messageError)) {
				await sendTelegramMessage(
					bot,
					ADMIN_CHAT_ID,
					`Не удалось отправить приветственное сообщение пользователю ${
						new_chat_member.first_name
					} ${new_chat_member.last_name || ''}: ${formatUserAccessError(
						messageError,
						new_chat_member.id
					)}`,
					{ message_thread_id: LAMP_THREAD_ID }
				)
			}
		}
	} catch (error) {
		console.error('Error handling new chat member:', error)

		// В случае ошибки сообщаем админам
		if (
			error.description?.includes('blocked') ||
			error.description?.includes('initiate')
		) {
			await sendTelegramMessage(
				bot,
				ADMIN_CHAT_ID,
				`Произошла ошибка при обработке нового участника ${
					new_chat_member.first_name
				} ${new_chat_member.last_name || ''}: ${error.description}`,
				{ message_thread_id: LAMP_THREAD_ID }
			)
		}
	}
}

/**
 * Создает приветственное сообщение для нового участника
 * @param {string} firstName - Имя пользователя
 * @returns {string} Текст приветственного сообщения
 */
function createWelcomeMessage(firstName) {
	return `
<b>Добро пожаловать в сообщество МоноПитер, ${firstName}! 🎉</b>

Мы рады видеть тебя в нашем сообществе единомышленников!

<b>Полезная информация:</b>

📌 <b>Правила сообщества:</b> http://монопитер.рф/rules#text

📌 <b>Полезные ссылки:</b>
• <a href="https://t.me/eucriders/365884">Описание веток</a>
• <a href="https://t.me/mono_piter">Новости, анонсы сообщества</a>
• <a href="https://t.me/eucriders/365845/442187">База для всех новичков</a>


📌 <b>Полезные боты нашего сообщества:</b>
• @LampaServiceBot - бот с рейтингом и отзывами мастерских
• @LampStatsBot - бот показывает статистику поездок, строит рейтинги и предоставляет информацию о зарядных станциях и другие полезные фишки

Если у тебя возникнут вопросы, можешь задать их в общем(если вы новчичок, то с вопросами лучше в новичковую) чате или обратиться к администраторам.

С нетерпением ждем тебя на наших мероприятиях и покатушках!
  `.trim()
}

/**
 * Обрабатывает запросы на вступление в чат
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 */
async function handleChatJoinRequest(bot, ctx) {
	const { from } = ctx.chatJoinRequest

	// Проверяем, что запрос из целевого чата
	if (ctx.chatJoinRequest.chat.id !== MONO_PITER_CHAT_ID) return

	try {
		const userId = from.id
		const registrationPeriod = determineRegistrationYear(userId)

		// Формируем базовое сообщение для администраторов
		let adminMessage = `
 ${from.first_name} подал(а) заявку на вступление
 ID: <a href="tg://user?id=${from.id}">${from.id}</a>
 Логин: ${from.username ? `@${from.username}` : 'нету'}
 Имя: ${from.first_name} ${from.last_name || ''}
 Язык юзера: ${from.language_code}
 Регистрация: ~ ${registrationPeriod}
     `.trim()

		// Формируем сообщение для пользователя
		const userMessage = `
 Привет! Получили от тебя заявку на вступление в сообщество МоноПитер http://монопитер.рф/rules#text
 Такие заявки мы проверяем на ботов.
 Если уже есть моноколесо, то напиши в ответ, какое! Можешь приложить его фото ))
 Ещё без колеса? Тогда расскажи, что привело тебя к нам? В нашем сообществе всегда помогут с выбором, обучением и вопросами обслуживания.
 
 Не будет ответа на это сообщение в течение суток - придётся отклонить заявку.
 Но если что, после отклонения заявку можно подать повторно!
 
 В ожидании одобрения, предлагаю ознакомиться с правилами/ценностями нашего сообщества: https://t.me/eucriders/287907/403321
 Спасибо за понимание!
     `.trim()

		console.log(`New join request from: ${from.first_name}`)

		// Отправляем сообщение пользователю и проверяем результат
		let messageSent = null
		let userStatus = 'pending' // Статус по умолчанию

		try {
			messageSent = await sendTelegramMessage(bot, from.id, userMessage)

			// Если null, значит пользователь заблокировал бота
			if (messageSent === null) {
				console.log(
					`⚠️ Пользователь ${from.id} заблокировал бота - невозможно отправить инструкции`
				)

				// Добавляем предупреждение в сообщение для администраторов
				adminMessage += `\n\n⚠️ <b>ВНИМАНИЕ:</b> Пользователь заблокировал бота. Невозможно отправить инструкции!`
				userStatus = 'blocked_bot' // Специальный статус для заблокировавших бота
			} else {
				console.log(`✅ Сообщение успешно отправлено пользователю ${from.id}`)
			}
		} catch (messageError) {
			console.error(
				'❌ Ошибка при отправке сообщения пользователю:',
				messageError
			)

			// Если ошибка связана с доступом, добавляем информацию в сообщение для админов
			if (isUserAccessError(messageError)) {
				adminMessage += `\n\n⚠️ <b>ВНИМАНИЕ:</b> ${formatUserAccessError(
					messageError,
					from.id
				)}`
				userStatus = 'blocked_bot'
			}
		}

		// Создаем клавиатуру с кнопками "Задать вопрос" и "Бан"
		// Если пользователь заблокировал бота, добавляем информативный текст к кнопке
		const askQuestionText =
			userStatus === 'blocked_bot'
				? '❓ Задать вопрос (пользователь заблокировал бота)'
				: '❓ Задать вопрос'

		const keyboard = {
			inline_keyboard: [
				[
					{ text: askQuestionText, callback_data: `ask_${from.id}` },
					{ text: '❌ Бан', callback_data: `ban_user:${from.id}` },
				],
			],
		}

		// Отправляем сообщение админам с кнопкой вопроса
		let sentMsg
		try {
			sentMsg = await sendTelegramMessage(bot, ADMIN_CHAT_ID, adminMessage, {
				message_thread_id: LAMP_THREAD_ID,
				parse_mode: 'HTML',
				reply_markup: keyboard,
			})
		} catch (adminMsgError) {
			console.error(
				'❌ Не удалось отправить уведомление админам о запросе:',
				adminMsgError
			)
			return // Если не удалось уведомить админов, прекращаем обработку
		}

		// Сохраняем информацию о заявке в БД с правильным статусом
		try {
			await saveJoinRequest({
				userId: from.id,
				username: from.username,
				firstName: from.first_name,
				lastName: from.last_name,
				languageCode: from.language_code,
				registrationPeriod,
				messageId: sentMsg.message_id,
				status: userStatus, // Используем определенный выше статус
			})
		} catch (dbError) {
			console.error('❌ Ошибка при сохранении заявки в БД:', dbError)

			// Уведомляем админов об ошибке сохранения
			try {
				await sendTelegramMessage(
					bot,
					ADMIN_CHAT_ID,
					`⚠️ <b>Ошибка сохранения заявки в БД</b> для пользователя ${from.id}: ${dbError.message}`,
					{ message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
				)
			} catch (notifyError) {
				console.error(
					'❌ Не удалось отправить уведомление об ошибке БД:',
					notifyError
				)
			}
		}
	} catch (error) {
		console.error('❌ Общая ошибка при обработке запроса на вступление:', error)

		// Уведомляем админов о критической ошибке
		try {
			await sendTelegramMessage(
				bot,
				ADMIN_CHAT_ID,
				`🚨 <b>Критическая ошибка при обработке заявки</b> от пользователя ${from.id}:\n${error.message}`,
				{ message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
			)
		} catch (notifyError) {
			console.error(
				'❌ Не удалось отправить уведомление о критической ошибке:',
				notifyError
			)
		}
	}
}

module.exports = {
	handleNewChatMembers,
	handleChatJoinRequest,
}
