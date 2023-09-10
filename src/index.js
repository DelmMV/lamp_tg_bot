const { Telegraf, session } = require("telegraf");
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


//
bot.on('message', (ctx) => {
  console.log(ctx.message)
  let answer = `Ответ от пользователя <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name?ctx.message.from.last_name:""}</a>: ${ctx.message.text}`
  if(ctx.message.chat.type === "private") {
    ctx.telegram.sendMessage(-1001295808191, answer, {message_thread_id: 17137, parse_mode:'HTML'})
    //ctx.telegram.sendMessage(-1001959551535, answer, {message_thread_id: 2, parse_mode:'HTML'})
  }
})

bot.on('new_chat_members', async (ctx)=> {
  const replyRequest = `
  <a href="tg://user?id=${ctx.message.from.id}">${ctx.message.from.first_name} ${ctx.message.from.last_name?ctx.message.from.last_name:""}</a> принят(а) в группу
  `
  
  ctx.telegram.sendMessage(-1001295808191, replyRequest, {message_thread_id: 17137, parse_mode:'HTML'})
  //ctx.telegram.sendMessage(-1001959551535, replyRequest, {message_thread_id: 2, parse_mode:'HTML'})
})

bot.on('chat_join_request', async (ctx)=>{

  const replyRequest = `
  ${ctx.chatJoinRequest.from.first_name} подал(а) заявку на вступление
  ID: <a href="tg://user?id=${ctx.chatJoinRequest.from.id}">${ctx.chatJoinRequest.from.id}</a>
  Логин: ${ctx.chatJoinRequest.from.username?`@${ctx.chatJoinRequest.from.username}`: 'нету' }
  Имя: ${ctx.chatJoinRequest.from.first_name} ${ctx.chatJoinRequest.from.last_name?ctx.chatJoinRequest.from.last_name:""}
  Язык юзера: ${ctx.chatJoinRequest.from.language_code}
  <a href="tg://user?id=${ctx.chatJoinRequest.from.id}">Профиль</a>
  `
  const answer = `
  Здравствуйте! Вы направили заявку на вступление в сообщество МоноПитер ( t.me/eucriders ).
    Такие заявки мы проверяем на ботов. Чтобы мы одобрили заявку, прошу написать в ответ, какое у вас моноколесо. Если не будет ответа на это сообщение в течение суток, оставляем за собой право отклонить вашу заявку.
    В ожидании одобрения, предлагаю ознакомиться с правилами/ценностями нашего сообщества: https://t.me/eucriders/287907/365863
    Спасибо за понимание!
  `

  ctx.telegram.sendMessage(ctx.chatJoinRequest.from.id, answer)// Ответ пользователю 

  ctx.telegram.sendMessage(-1001295808191, replyRequest, {message_thread_id: 17137, parse_mode:'HTML'})

  //ctx.telegram.sendMessage(-1001959551535, replyRequest, {message_thread_id: 2, parse_mode:'HTML'})
})

bot.launch()
 
