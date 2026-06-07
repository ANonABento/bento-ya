/**
 * KaitenCode Discord sidecar.
 *
 * A thin discord.js process driven by the Rust `DiscordBridge` over a
 * newline-delimited JSON protocol on stdin/stdout. The Rust side owns all
 * policy (which task maps to which thread, when to post); this process only
 * executes Discord operations and reports results/events.
 *
 * Protocol (one JSON object per line):
 *   Rust → Node  (command):  { "id": "<uuid>", "type": "<cmd>", "payload": {…} }
 *   Node → Rust  (response): { "id": "<uuid>", "success": true, "data": {…} }
 *                            { "id": "<uuid>", "success": false, "error": "…" }
 *   Node → Rust  (event):    { "event": "ready|error|disconnect|message", "payload": {…} }
 *
 * Commands: connect {token}, disconnect, ping,
 *           create_thread {channelId, name, autoArchiveMinutes?},
 *           post_message {channelId|threadId, content}.
 *
 * MVP is one-direction (KaitenCode → Discord); `message` events are emitted but
 * not yet consumed by Rust (reply-routing is a later slice).
 */

import { createInterface } from 'node:readline'
import { Client, GatewayIntentBits, ChannelType } from 'discord.js'

let client = null

/** Write a single newline-delimited JSON line to stdout. */
function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function emit(event, payload = {}) {
  out({ event, payload })
}

function ok(id, data = {}) {
  out({ id, success: true, data })
}

function fail(id, error) {
  out({ id, success: false, error: String(error && error.message ? error.message : error) })
}

/** discord.js Channel for either a text channel or a thread, fetched by id. */
async function fetchSendable(channelId) {
  if (!client) throw new Error('not connected')
  const ch = await client.channels.fetch(channelId)
  if (!ch || typeof ch.send !== 'function') {
    throw new Error(`channel ${channelId} is not sendable`)
  }
  return ch
}

async function handleConnect(payload) {
  if (client) {
    try { await client.destroy() } catch { /* ignore */ }
    client = null
  }
  const token = payload && payload.token
  if (!token) throw new Error('missing token')

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  })

  // Resolve `connect` only once the gateway is ready, returning the bot
  // identity — so the Rust side gets a clean request/response it can surface as
  // "connected as <tag>".
  const ready = new Promise((resolve) => {
    client.once('ready', () => {
      const info = { tag: client.user ? client.user.tag : null, id: client.user ? client.user.id : null }
      emit('ready', info)
      resolve(info)
    })
  })
  client.on('error', (err) => { emit('error', { message: String(err && err.message ? err.message : err) }) })
  client.on('shardDisconnect', () => { emit('disconnect', {}) })
  client.on('messageCreate', (msg) => {
    if (msg.author && msg.author.bot) return // ignore our own + other bots
    emit('message', {
      messageId: msg.id,
      channelId: msg.channelId,
      content: msg.content,
      authorTag: msg.author ? msg.author.tag : null,
      authorId: msg.author ? msg.author.id : null,
      isThread: typeof msg.channel?.isThread === 'function' ? msg.channel.isThread() : false,
    })
  })

  await client.login(token) // validates the token + opens the gateway
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timed out waiting for gateway ready')), 15000),
  )
  return Promise.race([ready, timeout])
}

async function handleDisconnect() {
  if (client) {
    try { await client.destroy() } catch { /* ignore */ }
    client = null
  }
  return { disconnected: true }
}

async function handleCreateThread(payload) {
  const { channelId, name, autoArchiveMinutes } = payload || {}
  if (!channelId || !name) throw new Error('create_thread requires channelId and name')
  const channel = await client.channels.fetch(channelId)
  if (!channel || typeof channel.threads?.create !== 'function') {
    throw new Error(`channel ${channelId} cannot host threads`)
  }
  const thread = await channel.threads.create({
    name: name.slice(0, 100), // Discord thread name limit
    autoArchiveDuration: autoArchiveMinutes || 1440,
    type: ChannelType.PublicThread,
  })
  return { threadId: thread.id }
}

async function handlePostMessage(payload) {
  const { channelId, threadId, content } = payload || {}
  const target = threadId || channelId
  if (!target || !content) throw new Error('post_message requires channelId|threadId and content')
  const ch = await fetchSendable(target)
  const sent = await ch.send(content.slice(0, 2000)) // Discord message limit
  return { messageId: sent.id }
}

async function dispatch(cmd) {
  switch (cmd.type) {
    case 'ping': return { pong: true, connected: !!client }
    case 'connect': return handleConnect(cmd.payload)
    case 'disconnect': return handleDisconnect()
    case 'create_thread': return handleCreateThread(cmd.payload)
    case 'post_message': return handlePostMessage(cmd.payload)
    default: throw new Error(`unknown command: ${cmd.type}`)
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let cmd
  try {
    cmd = JSON.parse(trimmed)
  } catch {
    emit('error', { message: `bad JSON command: ${trimmed.slice(0, 120)}` })
    return
  }
  Promise.resolve()
    .then(() => dispatch(cmd))
    .then((data) => ok(cmd.id, data))
    .catch((err) => fail(cmd.id, err))
})

// Clean shutdown when the parent closes our stdin.
rl.on('close', async () => {
  await handleDisconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => { await handleDisconnect(); process.exit(0) })
process.on('SIGINT', async () => { await handleDisconnect(); process.exit(0) })

emit('started', { pid: process.pid })
