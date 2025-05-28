/**
 * Модуль для анализа и обнаружения спам-аккаунтов
 * @module spamDetection
 */

// Типичные спам-слова для проверки имени
const spamKeywords = [
  'casino', 'bet', 'crypto', 'invest', 'earn', 'money', 'profit', 
  'казино', 'ставки', 'крипто', 'заработок', 'деньги', 'инвестиции',
  'vip', 'bonus', 'promo', 'free', 'sale', 'discount', 'offer',
  'бонус', 'промо', 'бесплатно', 'акция', 'скидка', 'предложение'
];

// Типичные имена ботов
const botNamePatterns = [
  /^[a-z]+_?bot$/i,
  /^bot_?[a-z]+$/i,
  /^[a-z]+_?robot$/i,
  /^robot_?[a-z]+$/i,
  /^[a-z]+_?ai$/i,
  /^ai_?[a-z]+$/i
];

// Обычные имена для исключения из проверки "красивых" имен пользователей
const commonNames = [
  'alex', 'john', 'mike', 'anna', 'maria', 'ivan', 'pavel', 'sergey', 'olga', 'elena',
  'andrey', 'dmitry', 'max', 'maxim', 'vladimir', 'natalia', 'kate', 'peter', 'roman', 'igor'
];

// Кэш для хранения результатов анализа пользователей
// Ключ - ID пользователя, значение - объект с результатами анализа и временем кэширования
const analysisCache = new Map();

// Время жизни кэша в миллисекундах (1 час)
const CACHE_TTL = 60 * 60 * 1000;

/**
 * Оценивает вероятность того, что пользователь является спам-аккаунтом
 * @param {Object} user - Объект пользователя Telegram
 * @param {number} user.id - ID пользователя
 * @param {string} user.first_name - Имя пользователя
 * @param {string} [user.last_name] - Фамилия пользователя
 * @param {string} [user.username] - Имя пользователя
 * @param {string} [user.language_code] - Код языка пользователя
 * @returns {Object} Результат анализа с оценкой и объяснениями
 */
function analyzeUserForSpam(user) {
  // Результат анализа
  const result = {
    isLikelySpam: false,
    spamProbability: 0, // 0-100
    suspiciousFactors: [],
    safeFactors: [],
    explanation: '',
  };

  // Проверка ID (новые аккаунты 2024-2025 года)
  if (user.id > 7000000000) {
    result.suspiciousFactors.push('Новый аккаунт (2024-2025 года)');
    result.spamProbability += 20;
  } else {
    result.safeFactors.push('Аккаунт создан до 2024 года');
    result.spamProbability -= 10;
  }

  // Проверка имени пользователя
  if (user.username) {
    // Проверка на случайные буквы и цифры в имени пользователя
    const randomUsernamePattern = /^[a-z0-9_]{8,}$/i;
    const containsRandomChars = randomUsernamePattern.test(user.username) && 
                               !/^[a-z]+$/i.test(user.username);
    
    if (containsRandomChars) {
      result.suspiciousFactors.push('Имя пользователя содержит случайные символы и цифры');
      result.spamProbability += 15;
    }
    
    // Проверка на наличие "bot" в имени пользователя
    if (user.username.toLowerCase().includes('bot')) {
      result.suspiciousFactors.push('Имя пользователя содержит слово "bot"');
      result.spamProbability += 25;
    }
    
    // Проверка на типичные имена ботов
    const isBotName = botNamePatterns.some(pattern => pattern.test(user.username));
    if (isBotName) {
      result.suspiciousFactors.push('Имя пользователя типично для бота');
      result.spamProbability += 25;
    }
    
    // Проверка на шаблонные имена пользователей с цифрами в конце
    const usernameWithDigitsPattern = /^[a-z]+\d{4,}$/i;
    if (usernameWithDigitsPattern.test(user.username)) {
      result.suspiciousFactors.push('Шаблонное имя пользователя с цифрами в конце');
      result.spamProbability += 15;
    }
    
    // Проверка на слишком длинное имя пользователя
    if (user.username.length > 20) {
      result.suspiciousFactors.push('Слишком длинное имя пользователя');
      result.spamProbability += 10;
    }
    
    // Проверка на слишком "красивые" имена пользователей
    const prettyUsernamePattern = /^[a-z]{5,10}$/i; // Только буквы, 5-10 символов
    if (prettyUsernamePattern.test(user.username) && !commonNames.includes(user.username.toLowerCase())) {
      result.suspiciousFactors.push('Подозрительно "красивое" имя пользователя');
      result.spamProbability += 10;
    }
  } else {
    result.suspiciousFactors.push('Отсутствует имя пользователя');
    result.spamProbability += 10;
  }

  // Проверка языка пользователя
  if (user.language_code) {
    if (user.language_code !== 'ru') {
      result.suspiciousFactors.push(`Язык пользователя: ${user.language_code} (не русский)`);
      result.spamProbability += 15;
    } else {
      result.safeFactors.push('Язык пользователя: русский');
      result.spamProbability -= 5;
    }
  } else {
    result.suspiciousFactors.push('Язык пользователя не указан');
    result.spamProbability += 5;
  }

  // Проверка имени и фамилии
  if (user.first_name) {
    // Проверка на наличие эмодзи в имени
    const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    if (emojiPattern.test(user.first_name) || (user.last_name && emojiPattern.test(user.last_name))) {
      result.suspiciousFactors.push('Имя или фамилия содержит эмодзи');
      result.spamProbability += 20;
    }
    
    // Проверка на очень короткое имя
    if (user.first_name.length < 3 && (!user.last_name || user.last_name.length < 3)) {
      result.suspiciousFactors.push('Очень короткое имя');
      result.spamProbability += 10;
    }
    
    // Проверка на наличие ссылок в имени
    const linkPattern = /(https?:\/\/|t\.me\/|@|tg:\/\/|telegram\.me)/i;
    if (linkPattern.test(user.first_name) || (user.last_name && linkPattern.test(user.last_name))) {
      result.suspiciousFactors.push('Имя или фамилия содержит ссылку или упоминание');
      result.spamProbability += 30;
    }
    
    // Проверка на наличие телефонных номеров
    const phonePattern = /\+?\d{10,15}/;
    if (phonePattern.test(user.first_name) || (user.last_name && phonePattern.test(user.last_name))) {
      result.suspiciousFactors.push('Имя или фамилия содержит телефонный номер');
      result.spamProbability += 25;
    }
    
    // Проверка на избыточные символы
    const excessiveSymbolsPattern = /(.)\1{3,}/;
    if (excessiveSymbolsPattern.test(user.first_name) || 
        (user.last_name && excessiveSymbolsPattern.test(user.last_name))) {
      result.suspiciousFactors.push('Избыточное повторение символов в имени');
      result.spamProbability += 15;
    }
    
    // Проверка на типичные спам-слова в имени
    const containsSpamKeywords = spamKeywords.some(keyword => 
      user.first_name.toLowerCase().includes(keyword) || 
      (user.last_name && user.last_name.toLowerCase().includes(keyword)) ||
      (user.username && user.username.toLowerCase().includes(keyword))
    );
    
    if (containsSpamKeywords) {
      result.suspiciousFactors.push('Имя содержит типичные спам-слова');
      result.spamProbability += 25;
    }
    
    // Проверка на использование редких символов
    const rareSymbolsPattern = /[\u2600-\u26FF\u2700-\u27BF\u2B00-\u2BFF\u2000-\u206F]/;
    if (rareSymbolsPattern.test(user.first_name) || 
        (user.last_name && rareSymbolsPattern.test(user.last_name))) {
      result.suspiciousFactors.push('Использование редких символов в имени');
      result.spamProbability += 15;
    }
  }

  // Проверка на несоответствие языка и имени (только для необычных случаев)
  const cyrillicPattern = /[\u0400-\u04FF]/; // Кириллические символы
  const latinPattern = /[a-zA-Z]/;
  
  const hasCyrillic = cyrillicPattern.test(user.first_name) || 
                     (user.last_name && cyrillicPattern.test(user.last_name));
  const hasLatin = latinPattern.test(user.first_name) || 
                  (user.last_name && latinPattern.test(user.last_name));
  
  // Русские пользователи могут иметь имена на латинице, это нормально
  // Проверяем только нерусские языки с кириллическими именами
  // И только для некоторых языков, где это действительно необычно
  const nonCyrillicLanguages = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ar', 'hi', 'tr'];
  if (user.language_code && nonCyrillicLanguages.includes(user.language_code) && hasCyrillic && !hasLatin) {
    result.suspiciousFactors.push(`Необычное сочетание языка (${user.language_code}) и имени на кириллице`);
    result.spamProbability += 15;
  }
  
  // Проверка времени подачи заявки (спам-боты часто работают ночью)
  const currentHour = new Date().getHours();
  if (currentHour >= 1 && currentHour <= 5) { // Ночное время
    result.suspiciousFactors.push('Заявка подана в подозрительное время (глубокая ночь)');
    result.spamProbability += 10;
  }
  
  // Проверка на наличие фото профиля (невозможно определить через API)
  // Можно добавить в будущем, если будет доступ к этой информации

  // Определение итогового результата
  if (result.spamProbability >= 50) {
    result.isLikelySpam = true;
    result.explanation = 'Высокая вероятность спам-аккаунта';
  } else if (result.spamProbability >= 30) {
    result.explanation = 'Средняя вероятность спам-аккаунта, требуется проверка';
  } else {
    result.explanation = 'Низкая вероятность спам-аккаунта';
  }

  return result;
}

/**
 * Форматирует результат анализа в читаемый текст
 * @param {Object} analysisResult - Результат анализа
 * @param {Object} user - Объект пользователя
 * @returns {string} Форматированный текст анализа
 */
function formatSpamAnalysisResult(analysisResult, user) {
  const { isLikelySpam, spamProbability, suspiciousFactors, safeFactors, explanation } = analysisResult;
  
  // Определяем эмодзи для статуса
  let statusEmoji = '✅';
  if (isLikelySpam) {
    statusEmoji = '🚨';
  } else if (spamProbability >= 30) {
    statusEmoji = '⚠️';
  }
  
  // Форматируем результат без дублирования избыточной информации о пользователе
  // Добавляем имя пользователя в заголовок
  const userName = user.first_name + (user.last_name ? ` ${user.last_name}` : '');
  let result = `<b>${statusEmoji} Анализ аккаунта ${userName} на спам</b>\n\n`;
  result += `<b>Вероятность спама:</b> ${spamProbability}%\n`;
  result += `<b>Заключение:</b> ${explanation}\n\n`;
  
  if (suspiciousFactors.length > 0) {
    result += '<b>🔍 Подозрительные факторы:</b>\n';
    suspiciousFactors.forEach(factor => {
      result += `• ${factor}\n`;
    });
    result += '\n';
  }
  
  if (safeFactors.length > 0) {
    result += '<b>🛡️ Безопасные факторы:</b>\n';
    safeFactors.forEach(factor => {
      result += `• ${factor}\n`;
    });
  }
  
  return result;
}

/**
 * Получает результаты анализа пользователя на предмет спам-аккаунта с использованием кэша
 * @param {Object} user - Объект пользователя Telegram
 * @param {boolean} [forceRefresh=false] - Принудительно обновить анализ, игнорируя кэш
 * @returns {Object} Результат анализа
 */
function getCachedSpamAnalysis(user, forceRefresh = false) {
  // Проверяем наличие пользователя и ID
  if (!user || !user.id) {
    console.error('Ошибка: неверный объект пользователя');
    return analyzeUserForSpam(user); // Возвращаем результат без кэширования
  }
  
  const userId = user.id;
  const now = Date.now();
  const cachedResult = analysisCache.get(userId);
  
  // Если есть в кэше и не истек срок действия, и не требуется принудительное обновление
  if (cachedResult && (now - cachedResult.timestamp < CACHE_TTL) && !forceRefresh) {
    console.log(`Используем кэшированный результат анализа для пользователя ${userId}`);
    return cachedResult.result;
  }
  
  // Если нет в кэше или истек срок действия, или требуется принудительное обновление
  console.log(`Анализируем пользователя ${userId} и сохраняем в кэш`);
  const result = analyzeUserForSpam(user);
  
  // Сохраняем результат в кэш
  analysisCache.set(userId, {
    result,
    timestamp: now
  });
  
  return result;
}

/**
 * Очищает устаревшие записи в кэше
 */
function cleanupCache() {
  const now = Date.now();
  let expiredCount = 0;
  
  for (const [userId, data] of analysisCache.entries()) {
    if (now - data.timestamp > CACHE_TTL) {
      analysisCache.delete(userId);
      expiredCount++;
    }
  }
  
  if (expiredCount > 0) {
    console.log(`Очищено ${expiredCount} устаревших записей из кэша анализа спам-аккаунтов`);
  }
}

// Запускаем периодическую очистку кэша (каждый час)
setInterval(cleanupCache, CACHE_TTL);

module.exports = {
  analyzeUserForSpam,
  formatSpamAnalysisResult,
  getCachedSpamAnalysis
};
