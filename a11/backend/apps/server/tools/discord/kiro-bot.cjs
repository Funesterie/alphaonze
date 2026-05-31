#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  Events,
  GatewayIntentBits,
  Partials
} = require("discord.js");

const DEFAULT_PREFIX = "\u26a1";
const MAX_BODY_LENGTH = 2800;
const SECRET_ASSIGNMENT_RE =
  /(api[_-]?key|secret|password|passwd|pwd|token|private[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|authorization|bearer|webhook)\s*[:=]/i;

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

const agentStateDir = env("AGENT_STATE_DIR", "D:\\agent-bus");
const channelId = env("DISCORD_CHANNEL_ID");
const prefix = env("DISCORD_TASK_PREFIX", DEFAULT_PREFIX);
const tasksFile = path.join(agentStateDir, "discord-tasks.jsonl");
const statusFile = path.join(agentStateDir, "discord", "kiro-discord-bot-status.json");

function nowIso() {
  return new Date().toISOString();
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function titleFrom(body) {
  const firstLine = cleanText(body, 160).split("\n").find(Boolean) || "Discord task";
  return firstLine.slice(0, 120);
}

function idFor(message) {
  if (message.id) return `discord-${message.id}`;
  if (crypto.randomUUID) return `discord-${crypto.randomUUID()}`;
  return `discord-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function writeStatus(state, extra = {}) {
  writeJsonAtomic(statusFile, {
    schema: "funesterie.kiro-discord-bot-status.v1",
    updatedAt: nowIso(),
    pid: process.pid,
    state,
    agentStateDir,
    tasksFile,
    channelConfigured: Boolean(channelId),
    prefixConfigured: Boolean(prefix),
    ...extra
  });
}

function extractTaskBody(content) {
  const text = cleanText(content, MAX_BODY_LENGTH + prefix.length + 32);
  if (!text.startsWith(prefix)) return "";
  return cleanText(text.slice(prefix.length), MAX_BODY_LENGTH);
}

async function safeReply(message, text) {
  try {
    await message.reply({ content: text, allowedMentions: { repliedUser: false } });
  } catch (error) {
    console.error(`[kiro-discord-bot] reply failed: ${error?.message || error}`);
  }
}

const token = env("DISCORD_BOT_TOKEN");
if (!token) {
  writeStatus("missing-token");
  console.error("[kiro-discord-bot] missing DISCORD_BOT_TOKEN");
  process.exit(2);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, (readyClient) => {
  writeStatus("ready", {
    botUser: readyClient.user?.tag || "unknown"
  });
  console.log(`[kiro-discord-bot] ready as ${readyClient.user?.tag || "unknown"}`);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author?.bot || message.webhookId) return;
    if (channelId && message.channelId !== channelId) return;

    const body = extractTaskBody(message.content);
    if (!body) return;

    if (SECRET_ASSIGNMENT_RE.test(body)) {
      writeStatus("secret-like-message-rejected", { lastRejectedAt: nowIso() });
      await safeReply(message, "Refuse: ce message ressemble a un secret. Je ne le depose pas dans le bus.");
      return;
    }

    const task = {
      schema: "funesterie.discord_task.v1",
      at: nowIso(),
      id: idFor(message),
      from: message.author?.username || message.author?.id || "discord-user",
      title: titleFrom(body),
      body,
      status: "open",
      discordMessageId: message.id,
      channelId: message.channelId,
      guildId: message.guildId,
      replyMode: "discord-direct",
      source: "kiro-discord-bot"
    };

    appendJsonl(tasksFile, task);
    writeStatus("task-written", {
      lastTaskId: task.id,
      lastTaskAt: task.at,
      lastChannelId: task.channelId
    });
    await safeReply(message, "Recu. Tache deposee dans le bus Funesterie.");
  } catch (error) {
    writeStatus("error", { error: String(error?.message || error).slice(0, 300) });
    console.error(`[kiro-discord-bot] message handler failed: ${error?.stack || error}`);
  }
});

client.on(Events.Error, (error) => {
  writeStatus("client-error", { error: String(error?.message || error).slice(0, 300) });
  console.error(`[kiro-discord-bot] client error: ${error?.message || error}`);
});

async function shutdown(signal) {
  writeStatus("stopping", { signal });
  try {
    await client.destroy();
  } finally {
    writeStatus("stopped", { signal });
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

writeStatus("starting");
client.login(token).catch((error) => {
  writeStatus("login-failed", { error: String(error?.message || error).slice(0, 300) });
  console.error(`[kiro-discord-bot] login failed: ${error?.message || error}`);
  process.exit(1);
});
