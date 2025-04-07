/**
 * Обработчики текстовых сообщений
 * @module messageHandler
 */

 const { containsForbiddenWords } = require('../utils/contentFilter');
 const { sendTelegramMessage } = require('../utils/messaging');
 const { hasMediaHashtag } = require('../utils/helpers');
 const { deleteComment, getJoinRequestByUserId, saveUserButtonMessage } = require('../db');
 const { ADMIN_CHAT_ID, MONO_PITER_CHAT_ID, LAMP_THREAD_ID } = require('../config');
 const { handleMediaGroup, handleSingleMessage } = require('./mediaHandler');

/**
 * Обрабатывает команду удаления комментария
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 */
async function handleDeleteCommand(bot, ctx) {
  if (ctx.message.chat.id !== ADMIN_CHAT_ID) return;
  
  const [, commentId] = ctx.message.text.split(' ');
  if (!commentId) {
    return await ctx.reply('Неверный формат команды. Используйте /delete <commentId>');
  }
  
  try {
    const result = await deleteComment(commentId);
    await ctx.reply(result.message);
  } catch (error) {
    console.error('Error processing delete command:', error);
    await ctx.reply('Произошла ошибка при удалении комментария.');
  }
}

/**
 * Обрабатывает команду тревоги
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 */
async function handleAlarmCommand(bot, ctx) {
  const [, ...textParts] = ctx.message.text.split(' ');
  const text = textParts.join(' ');
  
  if (!text.includes(',')) {
    return await ctx.reply('Пожалуйста, введите через запятую текст с описанием и ссылку на сообщения после команды /alarm.');
  }
  
  const [description, link] = text.split(',').map(part => part.trim());
  
  if (!/^(http|https):\/\/.*/i.test(link)) {
    return await ctx.reply('Пожалуйста, введите корректную ссылку на сообщение.');
  }
  
  const message = `
Новый тревожный сигнал от пользователя <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name || ""}</a>:
Ссылка на пост: ${link}
Описание: ${description}
  `.trim();
  
  await sendTelegramMessage(bot, ADMIN_CHAT_ID, message, { 
    message_thread_id: LAMP_THREAD_ID, 
    parse_mode: 'HTML' 
  });
  await ctx.reply('Ваш тревожный сигнал отправлен администратору.');
}

/**
 * Проверяет сообщение на запрещенные слова
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @returns {Promise<boolean>} - Найдены ли запрещенные слова
 */
async function checkForbiddenWords(bot, ctx) {
  const messageText = ctx.message.text;
  if (!messageText || ctx.message.chat.id !== MONO_PITER_CHAT_ID) return false;
  
  try {
    const result = containsForbiddenWords(messageText);
    if (result.found) {
      const messageLink = `https://t.me/${ctx.message.chat.username}/${ctx.message.message_thread_id}/${ctx.message.message_id}`;
      
      // Ответ пользователю
      await ctx.reply(
        `Ваше сообщение содержит недопустимое слово: <tg-spoiler>${result.word}</tg-spoiler>. Пожалуйста соблюдайте культуру общения нашего сообщества.`,
        {
          reply_to_message_id: ctx.message.message_id,
          parse_mode: 'HTML'
        }
      );
      
      // Уведомление админам
      const adminMessage = `В <a href="${messageLink}">сообщении</a> от <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name || ""}</a> обнаружены не допустимые слова!\nЗапрещенное слово: "${result.word}"`;
      
      await sendTelegramMessage(bot, ADMIN_CHAT_ID, adminMessage, {
        message_thread_id: LAMP_THREAD_ID,
        parse_mode: 'HTML'
      });
      
      return true;
    }
  } catch (error) {
    console.error('Error checking forbidden words:', error);
  }
  
  return false;
}

/**
 * Обрабатывает сообщение с хэштегом медиа
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 */
async function handleHashtagMedia(bot, ctx) {
  const replyMessage = ctx.message.reply_to_message;
  if (!replyMessage) return;
  
  if (hasMediaHashtag(ctx.message.text)) {
    if (replyMessage.media_group_id) {
      try {
        const messages = await ctx.telegram.getUpdates({
          allowed_updates: ['message'],
          limit: 50
        }).then(res => res
          .map(update => update.message.text ? update.message.reply_to_message : update.message)
          .filter(message => message && message.media_group_id === replyMessage.media_group_id)
        );
        await handleMediaGroup(bot, ctx, messages);
      } catch (error) {
        console.error('Error handling media group with hashtag:', error);
      }
    } else {
      await handleSingleMessage(bot, ctx);
    }
  }
}

/**
 * Пересылает сообщение пользователя администраторам
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 * @param {Object} from - Данные отправителя
 * @returns {Promise<boolean>} - Результат операции
 */
 async function forwardMessageToAdmins(bot, ctx, from) {
   const userLink = `<a href="tg://user?id=${from.id}">${from.first_name} ${from.last_name || ""}</a>`;
   const username = from.username ? `@${from.username}` : 'отсутствует';
   
   // Формируем информативное сообщение для администраторов с текстом
   const messageContent = ctx.message.text || '[нет текста]';
   const adminMessage = `
 📥 <b>Сообщение от пользователя с активной заявкой</b>
 
 👤 <b>Отправитель:</b> ${userLink}
 🆔 <b>ID:</b> <code>${from.id}</code>
 👤 <b>Username:</b> ${username}
 
 💬 <b>Сообщение:</b>
 ${messageContent}
   `.trim();
   
   // Отправляем сообщение администраторам
   const sentMsg = await sendTelegramMessage(bot, ADMIN_CHAT_ID, adminMessage, {
     message_thread_id: LAMP_THREAD_ID,
     parse_mode: 'HTML',
     // Добавляем кнопки для действий с заявкой
     reply_markup: {
       inline_keyboard: [
         [
           { text: '❓ Задать вопрос', callback_data: `ask_${from.id}` }
         ]
       ]
     }
   });
   
   // Сохраняем ID сообщения с кнопками в БД
   await saveUserButtonMessage(from.id, sentMsg.message_id);
   
   // Если есть фото или видео, отправляем его отдельно
   if (ctx.message.photo || ctx.message.video) {
     await bot.telegram.sendCopy(ADMIN_CHAT_ID, ctx.message, { 
       message_thread_id: LAMP_THREAD_ID,
       caption: `📎 Медиа от пользователя ${userLink} (ID: ${from.id})`,
       parse_mode: 'HTML'
     });
   }
   
   console.log(`✅ Сообщение от пользователя ${from.id} переслано администраторам`);
   return true;
 }

/**
 * Отправляет стандартный ответ пользователю без активной заявки
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} from - Данные отправителя
 */
async function sendStandardResponseToUser(bot, from) {
  try {
    await sendTelegramMessage(
      bot,
      from.id,
      'Здравствуйте! Если вы хотите вступить в сообщество МоноПитер, пожалуйста, отправьте запрос на вступление через группу. Почитать о нашем сообществе можно на этом сайте http://монопитер.рф'
    );
    console.log(`✅ Отправлен стандартный ответ пользователю ${from.id}`);
  } catch (error) {
    console.error(`❌ Ошибка при отправке стандартного ответа пользователю ${from.id}:`, error);
  }
}

/**
 * Обрабатывает личное сообщение
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 */
 async function handlePrivateMessage(bot, ctx) {
   if (ctx.message.chat.type !== "private") return false;
    
   const { from } = ctx.message;
   const userId = from.id;
    
   try {
     console.log(`📩 Обработка личного сообщения от пользователя ${userId}`);
      
     // Проверяем, есть ли заявка (любого статуса)
     let joinRequest = null;
     try {
       joinRequest = await getJoinRequestByUserId(userId);
     } catch (dbError) {
       console.error('❌ Ошибка при получении данных о заявке:', dbError);
       // При ошибке БД считаем, что заявки нет - отправляем стандартное сообщение
       await sendStandardResponseToUser(bot, from);
       return true;
     }
      
     // Если заявки нет совсем - отправляем стандартный ответ
     if (!joinRequest) {
       console.log(`📎 Заявка для пользователя ${userId} не найдена - отправляем стандартный ответ`);
       await sendStandardResponseToUser(bot, from);
       return true;
     }
      
     // Обрабатываем в зависимости от статуса заявки
     console.log(`📝 Пользователь ${userId} имеет заявку со статусом: ${joinRequest.status}`);
      
     switch (joinRequest.status) {
       case 'pending':
         // У пользователя активная заявка - пересылаем сообщение администраторам
         return await forwardMessageToAdmins(bot, ctx, from);
          
       case 'approved':
         // Заявка одобрена - отправляем пользователю сообщение об одобрении
         await sendTelegramMessage(
           bot,
           userId,
           'Ваша заявка была одобрена. Если у вас возникли вопросы, вы можете задать их в общем чате МоноПитера.'
         );
         return true;
          
       case 'rejected':
         // Заявка отклонена - отправляем пользователю сообщение об отклонении
         await sendTelegramMessage(
           bot,
           userId,
           'Ваша заявка на вступление была отклонена. Если вы хотите подать новую заявку, пожалуйста, сделайте это через основную группу.'
         );
         return true;
          
       default:
         // Неизвестный статус - на всякий случай отправляем стандартный ответ
         console.log(`⚠️ Неизвестный статус заявки: ${joinRequest.status}`);
         await sendStandardResponseToUser(bot, from);
         return true;
     }
   } catch (error) {
     console.error('❌ Ошибка при обработке личного сообщения:', error);
     
     // В случае ошибки отправляем сообщение об ошибке администраторам
     try {
       const userLink = `<a href="tg://user?id=${from.id}">${from.first_name} ${from.last_name || ""}</a>`;
       await sendTelegramMessage(bot, ADMIN_CHAT_ID, 
         `⚠️ <b>Ошибка при обработке сообщения от ${userLink}</b>:\n\n${error.message}`,
         { message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' }
       );
     } catch (sendError) {
       console.error('❌ Ошибка при отправке сообщения админам об ошибке:', sendError);
     }
     
     // Отправляем пользователю сообщение об ошибке
     try {
       await sendTelegramMessage(
         bot,
         userId,
         'Извините, произошла ошибка при обработке вашего сообщения. Пожалуйста, попробуйте позже.'
       );
     } catch (userMessageError) {
       console.error('❌ Не удалось отправить сообщение пользователю об ошибке:', userMessageError);
     }
     
     return true;
   }
 }


 module.exports = {
   handleDeleteCommand,
   handleAlarmCommand,
   checkForbiddenWords,
   handleHashtagMedia,
   handlePrivateMessage,
   forwardMessageToAdmins,
   sendStandardResponseToUser
 };