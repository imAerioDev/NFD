const TOKEN = ENV_BOT_TOKEN
const WEBHOOK = '/endpoint'
const SECRET = ENV_BOT_SECRET
const ADMIN_UID = ENV_ADMIN_UID

const NOTIFY_INTERVAL = 3600 * 1000
const fraudDb = 'https://raw.githubusercontent.com/imAerioDev/NFD/refs/heads/main/fraud.db'
const notificationUrl = 'https://raw.githubusercontent.com/imAerioDev/NFD/refs/heads/main/notification.txt'
const startMsgUrl = 'https://raw.githubusercontent.com/imAerioDev/NFD/refs/heads/main/startMessage.md'

const enable_notification = true

function apiUrl(methodName, params = null) {
  let query = ''
  if (params) {
    query = '?' + new URLSearchParams(params).toString()
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}

function requestTelegram(methodName, body, params = null) {
  return fetch(apiUrl(methodName, params), body)
    .then(r => r.json())
}

function makeReqBody(body) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  }
}

function sendMessage(msg = {}) {
  return requestTelegram('sendMessage', makeReqBody(msg))
}

function copyMessage(msg = {}) {
  return requestTelegram('copyMessage', makeReqBody(msg))
}

function forwardMessage(msg) {
  return requestTelegram('forwardMessage', makeReqBody(msg))
}

addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event))
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event))
  } else {
    event.respondWith(new Response('No handler for this request'))
  }
})

async function handleWebhook(event) {
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 })
  }
  const update = await event.request.json()
  event.waitUntil(onUpdate(update))
  return new Response('Ok')
}

async function onUpdate(update) {
  if ('message' in update) {
    await onMessage(update.message)
  }
}

async function onMessage(message) {
  if (message.text === '/start') {
    let startMsg = await fetch(startMsgUrl).then(r => r.text())
    return sendMessage({
      chat_id: message.chat.id,
      text: startMsg,
    })
  }
  if (message.chat.id.toString() === ADMIN_UID) {
    if (!message?.reply_to_message?.chat) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '发送失败。'
      })
    }
    if (/^\/block$/.exec(message.text)) {
      return handleBlock(message)
    }
    if (/^\/unblock$/.exec(message.text)) {
      return handleUnBlock(message)
    }
    if (/^\/checkblock$/.exec(message.text)) {
      return checkBlock(message)
    }
    let guestChantId = await nfd.get('msg-map-' + message?.reply_to_message.message_id, { type: "json" })
    return copyMessage({
      chat_id: guestChantId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    })
  }
  return handleGuestMessage(message)
}

async function handleGuestMessage(message) {
  let chatId = message.chat.id
  let isblocked = await nfd.get('isblocked-' + chatId, { type: "json" })
  if (isblocked) {
    return sendMessage({
      chat_id: chatId,
      text: 'Your are blocked'
    })
  }
  let forwardReq = await forwardMessage({
    chat_id: ADMIN_UID,
    from_chat_id: message.chat.id,
    message_id: message.message_id
  })
  console.log(JSON.stringify(forwardReq))
  if (forwardReq.ok) {
    await nfd.put('msg-map-' + forwardReq.result.message_id, chatId)
  }
  return handleNotify(message)
}

async function handleNotify(message) {
  let chatId = message.chat.id
  if (await isFraud(chatId)) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: `检测到骗子，UID${chatId}`
    })
  }
  if (enable_notification) {
    let lastMsgTime = await nfd.get('lastmsg-' + chatId, { type: "json" })
    if (!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL) {
      await nfd.put('lastmsg-' + chatId, Date.now())
      return sendMessage({
        chat_id: ADMIN_UID,
        text: await fetch(notificationUrl).then(r => r.text())
      })
    }
  }
}

async function handleBlock(message) {
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" })
  if (guestChantId === ADMIN_UID) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '不能屏蔽自己'
    })
  }
  await nfd.put('isblocked-' + guestChantId, true)
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId}屏蔽成功`,
  })
}

async function handleUnBlock(message) {
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" })
  await nfd.put('isblocked-' + guestChantId, false)
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId}解除屏蔽成功`,
  })
}

async function checkBlock(message) {
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" })
  let blocked = await nfd.get('isblocked-' + guestChantId, { type: "json" })
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId}` + (blocked ? '被屏蔽' : '没有被屏蔽')
  })
}

async function sendPlainText(chatId, text) {
  return sendMessage({
    chat_id: chatId,
    text
  })
}

async function registerWebhook(event, requestUrl, suffix, secret) {
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

async function unRegisterWebhook(event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

async function isFraud(id) {
  id = id.toString()
  let db = await fetch(fraudDb).then(r => r.text())
  let arr = db.split('\n').filter(v => v)
  console.log(JSON.stringify(arr))
  let flag = arr.filter(v => v === id).length !== 0
  console.log(flag)
  return flag
}