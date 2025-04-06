/**
 * Модуль для фильтрации контента на запрещенные слова
 * @module contentFilter
 */

const russianWordsBan = require("../words.json");
const { SIMILAR_CHARS } = require('../config');

// Список запрещенных слов
const bannedWords = russianWordsBan.russianWordsBan.map(entry => entry.word);

/**
 * Создает регулярное выражение для поиска слова с учетом похожих символов
 * @param {string} word - Слово для поиска
 * @returns {string} - Паттерн регулярного выражения
 */
function createRegexPattern(word) {
  return word.split('').map(char => {
    if (char in SIMILAR_CHARS) {
      return `[${char}${SIMILAR_CHARS[char]}]`;
    } else if (Object.values(SIMILAR_CHARS).includes(char)) {
      const cyrillicChar = Object.keys(SIMILAR_CHARS).find(key => SIMILAR_CHARS[key] === char);
      return `[${char}${cyrillicChar}]`;
    }
    return char;
  }).join('[.\\s]*');
}

/**
 * Проверяет наличие запрещенных слов в тексте
 * @param {string} text - Текст для проверки
 * @returns {{found: boolean, word?: string}} - Результат проверки
 */
function containsForbiddenWords(text) {
  if (typeof text !== 'string') {
    return { found: false };
  }
  
  const lowerCaseText = text.toLowerCase();
  
  for (const word of bannedWords) {
    const pattern = createRegexPattern(word);
    const regex = new RegExp(`(^|[^а-яёa-z])${pattern}($|[^а-яёa-z])`, 'i');
    
    if (regex.test(lowerCaseText)) {
      return { found: true, word: word };
    }
  }
  
  return { found: false };
}

module.exports = {
  containsForbiddenWords
};