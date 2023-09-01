const { Telegraf } = require("telegraf");


const bot = new Telegraf("6225897082:AAHhZ4gVlNovJKpDFHlbbq6yXWYCvBe4mO4");

let messageCount2 = 0;
let messageCount3 = 0;
let messageCount4 = 0;

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

bot.on('chat_join_request', async (ctx)=>{
  console.log(ctx.chatJoinRequest.from)
  const replyRequest = `
  ${ctx.chatJoinRequest.from.first_name} подал(а) заявку на вступление
  Логин: \@${ctx.chatJoinRequest.from.username}
  Имя: ${ctx.chatJoinRequest.from.first_name}
  Язык юзера: ${ctx.chatJoinRequest.from.language_code}
  `
  ctx.telegram.sendMessage(-1001295808191, replyRequest, {message_thread_id: 17137})
})

bot.launch()
 
