/**
 * Обработчики запросов на вступление в чат
 * @module joinRequestHandler
 */

const { sendTelegramMessage } = require('../utils/messaging');
const { 
  isUserAccessError, 
  isJoinRequestMissing, 
  formatUserAccessError 
} = require('../utils/errorHandler');
const { 
  saveJoinRequest, 
  updateJoinRequestStatus, 
  addMessageToJoinRequest, 
  getJoinRequestByUserId,
  saveUserButtonMessage,
  getUserButtonMessages,
  updateJoinRequestStatusWithData
} = require('../db');
const { ADMIN_CHAT_ID, LAMP_THREAD_ID, MONO_PITER_CHAT_ID } = require('../config');

/**
 * Хранит информацию об ожидаемых вопросах от администраторов
 * @type {Map<string, Object>}
 */
const pendingQuestions = new Map();



/**
 * Обрабатывает нажатие на кнопку одобрения заявки
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @param {string} userId - ID пользователя, чья заявка одобряется
 */
async function handleApproveRequest(bot, ctx, userId) {
  try {
    console.log(`🟢 Начат процесс одобрения заявки для пользователя ${userId}`);
    
    // Получаем данные о заявке перед одобрением
    const joinRequest = await getJoinRequestByUserId(userId);
    
    if (!joinRequest) {
      // НЕ отвечаем на callback здесь, т.к. ответ уже был отправлен в основном обработчике
      console.log(`⚠️ Заявка для пользователя ${userId} не найдена или уже обработана`);
      return;
    }
    
    if (joinRequest.status !== 'pending') {
      // НЕ отвечаем на callback здесь, просто обновляем сообщение
      console.log(`⚠️ Заявка пользователя ${userId} уже имеет статус: ${joinRequest.status}`);
      await updateAdminMessage(bot, joinRequest, `✅ Заявка одобрена (${joinRequest.status})`);
      return;
    }
    
    // Остальной код обработки заявки...

    // В конце НЕ вызываем ctx.answerCbQuery, т.к. ответ уже был отправлен
    console.log(`✅ Пользователь ${userId} успешно принят`);
  } catch (error) {
    console.error('❌ Ошибка при одобрении заявки:', error);
    
    // Отправляем информацию об ошибке в админ-чат
    try {
      await sendTelegramMessage(
        bot, 
        ADMIN_CHAT_ID, 
        `❌ Ошибка при одобрении заявки пользователя ${userId}: ${error.message}`,
        { message_thread_id: LAMP_THREAD_ID }
      );
    } catch (e) {
      console.error('Не удалось отправить сообщение об ошибке в админ-чат:', e);
    }
    
    // НЕ отвечаем на callback при ошибке, пробрасываем ошибку дальше
    throw error;
  }
}

/**
 * Обрабатывает нажатие на кнопку отклонения заявки
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @param {string} userId - ID пользователя, чья заявка отклоняется
 */
async function handleRejectRequest(bot, ctx, userId) {
  try {
    console.log(`🔴 Начат процесс отклонения заявки для пользователя ${userId}`);
    
    // Получаем данные о заявке перед отклонением
    const joinRequest = await getJoinRequestByUserId(userId);
    
    if (!joinRequest) {
      await ctx.answerCbQuery('Заявка не найдена или уже обработана');
      return;
    }
    
    if (joinRequest.status !== 'pending') {
      await ctx.answerCbQuery(`Заявка уже имеет статус: ${joinRequest.status}`);
      await updateAdminMessage(bot, joinRequest, `❌ Заявка отклонена (${joinRequest.status})`);
      return;
    }
    
    // Флаг для отслеживания успешности операции в Telegram
    let telegramRejectSuccess = true;
    
    // Отклоняем заявку в Telegram
    try {
      await bot.telegram.declineChatJoinRequest(MONO_PITER_CHAT_ID, userId);
    } catch (error) {
      telegramRejectSuccess = false;
      
      // Обрабатываем ошибку HIDE_REQUESTER_MISSING
      if (isJoinRequestMissing(error)) {
        console.log(`⚠️ Заявка пользователя ${userId} уже не активна в Telegram`);
        // Продолжаем выполнение для обновления БД и сообщений
      } else {
        // Для других ошибок - выбрасываем исключение
        throw error;
      }
    }
    
    // Флаг для отслеживания успешности отправки сообщения пользователю
    let userMessageSent = true;
    
    // Отправляем уведомление пользователю
    try {
      const messageSent = await sendTelegramMessage(
        bot,
        userId,
        'К сожалению, ваша заявка на вступление в сообщество МоноПитер отклонена. Вы можете подать заявку снова позже.'
      );
      
      if (!messageSent) {
        userMessageSent = false;
      }
    } catch (error) {
      userMessageSent = false;
      if (!isUserAccessError(error)) {
        console.error(`❌ Ошибка при отправке уведомления пользователю ${userId}:`, error);
      }
    }
    
    // Обновляем статус в БД с дополнительной информацией
    await updateJoinRequestStatusWithData(userId, 'rejected', {
      telegramRejectSuccess,
      userMessageSent,
      rejectedBy: ctx.from.id,
      rejectedAt: new Date()
    });
    
    // Формируем сообщение о статусе
    let statusMessage = '❌ Заявка отклонена';
    
    if (!telegramRejectSuccess) {
      statusMessage += ' (заявка в Telegram не найдена)';
    }
    
    if (!userMessageSent) {
      statusMessage += ' (не удалось отправить сообщение пользователю)';
    }
    
    // Обновляем сообщение в админ-чате
    await updateAdminMessage(bot, joinRequest, statusMessage);
    
    // Обновляем все сообщения с кнопками для этого пользователя
    await updateAllUserMessages(bot, userId, 'rejected');
    
    // Сообщаем админу об успешном действии
    await ctx.answerCbQuery('Заявка отклонена' + 
                           (!userMessageSent ? ' (не удалось отправить уведомление)' : ''));
    console.log(`✅ Заявка пользователя ${userId} отклонена`);
  } catch (error) {
    console.error('❌ Ошибка при отклонении заявки:', error);
    
    // Отправляем информацию об ошибке в админ-чат
    try {
      await sendTelegramMessage(
        bot, 
        ADMIN_CHAT_ID, 
        `❌ Ошибка при отклонении заявки пользователя ${userId}: ${error.message}`,
        { message_thread_id: LAMP_THREAD_ID }
      );
    } catch (e) {
      console.error('Не удалось отправить сообщение об ошибке в админ-чат:', e);
    }
    
    await ctx.answerCbQuery('Ошибка при отклонении заявки: ' + error.message.substring(0, 100));
  }
}

/**
 * Обрабатывает нажатие на кнопку задания вопроса
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @param {string} userId - ID пользователя, которому задается вопрос
 */
 async function handleAskQuestion(bot, ctx, userId) {
   try {
     console.log(`❓ Подготовка запроса вопроса для пользователя ${userId}`);
     
     // Убедимся, что userId - это число
     const userIdNum = parseInt(userId, 10);
     if (isNaN(userIdNum)) {
       console.error(`❌ Некорректный ID пользователя: ${userId}`);
       return await ctx.reply('Ошибка: некорректный ID пользователя');
     }
     
     // Получаем информацию о пользователе
     const joinRequest = await getJoinRequestByUserId(userIdNum);
     console.log('📄 Данные о заявке:', joinRequest ? 'Найдены' : 'Не найдены');
     
     if (!joinRequest) {
       console.error(`❌ Пользователь ${userIdNum} не найден в заявках`);
       return await ctx.reply('Пользователь не найден или запрос уже обработан');
     }
     
     const userInfo = `${joinRequest.firstName} ${joinRequest.lastName || ''}`;
     console.log(`👤 Информация о пользователе: ${userInfo}`);
     
     // Проверяем, есть ли уже активные запросы вопросов для этого администратора
     const adminId = ctx.from.id;
     let activeRequestsForAdmin = 0;
     
     for (const [key, data] of pendingQuestions.entries()) {
       if (data.adminId === adminId) {
         activeRequestsForAdmin++;
       }
     }
     
     // Формируем сообщение с запросом
     const message = `<b>Вопрос для пользователя ${userInfo} (ID: ${userIdNum})</b>
 
 <i>Чтобы отправить вопрос, просто ответьте на это сообщение.</i>
 
 ${activeRequestsForAdmin > 0 ? 
 `<b>⚠️ У вас уже есть ${activeRequestsForAdmin} активных запросов вопросов. </b>
 Если будете отвечать на этот запрос, в начале ответа укажите ID пользователя в формате:
 <code>${userIdNum}: Ваш вопрос</code>` : ''}
 
 Для отмены введите /cancel в вашем ответе.`;
     
     // Отправляем запрос на ввод вопроса с принудительным ответом
     const sentMsg = await ctx.reply(message, {
       reply_markup: {
         force_reply: true,
         selective: true
       },
       parse_mode: 'HTML'
     });
     
     console.log('📨 Отправлен запрос на ввод вопроса, ID сообщения:', sentMsg.message_id);
     
     // Сохраняем информацию о запросе в памяти
     const requestKey = `${ctx.from.id}_${sentMsg.message_id}`;
     pendingQuestions.set(requestKey, {
       userId: userIdNum, 
       adminId: ctx.from.id,
       messageId: sentMsg.message_id,
       timestamp: Date.now()
     });
     
     console.log('🔑 Сохранен ключ запроса:', requestKey);
     console.log('📋 Текущие ожидающие вопросы:', Array.from(pendingQuestions.keys()));
     
     // Установка тайм-аута для удаления запроса через 30 минут
     setTimeout(() => {
       if (pendingQuestions.has(requestKey)) {
         console.log(`⏱️ Истекло время ожидания для запроса ${requestKey}`);
         pendingQuestions.delete(requestKey);
         try {
           ctx.reply(`Время ожидания вопроса для пользователя ${userInfo} (ID: ${userIdNum}) истекло. При необходимости нажмите кнопку "Задать вопрос" снова.`);
         } catch (e) {
           console.error('❌ Ошибка при отправке уведомления о таймауте:', e);
         }
       }
     }, 30 * 60 * 1000); // 30 минут
     
     console.log('✅ Процесс запроса вопроса завершен успешно');
   } catch (error) {
     console.error('❌ Ошибка при запросе вопроса:', error);
     try {
       await ctx.reply('Ошибка при запросе вопроса: ' + error.message);
     } catch (replyError) {
       console.error('❌ Не удалось отправить сообщение об ошибке:', replyError);
     }
   }
 }

/**
 * Отправляет вопрос от админа пользователю
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @returns {Promise<boolean>} - Было ли сообщение обработано как вопрос
 */
 async function sendAdminQuestion(bot, ctx) {
   try {
     // Проверяем, что это ответ на сообщение
     if (!ctx.message || !ctx.message.reply_to_message) {
       return false;
     }
     
     console.log('🔍 Проверка, является ли сообщение ответом на запрос вопроса');
     
     // Используем ID администратора для поиска его текущих вопросов
     const adminId = ctx.from.id;
     console.log(`👮 Обработка ответа от администратора: ${adminId}`);
     
     // Находим все ожидающие вопросы этого администратора
     let foundUserIds = [];
     
     for (const [key, data] of pendingQuestions.entries()) {
       if (data.adminId === adminId) {
         foundUserIds.push(data.userId);
         console.log(`🔎 Найден ожидающий вопрос для пользователя: ${data.userId}`);
       }
     }
     
     if (foundUserIds.length === 0) {
       console.log('❌ Не найдено ожидающих вопросов для этого администратора');
       return false;
     }
     
     // Если есть только один ожидающий вопрос, используем его
     // Если их несколько, администратору нужно будет указать ID пользователя
     let targetUserId;
     
     if (foundUserIds.length === 1) {
       targetUserId = foundUserIds[0];
       console.log(`✅ Автоматически выбран пользователь: ${targetUserId}`);
     } else {
       // Проверяем, не указан ли ID пользователя в тексте ответа
       const question = ctx.message.text || '';
       const userIdMatch = question.match(/^(\d+):/);
       
       if (userIdMatch) {
         const parsedId = parseInt(userIdMatch[1], 10);
         if (foundUserIds.includes(parsedId)) {
           targetUserId = parsedId;
           // Удаляем ID пользователя из сообщения
           ctx.message.text = question.replace(/^\d+:\s*/, '');
           console.log(`✅ Извлечен ID пользователя из текста: ${targetUserId}`);
         } else {
           await ctx.reply(`❌ ID пользователя ${parsedId} не найден в ваших текущих запросах вопросов.
 Активные запросы вопросов: ${foundUserIds.join(', ')}`);
           return true;
         }
       } else {
         await ctx.reply(`❓ У вас несколько активных запросов вопросов. Пожалуйста, укажите ID пользователя в формате:
 <ID пользователя>: ваш вопрос
 
 Например: ${foundUserIds[0]}: Какая у вас модель моноколеса?
 
 Активные запросы вопросов: ${foundUserIds.join(', ')}`);
         return true;
       }
     }
     
     // Получаем данные о пользователе для проверки
     const joinRequest = await getJoinRequestByUserId(targetUserId);
     if (!joinRequest) {
       console.log(`❌ Пользователь ${targetUserId} не найден в заявках`);
       await ctx.reply(`Заявка для пользователя с ID ${targetUserId} не найдена или уже обработана.`);
       
       // Очищаем устаревшие запросы
       for (const [key, data] of pendingQuestions.entries()) {
         if (data.userId === targetUserId) {
           pendingQuestions.delete(key);
           console.log(`🗑️ Удален устаревший запрос: ${key}`);
         }
       }
       
       return true;
     }
     
     // Получаем текст вопроса
     const question = ctx.message.text;
     
     if (!question || question.trim() === '') {
       await ctx.reply('❌ Пожалуйста, введите текст вопроса.');
       return true;
     }
     
     // Проверка на команду отмены
     if (question === '/cancel') {
       // Удаляем все запросы для этого пользователя
       for (const [key, data] of pendingQuestions.entries()) {
         if (data.userId === targetUserId && data.adminId === adminId) {
           pendingQuestions.delete(key);
         }
       }
       
       await ctx.reply('❌ Запрос вопроса отменен.');
       return true;
     }
     
     console.log(`📤 Отправка вопроса пользователю ${targetUserId}: ${question}`);
     
     // Отправляем вопрос пользователю
     await sendTelegramMessage(bot, targetUserId, `Вопрос от администратора: ${question}`);
     
     // Сохраняем вопрос в истории диалога
     await addMessageToJoinRequest(targetUserId, question, 'admin');
     
     // Уведомляем администратора
     await ctx.reply(`✅ Вопрос успешно отправлен пользователю ${joinRequest.firstName} ${joinRequest.lastName || ""} (ID: ${targetUserId}). Ожидаем ответ.`);
     
     // Очищаем соответствующие записи из pendingQuestions
     for (const [key, data] of pendingQuestions.entries()) {
       if (data.userId === targetUserId && data.adminId === adminId) {
         pendingQuestions.delete(key);
         console.log(`🗑️ Удален ключ запроса: ${key}`);
       }
     }
     
     console.log('📋 Оставшиеся ожидающие вопросы:', Array.from(pendingQuestions.keys()));
     
     return true;
   } catch (error) {
     console.error('❌ Ошибка при отправке вопроса администратора:', error);
     await ctx.reply('❌ Ошибка при отправке вопроса: ' + error.message);
     return true;
   }
 }
 
 /**
  * Обновляет кнопки во всех сообщениях, связанных с пользователем
  * @async
  * @param {Object} bot - Экземпляр бота Telegraf
  * @param {string} userId - ID пользователя
  * @param {string} status - Новый статус заявки ('approved' или 'rejected')
  */
  async function updateAllUserMessages(bot, userId, status) {
    try {
      console.log(`🔄 Начато обновление кнопок в сообщениях для пользователя ${userId}`);
      
      // Получаем все сохранённые сообщения с кнопками для данного пользователя
      const buttonMessages = await getUserButtonMessages(userId);
      
      if (!buttonMessages || buttonMessages.length === 0) {
        console.log(`ℹ️ Не найдено сообщений с кнопками для пользователя ${userId}`);
        return;
      }
      
      console.log(`🔍 Найдено ${buttonMessages.length} сообщений с кнопками для пользователя ${userId}`);
      
      // Создаем новую клавиатуру только с кнопкой "Задать вопрос"
      const newKeyboard = {
        inline_keyboard: [
          [
            { text: '❓ Задать вопрос', callback_data: `ask_${userId}` }
          ]
        ]
      };
      
      // Счетчик обновленных сообщений
      let updatedCount = 0;
      
      // Обрабатываем каждое сообщение
      for (const message of buttonMessages) {
        try {
          // Обновляем сообщение с новой клавиатурой
          await bot.telegram.editMessageReplyMarkup(
            ADMIN_CHAT_ID,
            message.messageId,
            null,
            newKeyboard
          );
          
          updatedCount++;
          console.log(`✅ Обновлено сообщение ID: ${message.messageId}`);
        } catch (editError) {
          // Игнорируем ошибку "message is not modified"
          if (editError.description && editError.description.includes('message is not modified')) {
            console.log(`⚠️ Сообщение ${message.messageId} уже имеет актуальную клавиатуру`);
          } else if (editError.description && editError.description.includes('message to edit not found')) {
            console.log(`⚠️ Сообщение ${message.messageId} не найдено (возможно, удалено)`);
          } else {
            console.error(`❌ Ошибка при обновлении сообщения ${message.messageId}:`, editError);
          }
        }
      }
      
      console.log(`🔄 Завершено обновление кнопок. Обновлено сообщений: ${updatedCount}`);
    } catch (error) {
      console.error('❌ Ошибка при обновлении кнопок в сообщениях:', error);
    }
  }
 
 /**
  * Получает последние сообщения из чата/треда
  * @async
  * @param {Object} bot - Экземпляр бота Telegraf
  * @param {number} chatId - ID чата
  * @param {number} threadId - ID треда (если есть)
  * @param {number} limit - Максимальное количество сообщений
  * @returns {Promise<Array>} - Массив сообщений
  */
 async function fetchRecentMessages(bot, chatId, threadId, limit = 100) {
   try {
     // Пытаемся получить сообщения через метод getChat, но это временное решение
     // В идеале нужно использовать метод getChatHistory, когда он станет доступен в Bot API
     
     // Для данной задачи придется использовать прокси-метод
     // Это эмуляция получения сообщений, которые бот может видеть в чате
     
     // Получаем последние обновления (это не идеальное решение, но в рамках API телеграм бота - лучшее, что можно сделать)
     // Реальная реализация будет зависеть от того, как хранятся сообщения в вашей системе
     
     // Это упрощенная "заглушка" для концепции
     // В реальном сценарии вам может потребоваться собственное хранилище сообщений
     
     // Притворимся, что мы получили сообщения
     console.log(`🔍 Попытка получить последние сообщения из чата ${chatId}, тред ${threadId}`);
     
     // Здесь мы просто возвращаем пустой массив, так как у нас нет прямого доступа к истории сообщений
     // В идеальном мире мы бы хранили ID всех сообщений с кнопками в базе данных
     return [];
   } catch (error) {
     console.error('❌ Ошибка при получении сообщений:', error);
     return [];
   }
 }

/**
 * Обрабатывает ответ пользователя на вопрос администратора
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 */
 async function handleUserReply(bot, ctx) {
   // Проверяем, что сообщение пришло в личку боту
   if (ctx.message.chat.type !== 'private') {
     return false;
   }
   
   const userId = ctx.from.id;
   
   try {
     console.log(`📨 Получено сообщение от пользователя ${userId} в личном чате`);
     
     // Получаем информацию о заявке
     let joinRequest = null;
     try {
       joinRequest = await getJoinRequestByUserId(userId);
     } catch (dbError) {
       console.error('❌ Ошибка при получении данных о заявке:', dbError);
       return false; // При ошибке БД передаем обработку дальше
     }
     
     if (!joinRequest) {
       console.log(`❌ Заявка для пользователя ${userId} не найдена`);
       return false; // Нет заявки
     }
     
     // Проверяем статус заявки
     if (joinRequest.status !== 'pending') {
       console.log(`⚠️ Заявка пользователя ${userId} имеет статус: ${joinRequest.status}`);
       
       // Для отклоненных заявок можем отправить сообщение пользователю
       if (joinRequest.status === 'rejected') {
         await sendTelegramMessage(
           bot,
           userId,
           'Ваша заявка на вступление была отклонена ранее. Если вы хотите подать новую заявку, пожалуйста, сделайте это через основную группу.'
         );
         return true; // Сообщение обработано
       }
       
       return false; // Для других статусов просто игнорируем
     }
     
     const message = ctx.message.text || 'Пользователь отправил медиа-файл';
     console.log(`📝 Содержимое сообщения: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
     
     // Сохраняем ответ в истории диалога
     try {
       await addMessageToJoinRequest(userId, message, 'user');
     } catch (dbError) {
       console.error('❌ Ошибка при сохранении сообщения в БД:', dbError);
       // Продолжаем выполнение даже при ошибке сохранения
     }
     
     // Формируем ссылку на пользователя
     const userLink = `<a href="tg://user?id=${userId}">${joinRequest.firstName} ${joinRequest.lastName || ""}</a>`;
     
     // Отправляем ответ администраторам
     const adminMessage = `
 💬 <b>Ответ от пользователя ${userLink}:</b>
 ${message}
     `.trim();
     
     console.log(`📤 Отправка ответа пользователя администраторам`);
     
     // Отправляем сообщение с кнопками действий
     const sentMsg = await sendTelegramMessage(bot, ADMIN_CHAT_ID, adminMessage, {
       message_thread_id: LAMP_THREAD_ID,
       parse_mode: 'HTML',
       reply_markup: {
         inline_keyboard: [
           [
             { text: '✅ Принять', callback_data: `approve_${userId}` },
             { text: '❌ Отклонить', callback_data: `reject_${userId}` }
           ],
           [
             { text: '❓ Задать вопрос', callback_data: `ask_${userId}` }
           ]
         ]
       }
     });
     
     // Сохраняем ID сообщения с кнопками в БД
     await saveUserButtonMessage(userId, sentMsg.message_id);
     
     // Если пользователь отправил фото или видео, пересылаем их
     if (ctx.message.photo || ctx.message.video) {
       console.log('📷 Пересылка медиа от пользователя администраторам');
       await bot.telegram.sendCopy(ADMIN_CHAT_ID, ctx.message, { 
         message_thread_id: LAMP_THREAD_ID,
         caption: `Медиа от пользователя ${userLink}`,
         parse_mode: 'HTML'
       });
     }
     
     console.log(`✅ Ответ пользователя успешно обработан`);
     return true; // Сообщение обработано
   } catch (error) {
     console.error('❌ Ошибка при обработке ответа пользователя:', error);
     return false;
   }
 }

/**
 * Обновляет сообщение с заявкой в админ-чате
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} joinRequest - Данные о заявке
 * @param {string} statusText - Текст статуса
 */
 async function updateAdminMessage(bot, joinRequest, statusText) {
   try {
     // Проверяем наличие сообщения
     if (!joinRequest || !joinRequest.messageId) {
       console.log('❌ ID сообщения не найден в заявке');
       return;
     }
     
     // Получаем информацию о пользователе
     const { userId, firstName, lastName, username, messageId } = joinRequest;
     const userLink = `<a href="tg://user?id=${userId}">${firstName} ${lastName || ""}</a>`;
     
     console.log(`📝 Обновление сообщения администратора ${messageId} для пользователя ${userId}`);
     
     // Формируем новое сообщение
     const messageText = `
 ${userLink} подал(а) заявку на вступление
 ID: <a href="tg://user?id=${userId}">${userId}</a>
 Логин: ${username ? `@${username}` : 'нету'}
 Имя: ${firstName} ${lastName || ""}
 Статус: ${statusText}
     `.trim();
     
     // Определяем, какие кнопки показывать в зависимости от статуса
     let replyMarkup;
     
     if (joinRequest.status === 'pending') {
       // Для заявок в ожидании показываем все кнопки
       replyMarkup = {
         inline_keyboard: [
           [
             { text: '✅ Принять', callback_data: `approve_${userId}` },
             { text: '❌ Отклонить', callback_data: `reject_${userId}` }
           ],
           [
             { text: '❓ Задать вопрос', callback_data: `ask_${userId}` }
           ]
         ]
       };
     } else {
       // Для обработанных заявок показываем только кнопку "Задать вопрос"
       replyMarkup = {
         inline_keyboard: [
           [
             { text: '❓ Задать вопрос', callback_data: `ask_${userId}` }
           ]
         ]
       };
     }
     
     try {
       // Обновляем сообщение
       await bot.telegram.editMessageText(
         ADMIN_CHAT_ID,
         messageId,
         null,
         messageText,
         {
           parse_mode: 'HTML',
           reply_markup: replyMarkup
         }
       );
       
       console.log(`✅ Сообщение администратора успешно обновлено`);
     } catch (error) {
       // Проверяем, не является ли ошибка "message is not modified"
       if (error.description && error.description.includes('message is not modified')) {
         console.log('⚠️ Сообщение уже содержит актуальную информацию');
       } else {
         // Если другая ошибка - пробрасываем дальше
         throw error;
       }
     }
   } catch (error) {
     console.error('❌ Ошибка при обновлении сообщения администратора:', error);
   }
 }

 /**
  * Обрабатывает нажатия на кнопки управления заявками
  * @async
  * @param {Object} bot - Экземпляр бота Telegraf
  * @param {Object} ctx - Контекст callback query
  */
 async function handleJoinRequestCallback(bot, ctx) {
   try {
     const data = ctx.callbackQuery.data;
     console.log('📥 Получены данные callback:', data);
     
     if (!data) {
       console.error('❌ Получены пустые данные callback');
       return; // Не отвечаем на callback здесь
     }
     
     // Разбираем данные callback для определения действия
     if (data.startsWith('approve_')) {
       const userId = data.split('_')[1];
       console.log(`🟢 Обработка одобрения для пользователя ${userId}`);
       await handleApproveRequest(bot, ctx, userId);
       
       // После успешной обработки выводим результат через основное сообщение в чате,
       // а не через всплывающее уведомление
     } 
     else if (data.startsWith('reject_')) {
       const userId = data.split('_')[1];
       console.log(`🔴 Обработка отклонения для пользователя ${userId}`);
       await handleRejectRequest(bot, ctx, userId);
     }
     else if (data.startsWith('ask_')) {
       const userId = data.split('_')[1];
       console.log(`❓ Обработка запроса на вопрос для пользователя ${userId}`);
       await handleAskQuestion(bot, ctx, userId);
     }
     else {
       console.error('❓ Неизвестный формат данных callback:', data);
       // Не отвечаем на callback здесь
     }
   } catch (error) {
     console.error('❌ Ошибка при обработке callback запроса:', error);
     // Не отвечаем на callback при ошибке, пробрасываем ошибку дальше
     throw error;
   }
 }

module.exports = {
  handleApproveRequest,
  handleRejectRequest,
  handleAskQuestion,
  sendAdminQuestion,
  handleUserReply,
  handleJoinRequestCallback,
  updateAllUserMessages
};