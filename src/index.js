const {Telegraf} = require("telegraf");
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

bot.command('alarm', async (ctx) => {
	const text = ctx.message.text.split(' ').slice(1).join(' ');
	
	if (!text || !text.includes(',')) {
		return ctx.reply('Пожалуйста, введите через запятую текст с описанием и сылку на сообщения после команды /alarm.');
	}
  
  const [description, link] = text.split(',');
	
	const postDescription = description.trim();
	const postLink = link.trim();
	
	const message = `
  Новый тревожный сигнал от пользователя ${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ''}:
  Ссылка на пост: ${postLink}
  Описание: ${postDescription}
  `;
	
	await sendMessageAdminChat(-1001295808191, message, {message_thread_id: 17137, parse_mode: 'HTML'});
	
	ctx.reply('Ваш тревожный сигнал отправлен администратору.');
});

bot.on('new_chat_members', async (ctx) => {
	const replyRequest = `
  <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ""}</a> принят(а) в группу
  `;
	
	const replyRequestInvite = `
    <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ""}</a> принял в группу <a href="tg://user?id=${ctx.message.new_chat_member.id}">${ctx.message.new_chat_member.first_name} ${ctx.message.new_chat_member.last_name ? ctx.message.new_chat_member.last_name : ""}</a>`
	
	const answer = `
  ${ctx.message.new_chat_member.first_name} ${ctx.message.new_chat_member.last_name ? ctx.message.new_chat_member.last_name : ""}, добро пожаловать в наш чат!
  `;
	
	if (ctx.message.from.first_name != ctx.message.new_chat_member.first_name) {
    await sendMessageAdminChat(-1001295808191, replyRequestInvite, {message_thread_id: 17137, parse_mode: 'HTML'});
  } else {
    await sendMessageAdminChat(-1001295808191, replyRequest, {message_thread_id: 17137, parse_mode: 'HTML'});
  }
  await sendMessageUser(ctx.message.new_chat_member.id, answer);
  
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
  Чтобы мы одобрили заявку, прошу написать в ответе, какое у вас моноколесо или прикрепить его фото. Если не будет ответа на это сообщение в течение суток, оставляем за собой право отклонить вашу заявку.
  В ожидании одобрения, предлагаю ознакомиться с правилами/ценностями нашего сообщества: https://t.me/eucriders/287907/403321
  Спасибо за понимание!
  `;
	
	await sendMessageUser(ctx.chatJoinRequest.from.id, answer);
	await sendMessageAdminChat(-1001295808191, replyRequest, {message_thread_id: 17137, parse_mode: 'HTML'});
});

bot.on('message', async (ctx) => {
	if (ctx.message.chat.type === "private") {
		if (ctx.message.photo) {
			const answer1 = `Ответ от пользователя <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ""}</a>: `;
			await sendMessageAdminChat(-1001295808191, answer1, {message_thread_id: 17137, parse_mode: 'HTML'});
			await sendMessageAdminChatPhoto(-1001295808191, ctx.message, {message_thread_id: 17137});
		} else if (ctx.message.text && ctx.message.chat.type === "private") {
			const answer2 = `Ответ от пользователя <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ""}</a>: ${ctx.message.text}`;
			await sendMessageAdminChat(-1001295808191, answer2, {message_thread_id: 17137, parse_mode: 'HTML'});
		}
	}
	
});

bot.launch();
