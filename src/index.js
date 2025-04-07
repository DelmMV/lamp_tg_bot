const { Telegraf } = require("telegraf");
const { MongoClient, ObjectId } = require('mongodb');
const { connectToDatabase, closeDatabase } = require("./db");
const { BOT_TOKEN, MONO_PITER_CHAT_ID, MEDIA_THREAD_ID, ADMIN_CHAT_ID, LAMP_THREAD_ID } = require("./config");
const { containsForbiddenWords } = require("./utils/contentFilter");
const { hasMediaHashtag } = require("./utils/helpers");
const { sendTelegramMessage, sendTelegramMedia } = require("./utils/messaging");
const { isUserAccessError, formatUserAccessError } = require("./utils/errorHandler");
const { handleMediaGroup, handleSingleMessage } = require("./handlers/mediaHandler");
const { 
  handleDeleteCommand, 
  handleAlarmCommand, 
  checkForbiddenWords, 
  handleHashtagMedia, 
  handlePrivateMessage 
} = require("./handlers/messageHandler");
const { 
  handleNewChatMembers, 
  handleChatJoinRequest 
} = require("./handlers/userHandler");
const { 
  handleJoinRequestCallback, 
  sendAdminQuestion, 
  handleUserReply 
} = require("./handlers/joinRequestHandler");

// Глобальная переменная для хранения экземпляра бота
let bot = null;

/**
 * Инициализирует бота Telegram
 * @returns {Telegraf} Экземпляр бота
 */
function initBot() {
  try {
    const newBot = new Telegraf(BOT_TOKEN);
    console.log('🤖 Бот инициализирован');
    return newBot;
  } catch (error) {
    console.error('❌ Ошибка при инициализации бота:', error);
    throw error;
  }
}

/**
 * Настраивает обработчики команд бота
 * @param {Telegraf} botInstance - Экземпляр бота
 */
function setupCommandHandlers(botInstance) {
  try {
    // Обработчики команд
    botInstance.command('delete', ctx => handleDeleteCommand(botInstance, ctx));
    botInstance.command('alarm', ctx => handleAlarmCommand(botInstance, ctx));
    console.log('✅ Обработчики команд настроены');
  } catch (error) {
    console.error('❌ Ошибка при настройке обработчиков команд:', error);
    throw error;
  }
}

/**
 * Настраивает обработчики событий пользователей
 * @param {Telegraf} botInstance - Экземпляр бота
 */
function setupUserEventHandlers(botInstance) {
  try {
    botInstance.on('new_chat_members', ctx => handleNewChatMembers(botInstance, ctx));
    botInstance.on('chat_join_request', ctx => handleChatJoinRequest(botInstance, ctx));
    console.log('✅ Обработчики событий пользователей настроены');
  } catch (error) {
    console.error('❌ Ошибка при настройке обработчиков событий пользователей:', error);
    throw error;
  }
}

/**
 * Настраивает обработчик callback запросов (кнопки)
 * @param {Telegraf} botInstance - Экземпляр бота
 */
 function setupCallbackQueryHandler(botInstance) {
   try {
     botInstance.on('callback_query', async (ctx) => {
       console.log('📢 Получен callback запрос:', ctx.callbackQuery.data);
       
       // Флаг, указывающий, что мы ответили на callback
       let callbackAnswered = false;
       
       try {
         // Сразу подтверждаем получение запроса и устанавливаем флаг
         await ctx.answerCbQuery('Обрабатываем запрос...');
         callbackAnswered = true;
         
         // Обрабатываем запрос с кнопками заявок
         await handleJoinRequestCallback(botInstance, ctx);
       } catch (error) {
         console.error('❌ Ошибка обработки callback запроса:', error);
         
         try {
           // Отправляем уведомление об ошибке администраторам
           await sendTelegramMessage(
             botInstance,
             ADMIN_CHAT_ID,
             `⚠️ <b>Ошибка при обработке callback</b>:\n<code>${ctx.callbackQuery.data}</code>\n\n${error.message}`,
             { message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
           );
           
           // Уведомляем пользователя только если мы еще не ответили на callback
           if (!callbackAnswered && !isCallbackQueryExpired(error)) {
             await ctx.answerCbQuery('Произошла ошибка: ' + error.message.substring(0, 200)).catch(e => {
               // Игнорируем ошибки при ответе на устаревший callback
               if (!isCallbackQueryExpired(e)) {
                 console.error('❌ Ошибка при ответе на callback после ошибки:', e);
               }
             });
           }
         } catch (notifyError) {
           console.error('❌ Ошибка при отправке уведомления об ошибке:', notifyError);
         }
       }
     });
     console.log('✅ Обработчик callback запросов настроен');
   } catch (error) {
     console.error('❌ Ошибка при настройке обработчика callback запросов:', error);
     throw error;
   }
 }

/**
 * Настраивает обработчики медиа-сообщений
 * @param {Telegraf} botInstance - Экземпляр бота
 */
function setupMediaHandlers(botInstance) {
  try {
    botInstance.on(['photo', 'video'], async (ctx) => {
      try {
        // Обработка сообщений с хэштегом #media/#медиа
        if (ctx.message.caption && hasMediaHashtag(ctx.message.caption)) {
          if (ctx.message.media_group_id) {
            try {
              const messages = await ctx.telegram.getUpdates({
                allowed_updates: ['message'],
                limit: 50
              }).then(res => res
                .map(update => update.message)
                .filter(message => message && message.media_group_id === ctx.message.media_group_id)
              );
              await handleMediaGroup(botInstance, ctx, messages);
            } catch (error) {
              console.error('❌ Ошибка при получении медиа-группы:', error);
              
              // Отправляем уведомление об ошибке администраторам
              await sendTelegramMessage(
                botInstance,
                ADMIN_CHAT_ID,
                `⚠️ <b>Ошибка при получении медиа-группы</b>:\n${error.message}`,
                { message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
              );
            }
          } else {
            await handleSingleMessage(botInstance, ctx);
          }
        }

        // Обработка личных сообщений с фото
        if (ctx.message.chat.type === "private") {
          await handlePrivateMessage(botInstance, ctx);
        }
      } catch (error) {
        console.error('❌ Ошибка при обработке медиа-сообщения:', error);
        
        // Отправляем уведомление об ошибке администраторам
        await sendTelegramMessage(
          botInstance,
          ADMIN_CHAT_ID,
          `⚠️ <b>Ошибка при обработке медиа-сообщения</b>:\n${error.message}`,
          { message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
        );
      }
    });
    console.log('✅ Обработчики медиа-сообщений настроены');
  } catch (error) {
    console.error('❌ Ошибка при настройке обработчиков медиа-сообщений:', error);
    throw error;
  }
}

/**
 * Настраивает обработчик всех текстовых сообщений
 * @param {Telegraf} botInstance - Экземпляр бота
 */
function setupMessageHandler(botInstance) {
  try {
    botInstance.on('message', async (ctx) => {
      try {
        const messagePreview = ctx.message.text ? 
          ctx.message.text.substring(0, 50) + (ctx.message.text.length > 50 ? '...' : '') : 
          '[не текстовое сообщение]';
        
        console.log('📩 Получено сообщение:', messagePreview);
        
        // Проверяем, является ли сообщение личным
        if (ctx.message.chat.type === "private") {
          console.log('👤 Обработка личного сообщения');
          
          // Сначала пробуем обработать как ответ на вопрос администратора
          const isUserReply = await handleUserReply(botInstance, ctx);
          
          // Если это не ответ на вопрос администратора, обрабатываем как обычное личное сообщение
          if (!isUserReply) {
            const isHandled = await handlePrivateMessage(botInstance, ctx);
            if (isHandled) return; // Если сообщение обработано, прекращаем выполнение
          }
          
          return; // Прекращаем обработку для личных сообщений
        }
        
        // Проверяем, не является ли сообщение ответом на запрос вопроса
        if (ctx.message.reply_to_message) {
          console.log('🔄 Обнаружен ответ на сообщение');
          const isHandled = await sendAdminQuestion(botInstance, ctx);
          if (isHandled) {
            console.log('✅ Сообщение обработано как вопрос от администратора');
            return; // Если сообщение обработано как вопрос, прекращаем выполнение
          }
        }
        
        // Проверка на запрещенные слова
        const hasForbiddenWords = await checkForbiddenWords(botInstance, ctx);
        if (hasForbiddenWords) {
          console.log('🚫 Обнаружены запрещенные слова');
          return;
        }
        
        // Обработка хэштегов медиа в ответах на сообщения
        await handleHashtagMedia(botInstance, ctx);
        
      } catch (error) {
        console.error('❌ Ошибка при обработке сообщения:', error);
        
        // Отправляем уведомление об ошибке администраторам, если это серьезная ошибка
        if (!isUserAccessError(error)) {
          await sendTelegramMessage(
            botInstance,
            ADMIN_CHAT_ID,
            `⚠️ <b>Ошибка при обработке сообщения</b>:\n${error.message}`,
            { message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
          );
        }
      }
    });
    console.log('✅ Обработчик сообщений настроен');
  } catch (error) {
    console.error('❌ Ошибка при настройке обработчика сообщений:', error);
    throw error;
  }
}

/**
 * Настраивает обработку ошибок бота
 * @param {Telegraf} botInstance - Экземпляр бота
 */
function setupErrorHandler(botInstance) {
  botInstance.catch(async (err, ctx) => {
    console.error(`❌ Ошибка бота: ${err.message}`);
    console.error('Стек ошибки:', err.stack);
    
    try {
      // Сохраняем контекст ошибки для отладки
      let errorDetails = 'Неизвестный контекст';
      
      if (ctx) {
        errorDetails = `
Чат: ${ctx.chat?.id || 'н/д'}
Пользователь: ${ctx.from?.id || 'н/д'} (${ctx.from?.username || 'н/д'})
Тип обновления: ${ctx.updateType || 'н/д'}
        `.trim();
      }
      
      // Отправляем подробную информацию об ошибке администраторам
      await sendTelegramMessage(
        botInstance,
        ADMIN_CHAT_ID,
        `🚨 <b>Критическая ошибка бота</b>\n\n<pre>${err.message}</pre>\n\n<b>Детали:</b>\n<pre>${errorDetails}</pre>`,
        { message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
      );
    } catch (notifyError) {
      console.error('❌ Ошибка при отправке уведомления об ошибке:', notifyError);
    }
  });
  
  console.log('✅ Обработчик ошибок бота настроен');
}

/**
 * Настраивает обработку необработанных исключений и отказов промисов
 */
function setupProcessErrorHandlers() {
  // Обработка необработанных исключений
  process.on('uncaughtException', async (error) => {
    console.error('❌ Непойманное исключение:', error);
    
    // Отправляем сообщение администраторам о критической ошибке
    try {
      if (bot) {
        await bot.telegram.sendMessage(
          ADMIN_CHAT_ID, 
          `⚠️ <b>КРИТИЧЕСКАЯ ОШИБКА БОТА</b>\n\n<pre>${error.stack || error.message}</pre>`,
          { message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
        ).catch(e => console.error('❌ Не удалось отправить уведомление об ошибке:', e));
      }
    } catch (e) {
      console.error('❌ Ошибка при отправке уведомления об ошибке:', e);
    }
    
    // В продакшене можно закомментировать следующую строку,
    // чтобы бот не перезапускался при каждой ошибке
    // process.exit(1);
  });

  // Обработка необработанных отказов промисов
  process.on('unhandledRejection', async (reason, promise) => {
    console.error('❌ Непойманный отказ промиса:', reason);
    
    // Отправляем сообщение администраторам о необработанном отказе промиса
    try {
      if (bot) {
        await bot.telegram.sendMessage(
          ADMIN_CHAT_ID, 
          `⚠️ <b>Необработанный отказ промиса</b>\n\n<pre>${reason.stack || String(reason)}</pre>`,
          { message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
        ).catch(e => console.error('❌ Не удалось отправить уведомление об ошибке:', e));
      }
    } catch (e) {
      console.error('❌ Ошибка при отправке уведомления об ошибке:', e);
    }
  });
  
  // Обработка сигналов завершения
  process.on('SIGINT', async () => {
    console.log('🛑 Получен сигнал SIGINT. Завершение работы...');
    await safeShutdown('SIGINT');
  });
  
  process.on('SIGTERM', async () => {
    console.log('🛑 Получен сигнал SIGTERM. Завершение работы...');
    await safeShutdown('SIGTERM');
  });
  
  console.log('✅ Обработчики ошибок процесса настроены');
}

/**
 * Безопасное завершение работы бота
 * @param {string} signal - Сигнал, вызвавший завершение
 */
async function safeShutdown(signal) {
  console.log(`🔄 Начато безопасное завершение работы (${signal})...`);
  
  try {
    // Отправляем сообщение администраторам о выключении бота
    if (bot) {
      await bot.telegram.sendMessage(
        ADMIN_CHAT_ID,
        `🔴 Бот выключается по сигналу ${signal}`,
        { message_thread_id: LAMP_THREAD_ID }
      ).catch(e => console.error('❌ Не удалось отправить уведомление о выключении:', e));
      
      // Останавливаем бота
      bot.stop(signal);
    }
    
    // Закрываем соединение с базой данных
    await closeDatabase().catch(e => console.error('❌ Ошибка при закрытии БД:', e));
    
    console.log('✅ Безопасное завершение работы выполнено');
  } catch (error) {
    console.error('❌ Ошибка при безопасном завершении работы:', error);
  } finally {
    // Завершаем процесс
    process.exit(0);
  }
}

/**
 * Настраивает и запускает бота
 * @async
 */
async function startBot() {
  try {
    console.log('🚀 Запуск бота...');
    
    // Настраиваем обработчики ошибок процесса
    setupProcessErrorHandlers();
    
    // Подключение к базе данных
    await connectToDatabase();
    console.log('✅ Подключение к базе данных установлено');
    
    // Инициализация бота
    bot = initBot();
    
    // Настройка обработчиков
    setupCommandHandlers(bot);
    setupUserEventHandlers(bot);
    setupCallbackQueryHandler(bot);
    setupMediaHandlers(bot);
    setupMessageHandler(bot);
    setupErrorHandler(bot);
    
    // Запуск бота с включенной обработкой ошибок API
    await bot.launch({
      allowedUpdates: [
        'message', 
        'edited_message', 
        'channel_post', 
        'edited_channel_post', 
        'callback_query',
        'chat_join_request'
      ],
      dropPendingUpdates: true
    });
    
    console.log('🚀 Бот успешно запущен и готов к работе');
    
    // Отправляем уведомление о запуске
    await sendTelegramMessage(
      bot,
      ADMIN_CHAT_ID,
      '🟢 Бот запущен и готов к работе',
      { message_thread_id: LAMP_THREAD_ID }
    );
  } catch (error) {
    console.error('❌ Критическая ошибка при запуске бота:', error);
    
    try {
      // Пытаемся закрыть соединение с БД при ошибке
      await closeDatabase().catch(e => console.error('Ошибка при закрытии БД:', e));
    } catch (e) {
      console.error('Ошибка при закрытии ресурсов:', e);
    }
    
    // Завершаем процесс с кодом ошибки
    process.exit(1);
  }
}

// Запускаем бота
startBot();