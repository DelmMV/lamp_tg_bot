/**
 * Вспомогательные функции
 * @module helpers
 */

const { KAOMOJIS } = require('../config');

/**
 * Определяет примерный год регистрации пользователя по ID
 * @param {number} userId - ID пользователя Telegram
 * @returns {string} - Примерный период регистрации
 */
function determineRegistrationYear(userId) {
  if (userId >= 1 && userId <= 100000000) {
    return '2013-2014';
  } else if (userId > 100000000 && userId <= 200000000) {
    return '2015-2016';
  } else if (userId > 200000000 && userId <= 300000000) {
    return '2017-2018';
  } else if (userId > 300000000 && userId <= 400000000) {
    return '2019-2020';
  } else if (userId > 400000000 && userId <= 2147483647) {
    return '2021 (до сентября)';
  } else if (userId > 2147483647 && userId <= 5000000000) {
    return '2021 (после сентября) - 2022';
  } else if (userId > 5000000000 && userId <= 7000000000) {
    return '2023';
  } else if (userId > 7000000000 && userId <= 8143370828) {
    return '2024';
  } else if (userId > 8143370828 && userId <= 9500000000) {
    return '2025 (прогноз)';
  } else {
    return 'Неизвестный период';
  }
}

/**
 * Возвращает случайный каомоджи из списка
 * @returns {string} - Случайный каомоджи
 */
const getRandomKaomoji = () => KAOMOJIS[Math.floor(Math.random() * KAOMOJIS.length)];

/**
 * Проверяет наличие медиа-хэштега в тексте
 * @param {string} text - Текст для проверки
 * @returns {boolean} - Результат проверки
 */
const hasMediaHashtag = (text) => text && (text.includes('#media') || text.includes('#медиа'));

module.exports = {
  determineRegistrationYear,
  getRandomKaomoji,
  hasMediaHashtag
};