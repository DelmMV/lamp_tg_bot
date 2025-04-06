const { Telegraf } = require("telegraf");
const { MongoClient, ObjectId } = require('mongodb');
const { connectToDatabase, closeDatabase } = require("./db");
const { BOT_TOKEN, MONO_PITER_CHAT_ID, MEDIA_THREAD_ID, MONGO_URL, DB_NAME } = require("./config");
const { containsForbiddenWords } = require("./utils/contentFilter");
const { hasMediaHashtag } = require("./utils/helpers");
const { sendTelegramMessage, sendTelegramMedia } = require("./utils/messaging");
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

// Инициализация бота
const bot = new Telegraf(BOT_TOKEN);

// Обработчики команд
bot.command('delete', ctx => handleDeleteCommand(bot, ctx));
bot.command('alarm', ctx => handleAlarmCommand(bot, ctx));

// Обработчики событий пользователей
bot.on('new_chat_members', ctx => handleNewChatMembers(bot, ctx));
bot.on('chat_join_request', ctx => handleChatJoinRequest(bot, ctx));

// Обработчик callback запросов (кнопки)
bot.on('callback_query', async (ctx) => {
  console.log('📢 Получен callback запрос:', ctx.callbackQuery.data);
  try {
    // Немедленно подтверждаем получение запроса
    await ctx.answerCbQuery('Обрабатываем запрос...');
    
    // Обрабатываем запрос с кнопками заявок
    await handleJoinRequestCallback(bot, ctx);
  } catch (error) {
    console.error('❌ Ошибка обработки callback запроса:', error);
    try {
      await ctx.answerCbQuery('Произошла ошибка: ' + error.message.substring(0, 200));
    } catch (e) {
      console.error('Ошибка при ответе на callback:', e);
    }
  }
});

// Обработчики медиа-сообщений
bot.on(['photo', 'video'], async (ctx) => {
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
        await handleMediaGroup(bot, ctx, messages);
      } catch (error) {
        console.error('Error fetching media group:', error);
      }
    } else {
      await handleSingleMessage(bot, ctx);
    }
  }

  // Обработка личных сообщений с фото
  if (ctx.message.chat.type === "private") {
    await handlePrivateMessage(bot, ctx);
  }
});

// Обработчик всех текстовых сообщений
bot.on('message', async (ctx) => {
  try {
    console.log('📩 Получено сообщение:', 
      ctx.message.text ? 
      ctx.message.text.substring(0, 50) + (ctx.message.text.length > 50 ? '...' : '') : 
      '[не текстовое сообщение]'
    );
    
    // Проверяем, является ли сообщение личным
    if (ctx.message.chat.type === "private") {
      console.log('👤 Обработка личного сообщения');
      
      // Сначала пробуем обработать как ответ на вопрос администратора
      const isUserReply = await handleUserReply(bot, ctx);
      
      // Если это не ответ на вопрос администратора, обрабатываем как обычное личное сообщение
      if (!isUserReply) {
        const isHandled = await handlePrivateMessage(bot, ctx);
        if (isHandled) return; // Если сообщение обработано, прекращаем выполнение
      }
      
      return; // Прекращаем обработку для личных сообщений
    }
    
    // Проверяем, не является ли сообщение ответом на запрос вопроса
    if (ctx.message.reply_to_message) {
      console.log('🔄 Обнаружен ответ на сообщение');
      const isHandled = await sendAdminQuestion(bot, ctx);
      if (isHandled) {
        console.log('✅ Сообщение обработано как вопрос от администратора');
        return; // Если сообщение обработано как вопрос, прекращаем выполнение
      }
    }
    
    // Проверка на запрещенные слова
    const hasForbiddenWords = await checkForbiddenWords(bot, ctx);
    if (hasForbiddenWords) {
      console.log('🚫 Обнаружены запрещенные слова');
      return;
    }
    
    // Обработка хэштегов медиа в ответах на сообщения
    await handleHashtagMedia(bot, ctx);
    
  } catch (error) {
    console.error('❌ Ошибка при обработке сообщения:', error);
  }
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`Bot error occurred: ${err.message}`);
  console.error('Error context:', err.stack);
  
  // Сохраняем контекст ошибки в случае необходимости отладки
  if (ctx) {
    console.error('Error context chat:', ctx.chat?.id);
    console.error('Error context user:', ctx.from?.id);
  }
});

// Запуск бота
async function startBot() {
  try {
    // Подключение к базе данных
    await connectToDatabase();
    
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
    
    console.log('🚀 Бот запущен и готов к работе');
    
    // Обработка завершения работы
    setupGracefulShutdown();
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Настройка корректного завершения работы
function setupGracefulShutdown() {
  process.once('SIGINT', async () => {
    console.log('SIGINT received. Shutting down...');
    await closeDatabase();
    bot.stop('SIGINT');
  });
  
  process.once('SIGTERM', async () => {
    console.log('SIGTERM received. Shutting down...');
    await closeDatabase();
    bot.stop('SIGTERM');
  });
}

// Запускаем бота
startBot();