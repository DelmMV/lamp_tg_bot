/**
 * Обработчики событий, связанных с пользователями
 * @module userHandler
 */

const { sendTelegramMessage } = require('../utils/messaging');
const { determineRegistrationYear } = require('../utils/helpers');
const { ADMIN_CHAT_ID, LAMP_THREAD_ID, MONO_PITER_CHAT_ID } = require('../config');
const { saveJoinRequest } = require('../db'); 

/**
 * Обрабатывает новых участников чата
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 */
async function handleNewChatMembers(bot, ctx) {
  const { from, new_chat_member } = ctx.message;
  
  // Проверяем, что сообщение из целевого чата
  if (ctx.message.chat.id !== MONO_PITER_CHAT_ID) return;
  
  try {
    const isInvited = from.id !== new_chat_member.id;
    
    // Формируем сообщение в зависимости от того, был ли пользователь приглашен
    const message = isInvited
      ? `<a href="tg://user?id=${from.id}">${from.first_name} ${from.last_name || ""}</a> принял в группу <a href="tg://user?id=${new_chat_member.id}">${new_chat_member.first_name} ${new_chat_member.last_name || ""}</a>`
      : `<a href="tg://user?id=${from.id}">${from.first_name} ${from.last_name || ""}</a> принят(а) в группу`;
    
    console.log(`New user added: ${new_chat_member.first_name} ${new_chat_member.last_name || ""}`);
    
    // Отправляем уведомление администраторам
    await sendTelegramMessage(bot, ADMIN_CHAT_ID, message, { 
      message_thread_id: LAMP_THREAD_ID, 
      parse_mode: 'HTML' 
    });
    
    // Приветствуем нового пользователя в личку
    await sendTelegramMessage(
      bot,
      new_chat_member.id, 
      `${new_chat_member.first_name} ${new_chat_member.last_name || ""}, добро пожаловать в наш чат!`
    );
  } catch (error) {
    console.error('Error handling new chat member:', error);
    
    // В случае ошибки (например, пользователь заблокировал бота), сообщаем админам
    if (error.description?.includes('blocked') || error.description?.includes('initiate')) {
      await sendTelegramMessage(
        bot,
        ADMIN_CHAT_ID,
        `Не удалось отправить приветствие пользователю ${new_chat_member.first_name} ${new_chat_member.last_name || ""}: ${error.description}`,
        { message_thread_id: LAMP_THREAD_ID }
      );
    }
  }
}

/**
 * Обрабатывает запросы на вступление в чат
 * @async
 * @param {Object} bot - Экземпляр бота Telegraf
 * @param {Object} ctx - Контекст сообщения Telegraf
 */
async function handleChatJoinRequest(bot, ctx) {
  const { from } = ctx.chatJoinRequest;
  
  // Проверяем, что запрос из целевого чата
  if (ctx.chatJoinRequest.chat.id !== MONO_PITER_CHAT_ID) return;
  
  try {
    const userId = from.id;
    const registrationPeriod = determineRegistrationYear(userId);
    
    // Формируем сообщение для администраторов
    const adminMessage = `
${from.first_name} подал(а) заявку на вступление
ID: <a href="tg://user?id=${from.id}">${from.id}</a>
Логин: ${from.username ? `@${from.username}` : 'нету'}
Имя: ${from.first_name} ${from.last_name || ""}
Язык юзера: ${from.language_code}
Регистрация: ~ ${registrationPeriod}
    `.trim();
    
    // Формируем сообщение для пользователя
    const userMessage = `
Привет! Получили от тебя заявку на вступление в сообщество МоноПитер http://монопитер.рф/rules#text
Такие заявки мы проверяем на ботов.
Если уже есть моноколесо, то напиши в ответ, какое! Можешь приложить его фото ))
Ещё без колеса? Тогда расскажи, что привело тебя к нам? В нашем сообществе всегда помогут с выбором, обучением и вопросами обслуживания.

Не будет ответа на это сообщение в течение суток - придётся отклонить заявку.
Но если что, после отклонения заявку можно подать повторно!

В ожидании одобрения, предлагаю ознакомиться с правилами/ценностями нашего сообщества: https://t.me/eucriders/287907/403321
Спасибо за понимание!
    `.trim();
    
    console.log(`New join request from: ${from.first_name}`);
    
    // Отправляем сообщение пользователю
    await sendTelegramMessage(bot, from.id, userMessage);
    
    // Создаем клавиатуру с кнопками для сообщения админам
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Принять', callback_data: `approve_${from.id}` },
          { text: '❌ Отклонить', callback_data: `reject_${from.id}` }
        ],
        [
          { text: '❓ Задать вопрос', callback_data: `ask_${from.id}` }
        ]
      ]
    };
    
    // Отправляем сообщение админам с кнопками
    const sentMsg = await sendTelegramMessage(bot, ADMIN_CHAT_ID, adminMessage, {
      message_thread_id: LAMP_THREAD_ID,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
    
    // Сохраняем информацию о заявке в БД
    await saveJoinRequest({
      userId: from.id,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
      languageCode: from.language_code,
      registrationPeriod,
      messageId: sentMsg.message_id
    });
  } catch (error) {
    console.error('Error handling chat join request:', error);
    
    // Уведомляем админов о проблеме, если не удалось отправить сообщение пользователю
    if (error.description?.includes('blocked') || error.description?.includes('initiate')) {
      await sendTelegramMessage(
        bot,
        ADMIN_CHAT_ID,
        `Не удалось отправить сообщение пользователю ${from.first_name} ${from.last_name || ""} о запросе на вступление: ${error.description}`,
        { message_thread_id: LAMP_THREAD_ID }
      );
    }
  }
}

module.exports = {
  handleNewChatMembers,
  handleChatJoinRequest
};