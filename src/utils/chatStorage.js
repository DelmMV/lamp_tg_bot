const { MongoClient, ObjectId } = require('mongodb')
const { connectToDatabase } = require('../db')

// Имя коллекции для хранения сообщений
const MESSAGES_COLLECTION = 'chat_messages'

// Получение подключения к базе данных
async function getDb() {
	try {
		const db = await connectToDatabase()
		return db
	} catch (error) {
		console.error('❌ Ошибка подключения к БД:', error)
		throw error
	}
}

/**
 * Сохраняет сообщение в базе данных
 * @param {Object} message - Объект сообщения
 * @returns {Promise<void>}
 */
async function storeMessage(message) {
	try {
		// Очищаем большие объекты от сообщения для сохранения
		const cleanMessage = JSON.parse(
			JSON.stringify(message, (key, value) => {
				// Пропускаем большие вложенные объекты, которые не нужны для анализа
				if (key === 'bot' || key === 'telegram' || key === 'update') {
					return undefined
				}
				return value
			})
		)

		// Добавляем временную метку и дату
		const messageWithTimestamp = {
			...cleanMessage,
			timestamp: Date.now(),
			date: new Date(),
		}

		const db = await getDb()
		await db.collection(MESSAGES_COLLECTION).insertOne(messageWithTimestamp)

		// Запускаем очистку старых сообщений
		await cleanupOldMessages()
	} catch (error) {
		console.error('❌ Ошибка при сохранении сообщения в БД:', error)
		// В случае ошибки продолжаем работу, но логируем проблему
	}
}

/**
 * Очищает сообщения старше 30 дней
 * @returns {Promise<void>}
 */
async function cleanupOldMessages() {
	try {
		const thirtyDaysAgo = new Date()
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

		const db = await getDb()
		await db.collection(MESSAGES_COLLECTION).deleteMany({
			date: { $lt: thirtyDaysAgo },
		})
	} catch (error) {
		console.error('❌ Ошибка при очистке старых сообщений:', error)
	}
}

/**
 * Получает сообщения за последние 24 часа для указанного чата
 * @param {string} chatId - ID чата
 * @returns {Promise<Array>} Массив сообщений
 */
async function getLast24HoursMessages(chatId) {
	try {
		const twentyFourHoursAgo = new Date()
		twentyFourHoursAgo.setDate(twentyFourHoursAgo.getDate() - 1)

		const db = await getDb()
		const messages = await db
			.collection(MESSAGES_COLLECTION)
			.find({
				'chat.id': Number(chatId),
				date: { $gte: twentyFourHoursAgo },
			})
			.sort({ date: 1 })
			.toArray()

		return messages
	} catch (error) {
		console.error('❌ Ошибка при получении сообщений из БД:', error)
		return []
	}
}

/**
 * Получает сообщения за указанный период для выбранного чата
 * @param {string} chatId - ID чата
 * @param {Date} startDate - Начальная дата
 * @param {Date} endDate - Конечная дата
 * @returns {Promise<Array>} Массив сообщений
 */
async function getMessagesByDateRange(chatId, startDate, endDate) {
	try {
		const db = await getDb()
		const messages = await db
			.collection(MESSAGES_COLLECTION)
			.find({
				'chat.id': Number(chatId),
				date: {
					$gte: startDate,
					$lte: endDate,
				},
			})
			.sort({ date: 1 })
			.toArray()

		return messages
	} catch (error) {
		console.error('❌ Ошибка при получении сообщений по диапазону дат:', error)
		return []
	}
}

/**
 * Очищает все сообщения для указанного чата
 * @param {string} chatId - ID чата
 * @returns {Promise<void>}
 */
async function clearChatMessages(chatId) {
	try {
		const db = await getDb()
		await db.collection(MESSAGES_COLLECTION).deleteMany({
			'chat.id': Number(chatId),
		})
	} catch (error) {
		console.error('❌ Ошибка при очистке сообщений чата:', error)
	}
}

module.exports = {
	storeMessage,
	getLast24HoursMessages,
	getMessagesByDateRange,
	clearChatMessages,
}
