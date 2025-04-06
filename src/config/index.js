/**
 * Конфигурация приложения
 * @module config
 */

require('dotenv').config();

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
  
  // Смайлики для сообщений
  KAOMOJIS: [
    "(* ^ ω ^)", "(´ ∀ ` )", "(o^▽^o)", "(⌒▽⌒)☆", "ヽ(・∀・)ﾉ",
    "(´｡• ω •｡`)", "(o･ω･o)", "(＠＾◡＾)", "(^人^)", "(o´▽`o)",
    "( ´ ω ` )", "(((o(°▽°)o)))", "(´• ω •`)", "(＾▽＾)", "╰(▔∀▔)╯",
    "(─‿‿─)", "(✯◡✯)", "(◕‿◕)", "(⌒‿⌒)", "＼(≧▽≦)／",
    "(*°▽°*)", "٩(｡•́‿•̀｡)۶", "(´｡• ᵕ •｡`)", "( ´ ▽ ` )", "ヽ(>∀<☆)ノ",
    "o(≧▽≦)o", "＼(￣▽￣)／", "(*¯︶¯*)", "(o˘◡˘o)", "\\(★ω★)/",
    "(╯✧▽✧)╯", "o(>ω<)o", "( ‾́ ◡ ‾́ )", "(ﾉ´ヮ`)ﾉ*: ･ﾟ", "(๑˘︶˘๑)",
    "( ˙꒳˙ )", "(´･ᴗ･ ` )", "(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧"
  ],
  
  // Похожие символы (кириллица/латиница) для обхода фильтра слов
  SIMILAR_CHARS: {
    'а': 'a', 'в': 'b', 'с': 'c', 'е': 'e', 'н': 'h',
    'к': 'k', 'м': 'm', 'о': 'o', 'р': 'p', 'т': 't',
    'х': 'x', 'у': 'y',
  }
};

module.exports = config;