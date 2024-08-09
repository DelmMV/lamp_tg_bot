const { Telegraf } = require("telegraf");
const { MongoClient, ObjectId } = require('mongodb');
const russianWordsBan = require("./words.json");
const haversine = require('haversine-distance');

require("dotenv").config();
//
// //Тестовая -1001959551535  message_thread_id: 2
// //id чата админов -1001295808191 message_thread_id: 17137
//
// //thread media  message_thread_id: 327902
// //id chat монопитер -1001405911884

//
// Constants
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MONGO_URL = 'mongodb://localhost:27017';
const DB_NAME = 'telegramBot';
const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT);
const MONO_PITER_CHAT_ID = parseInt(process.env.MONOPITER_CHAT);
const LAMP_THREAD_ID = parseInt(process.env.MESSAGE_THREAD_ID_ADMIN_CHAT);
const MEDIA_THREAD_ID = parseInt(process.env.MESSAGE_THREAD_ID_MONOPITER_CHAT);
//const URL_COMMENTS = process.env.URL_COMMENTS;

const MIN_DISTANCE_THRESHOLD = 20; // Порог для фильтрации небольших перемещений в метрах
const MAX_DISTANCE_THRESHOLD = 500; // Порог для начала новой сессии в метрах

// Initialize bot and database connection
const bot = new Telegraf(BOT_TOKEN);
let db;

// Kaomoji list
const KAOMOJIS = [
	"(* ^ ω ^)", "(´ ∀ ` )", "(o^▽^o)", "(⌒▽⌒)☆", "ヽ(・∀・)ﾉ",
	"(´｡• ω •｡`)", "(o･ω･o)", "(＠＾◡＾)", "(^人^)", "(o´▽`o)",
	"( ´ ω ` )", "(((o(°▽°)o)))", "(´• ω •`)", "(＾▽＾)", "╰(▔∀▔)╯",
	"(─‿‿─)", "(✯◡✯)", "(◕‿◕)", "(⌒‿⌒)", "＼(≧▽≦)／",
	"(*°▽°*)", "٩(｡•́‿•̀｡)۶", "(´｡• ᵕ •｡`)", "( ´ ▽ ` )", "ヽ(>∀<☆)ノ",
	"o(≧▽≦)o", "＼(￣▽￣)／", "(*¯︶¯*)", "(o˘◡˘o)", "\\(★ω★)/",
	"(╯✧▽✧)╯", "o(>ω<)o", "( ‾́ ◡ ‾́ )", "(ﾉ´ヮ`)ﾉ*: ･ﾟ", "(๑˘︶˘๑)",
	"( ˙꒳˙ )", "(´･ᴗ･ ` )", "(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧"
];

// Helper Functions
const bannedWords = russianWordsBan.russianWordsBan.map(entry => entry.word);

const similarChars = {
	'а': 'a', 'в': 'b', 'с': 'c', 'е': 'e', 'н': 'h',
	'к': 'k', 'м': 'm', 'о': 'o', 'р': 'p', 'т': 't',
	'х': 'x', 'у': 'y',
};

function createRegexPattern(word) {
	return word.split('').map(char => {
		if (char in similarChars) {
			return `[${char}${similarChars[char]}]`;
		} else if (Object.values(similarChars).includes(char)) {
			const cyrillicChar = Object.keys(similarChars).find(key => similarChars[key] === char);
			return `[${char}${cyrillicChar}]`;
		}
		return char;
	}).join('[.\\s]*');
}

function containsForbiddenWords(text) {
	if (typeof text !== 'string') {
		return false;
	}
	
	const lowerCaseText = text.toLowerCase();
	
	for (const word of bannedWords) {
		const pattern = createRegexPattern(word);
		const regex = new RegExp(`(^|[^а-яёa-z])${pattern}($|[^а-яёa-z])`, 'i');
		
		if (regex.test(lowerCaseText)) {
			return true;
		}
	}
	
	return false;
}

const getRandomKaomoji = () => KAOMOJIS[Math.floor(Math.random() * KAOMOJIS.length)];

const sendTelegramMessage = async (chatId, message, options = {}) => {
	try {
		return await bot.telegram.sendMessage(chatId, message, options);
	} catch (error) {
		console.error('Error sending message:', error);
	}
};

const sendTelegramMedia = async (chatId, content, options = {}) => {
	try {
		return await bot.telegram.sendCopy(chatId, content, options);
	} catch (error) {
		console.error('Error sending media:', error);
	}
};

const hasMediaHashtag = (text) => text && (text.includes('#media') || text.includes('#медиа'));

// Database Functions
const connectToDatabase = async () => {
	try {
		const client = new MongoClient(MONGO_URL);
		await client.connect();
		db = client.db(DB_NAME);
		db = client.db("geolocation_db");
		console.log("Connected to MongoDB");
	} catch (error) {
		console.error("MongoDB connection error:", error);
		process.exit(1);
	}
};

// const insertMedia = async (mediaMessage) => {
// 	const mediaCollection = db.collection('media');
// 	return await mediaCollection.insertOne(mediaMessage);
// };

// Message Handlers
const handleMediaGroup = async (ctx, messages) => {
	try {
		//const result = await insertMedia(ctx.message);
		
		const media = messages
				.map(message => {
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
					return null;
				})
				.filter(Boolean);
		
		if (media.length > 0) {
			await ctx.telegram.sendMediaGroup(MONO_PITER_CHAT_ID, media, { message_thread_id: MEDIA_THREAD_ID });
			await sendTelegramMessage(MONO_PITER_CHAT_ID,
					`https://t.me/${ctx.message.chat.username}/${ctx.message.message_thread_id}/${ctx.message.message_id}`,
					{
						message_thread_id: MEDIA_THREAD_ID,
						// reply_markup: {
						// 	inline_keyboard: [[{ text: 'Прокомментировать', url: `${URL_COMMENTS}${result.insertedId}` }]]
						// }
					}
			);
		}
	} catch (error) {
		console.error('Error handling media group:', error);
	}
};

const handleSingleMessage = async (ctx) => {
	try {
		//const result = await insertMedia(ctx.message);
		const { chat: { username }, message_id, message_thread_id, caption, text, photo, video } = ctx.message;
		
		const mediaOptions = {
			message_thread_id: MEDIA_THREAD_ID,
			caption: `
        ${getRandomKaomoji()}
        ${caption || text || ''}
        https://t.me/${username}/${message_thread_id}/${message_id}
      `,
			// reply_markup: {
			// 	inline_keyboard: [[{ text: 'Прокомментировать', url: `${URL_COMMENTS}${result.insertedId}` }]]
			// }
		};
		if (photo) {
			await ctx.telegram.sendPhoto(MONO_PITER_CHAT_ID, photo[photo.length - 1].file_id, mediaOptions);
		} else if (video) {
			await ctx.telegram.sendVideo(MONO_PITER_CHAT_ID, video.file_id, mediaOptions);
		}
		if (ctx.message.reply_to_message.photo) {
			const photo = ctx.message.reply_to_message.photo
			await ctx.telegram.sendPhoto(MONO_PITER_CHAT_ID, photo[photo.length - 1].file_id, mediaOptions);
		} else if (ctx.message.reply_to_message.video) {
			const video = ctx.message.reply_to_message.video;
			await ctx.telegram.sendVideo(MONO_PITER_CHAT_ID, video.file_id, mediaOptions);
		}
	} catch (error) {
		console.error('Error handling single media:', error);
	}
};

// Bot Commands
bot.command('delete', async (ctx) => {
	if (ctx.message.chat.id !== ADMIN_CHAT_ID) return;
	
	const [, commentId] = ctx.message.text.split(' ');
	if (!commentId) return await ctx.reply('Неверный формат команды. Используйте /delete <commentId>');
	
	try {
		const commentsCollection = db.collection('comments');
		const result = await commentsCollection.deleteOne({ _id: new ObjectId(commentId) });
		await ctx.reply(result.deletedCount === 1
				? `Комментарий с ID ${commentId} успешно удален.`
				: `Комментарий с ID ${commentId} не найден.`);
	} catch (error) {
		console.error('Error deleting comment:', error);
		await ctx.reply('Произошла ошибка при удалении комментария.');
	}
});

bot.command('alarm', async (ctx) => {
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
  `;
	
	await sendTelegramMessage(ADMIN_CHAT_ID, message, { message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' });
	await ctx.reply('Ваш тревожный сигнал отправлен администратору.');
});

// Event Handlers
bot.on('new_chat_members', async (ctx) => {
	const { from, new_chat_member } = ctx.message;
	const isInvited = from.id !== new_chat_member.id;
	
	const message = isInvited
			? `<a href="tg://user?id=${from.id}">${from.first_name} ${from.last_name || ""}</a> принял в группу <a href="tg://user?id=${new_chat_member.id}">${new_chat_member.first_name} ${new_chat_member.last_name || ""}</a>`
			: `<a href="tg://user?id=${from.id}">${from.first_name} ${from.last_name || ""}</a> принят(а) в группу`;
	
	if (ctx.message.chat.id === MONO_PITER_CHAT_ID) {
		console.log(`add new user  ${new_chat_member.first_name}`)
		await sendTelegramMessage(ADMIN_CHAT_ID, message, { message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' });
		await sendTelegramMessage(from.id, `${new_chat_member.first_name}${new_chat_member.last_name || ""}, добро пожаловать в наш чат!`);
	}
});

bot.on('chat_join_request', async (ctx) => {
	const { from } = ctx.chatJoinRequest;
	if (ctx.chatJoinRequest.chat.id !== MONO_PITER_CHAT_ID) return;
	
	const adminMessage = `
    ${from.first_name} подал(а) заявку на вступление
    ID: <a href="tg://user?id=${from.id}">${from.id}</a>
    Логин: ${from.username ? `@${from.username}` : 'нету'}
    Имя: ${from.first_name} ${from.last_name || ""}
    Язык юзера: ${from.language_code}
  `;
	
	const userMessage = `
    Привет! Получили от тебя заявку на вступление в сообщество МоноПитер ( t.me/eucriders ).
    Такие заявки мы проверяем на ботов.
    Если уже есть моноколесо, то напиши в ответ, какое! Можешь приложить его фото ))
    Ещё без колеса? Тогда расскажи, что привело тебя к нам? В нашем сообществе всегда помогут с выбором, обучением и вопросами обслуживания.

    Не будет ответа на это сообщение в течение суток - придётся отклонить заявку.
    Но если что, после отклонения заявку можно подать повторно!

    В ожидании одобрения, предлагаю ознакомиться с правилами/ценностями нашего сообщества: https://t.me/eucriders/287907/403321
    Спасибо за понимание!
  `;
	console.log(`new request  ${from.first_name}`)
	await sendTelegramMessage(from.id, userMessage);
	await sendTelegramMessage(ADMIN_CHAT_ID, adminMessage, { message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' });
});

bot.on('location', async (ctx) => {
	const location = ctx.message.location;
	const userId = ctx.message.from.id;
	const username = ctx.message.from.username || `${ctx.message.from.first_name} ${ctx.message.from.last_name}`;
	const timestamp = ctx.message.date;
	
	const entry = {
		userId,
		username,
		timestamp,
		latitude: location.latitude,
		longitude: location.longitude,
		sessionId: null // Временное значение
	};
	
	const collection = db.collection('locations');
	const lastLocation = await collection.find({ userId }).sort({ timestamp: -1 }).limit(1).toArray();
	
	if (lastLocation.length > 0) {
		const lastEntry = lastLocation[0];
		const distance = haversine(
				{ lat: lastEntry.latitude, lon: lastEntry.longitude },
				{ lat: entry.latitude, lon: entry.longitude }
		);
		
		if (distance < MIN_DISTANCE_THRESHOLD) {
			return; // Игнорируем перемещение
		}
		
		if (distance > MAX_DISTANCE_THRESHOLD) {
			entry.sessionId = lastEntry.sessionId + 1;
		} else {
			entry.sessionId = lastEntry.sessionId;
		}
	} else {
		entry.sessionId = 1;
	}
	await collection.insertOne(entry);
});


bot.on('edited_message', async (ctx) => {
	if (ctx.editedMessage.location) {
		const location = ctx.editedMessage.location;
		const userId = ctx.editedMessage.from.id;
		const timestamp = ctx.editedMessage.edit_date;
		const username = ctx.editedMessage.from.username || `${ctx.editedMessage.from.first_name} ${ctx.editedMessage.from.last_name}`;
		
		const entry = {
			userId,
			username,
			timestamp,
			latitude: location.latitude,
			longitude: location.longitude,
			sessionId: null // Временное значение
		};
		
		const collection = db.collection('locations');
		const lastLocation = await collection.find({ userId }).sort({ timestamp: -1 }).limit(1).toArray();
		
		if (lastLocation.length > 0) {
			const lastEntry = lastLocation[0];
			const distance = haversine(
					{ lat: lastEntry.latitude, lon: lastEntry.longitude },
					{ lat: entry.latitude, lon: entry.longitude }
			);
			
			// Фильтрация маленьких перемещений
			if (distance < MIN_DISTANCE_THRESHOLD) {
				return; // Игнорируем перемещение
			}
			
			// Если расстояние больше определенного порога, начинаем новую сессию
			if (distance > MAX_DISTANCE_THRESHOLD) {
				entry.sessionId = lastEntry.sessionId + 1;
			} else {
				entry.sessionId = lastEntry.sessionId;
			}
		} else {
			entry.sessionId = 1;
		}
		await collection.insertOne(entry);
	}
});

async function calculateStats(userId) {
	const collection = db.collection('locations');
	const oneWeekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
	const locations = await collection.find({ userId, timestamp: { $gte: oneWeekAgo } }).sort({ sessionId: 1, timestamp: 1 }).toArray();
	
	if (locations.length < 2) return { distance: 0, speed: 0 };
	
	let totalDistance = 0;
	let totalTime = 0;
	let lastSessionId = locations[0].sessionId;
	
	for (let i = 1; i < locations.length; i++) {
		const prev = locations[i - 1];
		const curr = locations[i];
		
		if (curr.sessionId !== lastSessionId) {
			lastSessionId = curr.sessionId;
			continue; // Началась новая сессия, пропускаем
		}
		
		const dist = haversine(
				{ lat: prev.latitude, lon: prev.longitude },
				{ lat: curr.latitude, lon: curr.longitude }
		);
		totalDistance += dist;
		
		const timeDiff = curr.timestamp - prev.timestamp;
		totalTime += timeDiff;
	}
	
	const avgSpeed = (totalDistance / 1000) / (totalTime / 3600); // Средняя скорость в км/ч
	return { distance: totalDistance / 1000, speed: avgSpeed }; // Пройденное расстояние тоже переводим в километры
}


bot.command('stats', async (ctx) => {
	const userId = ctx.message.from.id;
	const stats = await calculateStats(userId);
	
	ctx.reply(`За последнюю неделю вы проехали ${stats.distance.toFixed(2)} км со средней скоростью ${stats.speed.toFixed(2)} км/ч.`);
});

async function getTop10Users() {
	const collection = db.collection('locations');
	
	// Получаем уникальные userId и username из базы данных
	const uniqueUsers = await collection.aggregate([
		{
			$group: {
				_id: "$userId",
				username: { $first: "$username" } // Берем первый сохраненный ник для каждого пользователя
			}
		}
	]).toArray();
	
	const userDistances = [];
	
	// Для каждого уникального пользователя рассчитываем пробег
	for (const user of uniqueUsers) {
		const stats = await calculateStats(user._id);
		userDistances.push({
			userId: user._id,
			username: user.username,
			distance: stats.distance
		});
	}
	
	// Сортируем пользователей по пройденному расстоянию
	userDistances.sort((a, b) => b.distance - a.distance);
	
	// Берем топ-10 пользователей
	return userDistances.slice(0, 10);
}


bot.command('top10', async (ctx) => {
	const top10 = await getTop10Users();
	
	let response = "🏆 Топ 10 пользователей по пробегу за неделю:\n\n";
	
	top10.forEach((user, index) => {
		response += `${index + 1}. ${user.username}: ${user.distance.toFixed(2)} км\n`;
	});
	
	ctx.reply(response);
});


bot.on(['photo', 'video'], async (ctx) => {
	if (ctx.message.caption && hasMediaHashtag(ctx.message.caption)) {
		if (ctx.message.media_group_id) {
			const messages = await ctx.telegram.getUpdates({
				allowed_updates: ['message'],
				limit: 50
			}).then(res => res
					.map(update => update.message.text ? update.message.reply_to_message : update.message)
					.filter(message => message.media_group_id === ctx.message.media_group_id)
			);
			await handleMediaGroup(ctx, messages);
		} else {
			await handleSingleMessage(ctx);
		}
	}
	
	if (ctx.message.chat.type === "private" && ctx.message.photo) {
		const answer = `Ответ от пользователя <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name || ""}</a>: `;
		await sendTelegramMessage(ADMIN_CHAT_ID, answer, { message_thread_id: LAMP_THREAD_ID, parse_mode: 'HTML' });
		await sendTelegramMedia(ADMIN_CHAT_ID, ctx.message, { message_thread_id: LAMP_THREAD_ID });
	}
});

bot.on('message', async (ctx) => {
	const messageText = ctx.message.text;
	const replyMessage = ctx.message.reply_to_message;
	const answer = `В <a href="https://t.me/${ctx.message.chat.username}/${ctx.message.message_thread_id}/${ctx.message.message_id}">сообщении</a> от <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name || ""}</a> обноружены не допустимые слова!`;
	
	if (!messageText) return;
	
	if(ctx.message.chat.id === MONO_PITER_CHAT_ID) {
		try {
			if (containsForbiddenWords(messageText)) {
				await ctx.reply('Ваше сообщение содержит не допустимые слова. Пожалуйста соблюдайте культуру общения нашего сообщества.', {reply_to_message_id: ctx.message.message_id});
				await sendTelegramMessage(ADMIN_CHAT_ID, answer, {
					message_thread_id: LAMP_THREAD_ID,
					parse_mode: 'HTML'
				});
			}
		} catch (error) {
			console.error('Ошибка при обработке сообщения:', error);
		}
	}
	
	if (replyMessage && hasMediaHashtag(ctx.message.text)) {
		if (replyMessage.media_group_id) {
			const messages = await ctx.telegram.getUpdates({
				allowed_updates: ['message'],
				limit: 50
			}).then(res => res
					.map(update => update.message.text ? update.message.reply_to_message : update.message)
					.filter(message => message.media_group_id === replyMessage.media_group_id)
			);
			await handleMediaGroup(ctx, messages);
		} else {
			await handleSingleMessage(ctx);
		}
	}
	
	if (ctx.message.chat.type === "private" && ctx.message.text) {
		const answer = `Ответ от пользователя <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name || ""}</a>: ${ctx.message.text}`;
		await sendTelegramMessage(ADMIN_CHAT_ID, answer, {
			caption: ctx.message.caption,
			message_thread_id: LAMP_THREAD_ID,
			parse_mode: 'HTML'
		});
	}
});

// Start the bot
(async () => {
	await connectToDatabase();
	bot.launch();
	console.log('Bot is running');
})();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));



