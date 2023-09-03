const { Telegraf } = require("telegraf");
require("dotenv").config();


const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// let messageCount2 = 0;
// let messageCount3 = 0;
// let messageCount4 = 0;

// bot.on('text', async (ctx) => {
//   console.log(ctx.message)
//   console.log(messageCount4)
//     switch(ctx.message.message_thread_id) {
//       case 2:
//         messageCount2 += 1
//         break;
//       case 3:
//         messageCount3 += 1
//         break;
//        case 17394:
//          messageCount4 += 1
//          break;
//     }
//     if(messageCount2 === 5) {
//       ctx.reply('5', {message_thread_id: 2})
//       messageCount2 = 0
//     }
//     if(messageCount3 === 5) {
//       ctx.reply('5', {message_thread_id: 3})
//       messageCount3 = 0
//     }
//      if(messageCount4 === 2) {
//        ctx.telegram.sendMessage(-1001295808191, 'ой', {message_thread_id: 17394})
//        messageCount4 = 0
//      }
// });
//bot.on('text', async(ctx)=> console.log(ctx.message))
//[Профиль](tg://user?id=${ctx.chatJoinRequest.from.id})

bot.on('chat_join_request', async (ctx)=>{
  console.log(ctx.chatJoinRequest.from)
  const replyRequest = `
  ${ctx.chatJoinRequest.from.first_name} подал(а) заявку на вступление
  ID: <a href="tg://user?id=${ctx.chatJoinRequest.from.id}">${ctx.chatJoinRequest.from.id}</a>
  Логин: ${ctx.chatJoinRequest.from.username?`@${ctx.chatJoinRequest.from.username}`: 'нету' }
  Имя: ${ctx.chatJoinRequest.from.first_name}
  Язык юзера: ${ctx.chatJoinRequest.from.language_code}
  <a href="tg://user?id=${ctx.chatJoinRequest.from.id}">Профиль</a>
  `
  ctx.telegram.sendMessage(-1001295808191, replyRequest, {message_thread_id: 17137, parse_mode:'HTML'})
  //ctx.telegram.sendMessage(-1001959551535, replyRequest, {message_thread_id: 2, parse_mode:'MarkdownV2'})
})

bot.launch()
 
