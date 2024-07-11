const {Telegraf} = require("telegraf");
const { MongoClient, ObjectId } = require('mongodb');
require("dotenv").config();

//Тестовая -1001959551535  message_thread_id: 2
//id чата админов -1001295808191 message_thread_id: 17137

//thread media  message_thread_id: 327902
//id chat монопитер -1001405911884

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const mongoUrl = 'mongodb://localhost:27017';

const adminChatId = -1001295808191
const lampThreadId = 17137
const mediaThreadId = 327902
const monoPiterChatId = -1001405911884
const urlComments = process.env.URL_COMMENTS

const client = new MongoClient(mongoUrl);
let db;
async function main() {
	try {
		await client.connect();
		db = client.db('telegramBot');
		console.log("Connected to MongoDB");
	} catch (error) {
		console.error("MongoDB connection error:", error);
	}
}

main();

//Start functions////////////////////////////////////////

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

async function handleMediaGroup(ctx, messages) {
	try {
		const mediaCollection = db.collection('media');
		const mediaMessage = ctx.message;
		const result = await mediaCollection.insertOne(mediaMessage);
		
		const chatUserName = ctx.message.chat.username;
		const messageId = ctx.message.message_id;
		const messageThreadId = ctx.message.message_thread_id;
		
		const media = messages.map(message => {
			if (message.photo) {
				return {
					type: 'photo',
					media: message.photo[message.photo.length - 1].file_id,
					caption: message.caption || ''
				};
			} else if (message.video) {
				return {
					type: 'video',
					media: message.video.file_id,
					caption: message.caption || '',
				};
			}
		}).filter(Boolean); // Убираем неопределенные значения
		
		if (media.length > 0) {
			await ctx.telegram.sendMediaGroup(monoPiterChatId, media, { message_thread_id: mediaThreadId });
			await ctx.telegram.sendMessage(monoPiterChatId, `https://t.me/${chatUserName}/${messageThreadId}/${messageId}`, {
				message_thread_id: mediaThreadId,
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: 'Прокомментировать',
								url: `${urlComments}${result.insertedId}`
							}
						]
					]
				}
			});
		}
	} catch (error) {
		console.error('Ошибка при обработке группы медиа:', error);
	}
}

async function handleSingleMessage(ctx) {
	try {
		const mediaCollection = db.collection('media');
		const mediaMessage = ctx.message;
		const result = await mediaCollection.insertOne(mediaMessage);
		
		const chatUserName = ctx.message.chat.username;
		const messageId = ctx.message.message_id;
		const messageThreadId = ctx.message.message_thread_id;
		
		const ctxMessage = ctx.message.text ? ctx.message.reply_to_message.photo : ctx.message.photo
		if (ctxMessage) {
			await ctx.telegram.sendPhoto(monoPiterChatId, ctxMessage[
					ctx.message.text ? ctx.message.reply_to_message.photo.length - 1 : ctx.message.photo.length - 1
					].file_id, {
				message_thread_id: mediaThreadId,
				caption: `https://t.me/${chatUserName}/${messageThreadId}/${messageId}`,
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: 'Прокомментировать',
								url: `${urlComments}${result.insertedId}`
							}
						]
					]
				}
			});
		} else if (ctx.message.video) {
			await ctx.telegram.sendVideo(monoPiterChatId, ctx.message.video.file_id, {
				message_thread_id: mediaThreadId,
				caption: `https://t.me/${chatUserName}/${messageThreadId}/${messageId}`,
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: 'Прокомментировать',
								url: `${urlComments}${result.insertedId}`
							}
						]
					]
				}
			});
		}
	} catch (error) {
		console.error('Ошибка при обработке одиночного медиа:', error);
	}
}

function hasMediaHashtag(text) {
	return text && (text.includes('#media') || text.includes('#медиа'));
}

async function getMediaGroupMessages(ctx, media_group_id) {
	
	try {
		const messages = await ctx.telegram.getUpdates({
			allowed_updates: ['message'],
			limit: 50
		}).then(res => res.map(update => update.message.text?update.message.reply_to_message:update.message)
				.filter(message => message.media_group_id === media_group_id));
		return messages;
	} catch (error) {
		console.error('Ошибка при получении сообщений мультимедийной группы:', error);
		return [];
	}
}
//End function////////////////////////////////////

bot.command('delete', async (ctx) => {
	const messageText = ctx.message.text;
	const parts = messageText.split(' ');
	if(ctx.message.chat.id ===  adminChatId) {
		if (parts.length !== 2) {
			return ctx.reply('Неверный формат команды. Используйте /delete <commentId>');
		}
		
		const commentId = parts[1];
		
		try {
			const commentsCollection = db.collection('comments');
			const result = await commentsCollection.deleteOne({ _id: new ObjectId(commentId) });
			
			if (result.deletedCount === 1) {
				ctx.reply(`Комментарий с ID ${commentId} успешно удален.`);
			} else {
				ctx.reply(`Комментарий с ID ${commentId} не найден.`);
			}
		} catch (error) {
			console.error('Ошибка при удалении комментария:', error);
			ctx.reply('Произошла ошибка при удалении комментария.');
		}
	}
});

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
	if(ctx.message.chat.id === monoPiterChatId) {
		if (ctx.message.from.first_name !== ctx.message.new_chat_member.first_name) {
			await sendMessageAdminChat(adminChatId, replyRequestInvite, {message_thread_id: lampThreadId, parse_mode: 'HTML'});
		} else {
			await sendMessageAdminChat(adminChatId, replyRequest, {message_thread_id: lampThreadId, parse_mode: 'HTML'});
		}
		console.log(`${ctx.message.new_chat_member.id}
								${ctx.message.chat.id}
								${ctx.from.id}`)
		await sendMessageUser(ctx.from.id, answer);
	}
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
	if(ctx.chatJoinRequest.chat.id === monoPiterChatId) {
	await sendMessageUser(ctx.chatJoinRequest.from.id, answer);
	await sendMessageAdminChat(adminChatId, replyRequest, {message_thread_id: lampThreadId, parse_mode: 'HTML'});
	}
});

bot.on(['photo', 'video'], async (ctx) => {
	if (ctx.message.caption && hasMediaHashtag(ctx.message.caption)) {
		if (ctx.message.media_group_id) {
			const messages = await getMediaGroupMessages(ctx, ctx.message.media_group_id);
			await handleMediaGroup(ctx, messages);
		} else {
			await handleSingleMessage(ctx);
		}
	}
	if (ctx.message.chat.type === "private") {
		if (ctx.message.photo) {
			const answer1 = `Ответ от пользователя <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ""}</a>: `;
			await sendMessageAdminChat(adminChatId, answer1, {message_thread_id: lampThreadId, parse_mode: 'HTML'});
			await sendMessageAdminChatPhoto(adminChatId, ctx.message, {message_thread_id: lampThreadId});
		}
	}
});

bot.on('message', async (ctx) => {
	const replyMessage = ctx.message.reply_to_message;
	if (replyMessage && hasMediaHashtag(ctx.message.text)) {
		if (replyMessage.media_group_id) {
			const messages = await getMediaGroupMessages(ctx, replyMessage.media_group_id);
			await handleMediaGroup(ctx, messages);
		} else {
			await handleSingleMessage(ctx);
		}
	}
	
	if (ctx.message.chat.type === "private") {
			if (ctx.message.text && ctx.message.chat.type === "private") {
			const answer2 = `Ответ от пользователя <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name ? ctx.message.from.last_name : ""}</a>: ${ctx.message.text}`;
			await sendMessageAdminChat(adminChatId, answer2, {
				caption: ctx.message.caption,
				message_thread_id: lampThreadId,
				parse_mode: 'HTML'
			});
		}
	}
});
bot.launch();

