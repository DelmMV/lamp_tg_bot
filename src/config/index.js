/**
 * Конфигурация приложения
 * @module config
 */

require('dotenv').config()

/**
 * Константы приложения
 * @type {Object}
 */
const config = {
	// Telegram конфигурация
	BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
	ADMIN_CHAT_ID: parseInt(process.env.ADMIN_CHAT, 10),
	MONO_PITER_CHAT_ID: parseInt(process.env.MONOPITER_CHAT, 10),
	LAMP_THREAD_ID: parseInt(process.env.MESSAGE_THREAD_ID_ADMIN_CHAT, 10),
	MEDIA_THREAD_ID: parseInt(process.env.MESSAGE_THREAD_ID_MONOPITER_CHAT, 10),

	// MongoDB конфигурация
	MONGO_URL: 'mongodb://localhost:27017',
	DB_NAME: 'geolocation_db',

	// Конфигурация авто-отмены заявок
	JOIN_REQUEST: {
		// Время жизни заявки в минутах
		LIFETIME_MINUTES: parseInt(
			process.env.JOIN_REQUEST_LIFETIME_MINUTES || '1440',
			10
		),
		// Частота проверки заявок в минутах
		CHECK_INTERVAL_MINUTES: parseInt(
			process.env.JOIN_REQUEST_CHECK_INTERVAL_MINUTES || '60',
			10
		),
	},

	// Смайлики для сообщений
	KAOMOJIS: [
		'(* ^ ω ^)',
		'(´ ∀ ` )',
		'(o^▽^o)',
		'(⌒▽⌒)☆',
		'ヽ(・∀・)ﾉ',
		'(´｡• ω •｡`)',
		'(o･ω･o)',
		'(＠＾◡＾)',
		'(^人^)',
		'(o´▽`o)',
		'( ´ ω ` )',
		'(((o(°▽°)o)))',
		'(´• ω •`)',
		'(＾▽＾)',
		'╰(▔∀▔)╯',
		'(─‿‿─)',
		'(✯◡✯)',
		'(◕‿◕)',
		'(⌒‿⌒)',
		'＼(≧▽≦)／',
		'(*°▽°*)',
		'٩(｡•́‿•̀｡)۶',
		'(´｡• ᵕ •｡`)',
		'( ´ ▽ ` )',
		'ヽ(>∀<☆)ノ',
		'o(≧▽≦)o',
		'＼(￣▽￣)／',
		'(*¯︶¯*)',
		'(o˘◡˘o)',
		'\\(★ω★)/',
		'(╯✧▽✧)╯',
		'o(>ω<)o',
		'( ‾́ ◡ ‾́ )',
		'(ﾉ´ヮ`)ﾉ*: ･ﾟ',
		'(๑˘︶˘๑)',
		'( ˙꒳˙ )',
		'(´･ᴗ･ ` )',
		'(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧',
	],

	// Похожие символы (кириллица/латиница) для обхода фильтра слов
	SIMILAR_CHARS: {
		а: 'a',
		в: 'b',
		с: 'c',
		е: 'e',
		н: 'h',
		к: 'k',
		м: 'm',
		о: 'o',
		р: 'p',
		т: 't',
		х: 'x',
		у: 'y',
	},
}

module.exports = config
