/**
 * Утилиты для работы с банами пользователей
 * @module userBan
 */

const { banUser, isUserBanned } = require('../db')

/**
 * Проверяет, забанен ли пользователь
 * @async
 * @param {string} userId - ID пользователя
 * @returns {Promise<boolean>} - Забанен ли пользователь
 */
async function checkUserBan(userId) {
	try {
		const banInfo = await isUserBanned(userId)
		return banInfo !== null
	} catch (error) {
		console.error('Error checking user ban:', error)
		return false
	}
}

/**
 * Банит пользователя
 * @async
 * @param {string} userId - ID пользователя
 * @param {string} adminId - ID администратора
 * @param {string} reason - Причина бана
 * @returns {Promise<boolean>} - Результат операции
 */
async function banUserWithReason(userId, adminId, reason) {
	try {
		return await banUser(userId, adminId, reason)
	} catch (error) {
		console.error('Error banning user:', error)
		return false
	}
}

module.exports = {
	checkUserBan,
	banUserWithReason,
}
