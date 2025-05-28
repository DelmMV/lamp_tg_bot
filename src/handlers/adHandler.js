/**
 * Обработчик для анализа сообщений на наличие рекламы
 * @module adHandler
 */

const { analyzeMessageForAds, formatAdAnalysisResult } = require('../utils/adDetection')
const { sendTelegramMessage } = require('../utils/messaging')
const { logMessageStructure } = require('../utils/debugHelper')
const config = require('../config')

/**
 * Обрабатывает сообщение и анализирует его на наличие рекламы
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @returns {Promise<boolean>} - Результат обработки сообщения
 */
async function handleMessageForAds(bot, ctx) {
  console.log('🔍 Запуск обработчика анализа рекламы')
  
  // Проверяем, включен ли модуль анализа рекламы
  if (!config.MODULES.AD_DETECTION.ENABLED) {
    console.log('❌ Модуль анализа рекламы отключен в конфигурации')
    return false
  }

  try {
    // Получаем сообщение для анализа
    const message = ctx.message
    console.log(`📩 Получено сообщение для анализа рекламы, ID: ${message.message_id}`)
    
    // Детальный анализ структуры сообщения
    console.log('🔍 Детальный анализ структуры сообщения:')
    logMessageStructure(message)
    
    // Расширенная проверка на наличие пересланного сообщения
    const hasForwardOrigin = !!message.forward_origin;
    const hasForwardFrom = !!message.forward_from;
    const hasForwardFromChat = !!message.forward_from_chat;
    const hasForwardDate = !!message.forward_date;
    const hasForwardSenderName = !!message.forward_sender_name;
    const hasForwardSignature = !!message.forward_signature;
    const hasAnyForward = hasForwardOrigin || hasForwardFrom || hasForwardFromChat || 
                         hasForwardDate || hasForwardSenderName || hasForwardSignature;
    
    console.log('🔍 Проверка полей пересылки:', {
      hasForwardOrigin,
      hasForwardFrom,
      hasForwardFromChat,
      hasForwardDate,
      hasForwardSenderName,
      hasForwardSignature,
      hasAnyForward
    });
    
    if (hasAnyForward) {
      console.log('🔁 Обнаружено пересланное сообщение (форвард)!');
      
      // Детальный анализ структуры пересланного сообщения
      console.log('💬 Детали пересланного сообщения:');
      
      if (hasForwardOrigin) {
        console.log('📩 forward_origin:', JSON.stringify(message.forward_origin, null, 2));
        if (message.forward_origin.type) {
          console.log('📩 Тип источника:', message.forward_origin.type);
        }
        if (message.forward_origin.chat) {
          console.log('📩 Чат источника:', {
            id: message.forward_origin.chat.id,
            type: message.forward_origin.chat.type,
            title: message.forward_origin.chat.title,
            username: message.forward_origin.chat.username
          });
        }
        if (message.forward_origin.sender_user) {
          console.log('📩 Пользователь источника:', {
            id: message.forward_origin.sender_user.id,
            first_name: message.forward_origin.sender_user.first_name,
            last_name: message.forward_origin.sender_user.last_name,
            username: message.forward_origin.sender_user.username
          });
        }
        if (message.forward_origin.message_id) {
          console.log('📩 ID сообщения источника:', message.forward_origin.message_id);
        }
      }
      
      if (hasForwardFrom) {
        console.log('📩 forward_from:', {
          id: message.forward_from.id,
          first_name: message.forward_from.first_name,
          last_name: message.forward_from.last_name,
          username: message.forward_from.username
        });
      }
      
      if (hasForwardFromChat) {
        console.log('📩 forward_from_chat:', {
          id: message.forward_from_chat.id,
          type: message.forward_from_chat.type,
          title: message.forward_from_chat.title,
          username: message.forward_from_chat.username
        });
      }
      
      if (hasForwardDate) {
        console.log('📩 forward_date:', new Date(message.forward_date * 1000).toISOString());
      }
      
      // Выводим все ключи объекта ctx
      console.log('🔑 Ключи объекта ctx:', Object.keys(ctx));
      
      // Выводим все ключи объекта ctx.update
      if (ctx.update) {
        console.log('🔑 Ключи объекта ctx.update:', Object.keys(ctx.update));
      }
    }

    // Проверяем, что сообщение пришло из целевого чата
    // Проверяем ID чата и треда (AD_DETECTION_THREAD_IDS из .env)
    const chatId = message.chat.id;
    const threadId = message.message_thread_id || 0;
    
    // Получаем список разрешенных тредов из переменной окружения
    const allowedThreadIds = process.env.AD_DETECTION_THREAD_IDS ? 
                            process.env.AD_DETECTION_THREAD_IDS.split(',').map(id => parseInt(id.trim(), 10)) : 
                            [0, 1, 2]; // По умолчанию разрешаем треды 0, 1, 2
    
    console.log(`💬 Проверка чата/треда: чат=${chatId}, тред=${threadId}, целевой чат=${config.MONO_PITER_CHAT_ID}, разрешенные треды=${allowedThreadIds.join(', ')}`)
    
    // Проверяем, что сообщение из целевого чата и разрешенного треда
    const isTargetChat = chatId === config.MONO_PITER_CHAT_ID;
    const isAllowedThread = allowedThreadIds.includes(threadId);
    
    if (!isTargetChat) {
      console.log(`❌ Сообщение из чата ${chatId}, не совпадает с целевым чатом ${config.MONO_PITER_CHAT_ID}`)
      return false
    }
    
    if (!isAllowedThread) {
      console.log(`❌ Сообщение из треда ${threadId}, не входит в список разрешенных тредов: ${allowedThreadIds.join(', ')}`)
      return false
    }
    
    console.log('✅ Сообщение из целевого чата, продолжаем анализ')

    // Анализируем сообщение на наличие рекламы
    console.log('🔄 Отправляем сообщение на анализ рекламы...')
    const analysisResult = await analyzeMessageForAds(message)
    console.log(`📊 Результат анализа: вероятность рекламы ${analysisResult.adProbability}%, порог: ${config.MODULES.AD_DETECTION.MIN_PROBABILITY_THRESHOLD}%`)

    // Если вероятность рекламы выше порога, отправляем уведомление администраторам
    if (analysisResult.adProbability >= config.MODULES.AD_DETECTION.MIN_PROBABILITY_THRESHOLD) {
      console.log(`✅ Вероятность рекламы (${analysisResult.adProbability}%) превышает порог (${config.MODULES.AD_DETECTION.MIN_PROBABILITY_THRESHOLD}%)`)
      // Форматируем результат анализа
      const formattedResult = formatAdAnalysisResult(analysisResult, message)
      
      if (formattedResult) {
        console.log('✅ Форматирование результата успешно')
        // Создаем ссылку на сообщение
        const messageLink = `https://t.me/${message.chat.username || message.chat.id}/${message.message_thread_id || ''}/${message.message_id}`
        
        // Получаем информацию об отправителе
        const sender = message.from
        const senderLink = `<a href="tg://user?id=${sender.id}">${sender.first_name} ${sender.last_name || ''}</a>`
        
        // Формируем уведомление для администраторов
        const notification = `
🔍 <b>Обнаружена возможная реклама</b>

👤 Отправитель: ${senderLink}
📝 <a href="${messageLink}">Перейти к сообщению</a>

${formattedResult}
`.trim()
        
        // Отправляем уведомление администраторам
        console.log(`📤 Отправляем уведомление администраторам в чат ${config.ADMIN_CHAT_ID}, тред ${config.LAMP_THREAD_ID}`)
        try {
          await sendTelegramMessage(
            bot, 
            config.ADMIN_CHAT_ID, 
            notification, 
            { 
              message_thread_id: config.LAMP_THREAD_ID, 
              parse_mode: 'HTML',
              disable_web_page_preview: true
            }
          )
          console.log('✅ Уведомление о рекламе успешно отправлено')
        } catch (sendError) {
          console.error('❌ Ошибка при отправке уведомления о рекламе:', sendError)
        }
        
        return true
      } else {
        console.log('❌ Результат форматирования пустой, уведомление не отправлено')
      }
    } else {
      console.log(`ℹ️ Вероятность рекламы (${analysisResult.adProbability}%) ниже порога (${config.MODULES.AD_DETECTION.MIN_PROBABILITY_THRESHOLD}%), пропускаем`)
    }
    
    return false
  } catch (error) {
    console.error('❌ Ошибка при обработке сообщения на наличие рекламы:', error)
    return false
  }
}

module.exports = {
  handleMessageForAds
}
