# kiro-headless-telegram-bot

Telegram bot that forwards messages to [Kiro CLI](https://kiro.dev/docs/cli/) running in **headless mode**. Each Telegram message becomes a `kiro-cli chat --no-interactive --trust-all-tools "prompt"` invocation against your workspace.

## Prerequisites

- Node.js 18+
- [Kiro CLI](https://kiro.dev/docs/cli/) installed
- Kiro API key ([generate one](https://app.kiro.dev)) — requires Pro/Pro+/Power subscription
- Telegram bot token from [@BotFather](https://t.me/BotFather)

## Setup

```bash
cp .env.example .env   # then fill in your values
npm install
npm start
```

## How it works

```
Telegram → Node.js server → kiro-cli chat --no-interactive → response → Telegram
```

No ACP protocol, no JSON-RPC, no streaming — just a simple CLI invocation per message.

## Voice messages

Optional voice transcription via Groq Whisper. Set `GROQ_API_KEY` in `.env` to enable.

## Deploying as a systemd service

```bash
sudo cp kiro-telegram-bot.service /etc/systemd/system/
sudo systemctl enable --now kiro-telegram-bot
```
