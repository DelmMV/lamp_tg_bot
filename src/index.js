const { Telegraf } = require("telegraf");
require("dotenv").config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

function sendMessageAdminChat(chatId, message, thread) {
  return bot.telegram.sendMessage(chatId, message, thread).catch((error) => {
    console.log(error);
  });
}

function sendMessageAdminChatPhoto(chatId, content, options) {
  return bot.telegram.sendCopy(chatId, content, options).catch((error) => {
    console.log(error);
  });
}

function sendMessageUser(chatId, message) {
  return bot.telegram.sendMessage(chatId, message).catch((error) => {
    console.log(error);
  });
}

bot.on('new_chat_members', async (ctx) => {
  const replyRequest = `
  <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ""}</a> принят(а) в группу
  `;
  const answer = `
  ${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ""}, добро пожаловать в наш чат!
  `;
  
  await sendMessageUser(ctx.message.from.id, answer);
  await sendMessageAdminChat(-1001295808191, replyRequest, { message_thread_id: 17137, parse_mode: 'HTML' });
});

bot.on('chat_join_request', async (ctx) => {
  const replyRequest = `
  ${ctx.chatJoinRequest.from.first_name} подал(а) заявку на вступление
  ID: <a href="tg://user?id=${ctx.chatJoinRequest.from.id}">${ctx.chatJoinRequest.from.id}</a>
  Логин: ${ctx.chatJoinRequest.from.username ? `@${ctx.chatJoinRequest.from.username}` : 'нету'}
  Имя: ${ctx.chatJoinRequest.from.first_name} ${ctx.chatJoinRequest.from.last_name ? ctx.chatJoinRequest.from.last_name : ""}
  Язык юзера: ${ctx.chatJoinRequest.from.language_code}
  `;
  const answer = `
  Здравствуйте! Вы направили заявку на вступление в сообщество МоноПитер ( t.me/eucriders ).
  Такие заявки мы проверяем на ботов. Чтобы мы одобрили заявку, прошу написать в ответ, какое у вас моноколесо. Если не будет ответа на это сообщение в течение суток, оставляем за собой право отклонить вашу заявку.
  В ожидании одобрения, предлагаю ознакомиться с правилами/ценностями нашего сообщества: https://t.me/eucriders/287907/365863
  Спасибо за понимание!
  `;
  
  await sendMessageUser(ctx.chatJoinRequest.from.id, answer);
  await sendMessageAdminChat(-1001295808191, replyRequest, { message_thread_id: 17137, parse_mode: 'HTML' });
});

bot.on('message', async (ctx) => {
  if (ctx.message.photo) {
    const answer1 = `Ответ от пользователя <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ""}</a>: `;
    await sendMessageAdminChat(-1001295808191, answer1, { message_thread_id: 17137, parse_mode: 'HTML' });
    await sendMessageAdminChatPhoto(-1001295808191, ctx.message, { message_thread_id: 17137 });
  } else if (ctx.message.text && ctx.message.chat.type === "private") {
    const answer2 = `Ответ от пользователя <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ""}</a>: ${ctx.message.text}`;
    await sendMessageAdminChat(-1001295808191, answer2, { message_thread_id: 17137, parse_mode: 'HTML' });
  }
});

bot.launch();
