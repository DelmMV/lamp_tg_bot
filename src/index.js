const {Telegraf} = require("telegraf");
require("dotenv").config();

//Тестовая -1001959551535  message_thread_id: 2
//id чата админов -1001295808191 message_thread_id: 17137

//thread media  message_thread_id: 327902
//id chat монопитер -1001405911884

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const adminChatId = '-1001295808191'
const lampThreadId = '17137'

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
		return ctx.reply('Пожалуйста, введите через запятую текст с описанием и ссылку на сообщения после команды /alarm.');
	}
	
	const [description, link] = text.split(',');
	
	const postDescription = description.trim();
	const postLink = link.trim();
	
	const urlPattern = /^(http|https):\/\/.*/i;
	if (!urlPattern.test(postLink)) {
		return ctx.reply('Пожалуйста, введите через запятую санчало текст с описанием, а потом ссылку на сообщения');
	}
	
	const message = `
  Новый тревожный сигнал от пользователя <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ""}</a>:
  Ссылка на пост: ${postLink}
  Описание: ${postDescription}
  `;
	
	await sendMessageAdminChat(adminChatId, message, {message_thread_id: lampThreadId, parse_mode: 'HTML'});
	
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
	
	if (ctx.message.from.first_name !== ctx.message.new_chat_member.first_name) {
		await sendMessageAdminChat(adminChatId, replyRequestInvite, {message_thread_id: lampThreadId, parse_mode: 'HTML'});
	} else {
		await sendMessageAdminChat(adminChatId, replyRequest, {message_thread_id: lampThreadId, parse_mode: 'HTML'});
	}
	console.log(`${ctx.message.new_chat_member.id}
								${ctx.message.chat.id}
								${ctx.from.id}`)
	await sendMessageUser(ctx.from.id, answer);
	
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
Привет! Получили от тебя заявку на вступление в сообщество МоноПитер ( t.me/eucriders ).
Такие заявки мы проверяем на ботов.
Если уже есть моноколесо, то напиши в ответ, какое! Можешь приложить его фото ))
Ещё без колеса? Тогда расскажи, что привело тебя к нам? В нашем сообществе всегда помогут с выбором, обучением и вопросами обслуживания.

Не будет ответа на это сообщение в течение суток - придётся отклонить заявку.
Но если что, после отклонения заявку можно подать повторно!

В ожидании одобрения, предлагаю ознакомиться с правилами/ценностями нашего сообщества: https://t.me/eucriders/287907/403321
Спасибо за понимание!
  `;
	
	await sendMessageUser(ctx.chatJoinRequest.from.id, answer);
	await sendMessageAdminChat(adminChatId, replyRequest, {message_thread_id: lampThreadId, parse_mode: 'HTML'});
});

bot.on('message', async (ctx) => {
	let messageMedia = ''
	let replyMessageMedia = ''
	
	function filterMediaMessage(text) {
		if (text) {
			const splitText = text.split(/[\s\n]+/)
			messageMedia = splitText.filter(word => word === '#media' || word === '#медиа').toString();
		}
	}
	
	function replyFilterMediaMessage(text) {
		
		if (text) {
			const splitText = text.split(/[\s\n]+/)
			replyMessageMedia = splitText.filter(word => word === '#media' || word === '#медиа').toString();
		}
	}
	
	filterMediaMessage(ctx.message.caption)
	replyFilterMediaMessage(ctx.message.text)
	
	if (ctx.message.chat.type === "private") {
		if (ctx.message.photo) {
			const answer1 = `Ответ от пользователя <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ""}</a>: `;
			await sendMessageAdminChat(adminChatId, answer1, {message_thread_id: lampThreadId, parse_mode: 'HTML'});
			await sendMessageAdminChatPhoto(adminChatId, ctx.message, {message_thread_id: lampThreadId});
		} else if (ctx.message.text && ctx.message.chat.type === "private") {
			const answer2 = `Ответ от пользователя <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ""}</a>: ${ctx.message.text}`;
			await sendMessageAdminChat(adminChatId, answer2, {message_thread_id: lampThreadId, parse_mode: 'HTML'});
		}
	}
	if (messageMedia === '#media' || messageMedia === '#медиа') {
		
		const chatUserName = ctx.message.chat.username;
		const sourceChatId = ctx.message.chat.id;
		const destinationChatId = -1001405911884;
		const messageId = ctx.message.message_id;
		const messageThreadId = ctx.message.message_thread_id;
		
		
		await ctx.telegram.forwardMessage(destinationChatId, sourceChatId, messageId, {message_thread_id: 327902})
				.catch((error) => {
					console.log(error)
				});
		await ctx.telegram.sendMessage(destinationChatId, `https://t.me/${chatUserName}/${messageThreadId}/${messageId}`, {message_thread_id: 327902})
				.catch((error) => {
					console.log(error)
				});
	}
	
	if (replyMessageMedia === '#media' || replyMessageMedia === '#медиа') {
		
		if (ctx.message.reply_to_message.photo || ctx.message.reply_to_message.video) {
			const chatUserName = ctx.message.reply_to_message.chat.username;
			const sourceChatId = ctx.message.reply_to_message.chat.id;
			const destinationChatId = -1001405911884;
			const messageId = ctx.message.reply_to_message.message_id;
			const messageThreadId = ctx.message.reply_to_message.message_thread_id;
			
			await ctx.telegram.forwardMessage(destinationChatId, sourceChatId, messageId, {message_thread_id: 327902})
					.catch((error) => {
						console.log(error)
					});
			await ctx.telegram.sendMessage(destinationChatId, `https://t.me/${chatUserName}/${messageThreadId}/${messageId}`, {message_thread_id: 327902})
					.catch((error) => {
						console.log(error)
					});
		}
	}
	
});

bot.launch();

