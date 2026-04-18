# kiro-headless-telegram-bot

Telegram bot that forwards messages to [Kiro CLI](https://kiro.dev/docs/cli/) running in **headless mode** — with conversation memory that persists across sessions, OpenClaw-style.

## Features

- **Conversation continuity** — Each message continues the current conversation (via `--resume`), so Kiro remembers everything said in the current chat
- **Long-term memory** — Important facts are stored in `MEMORY.md` and recalled across new conversations
- **Per-user isolation** — Each Telegram user gets their own workspace and memory
- **Voice messages** — Optional transcription via Groq Whisper
- **Bot commands** — `/new`, `/memory`, `/clear`, `/sessions`, `/help`

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
Telegram → Node.js server → kiro-cli chat --resume --no-interactive → response → Telegram
```

### Memory architecture

```
workspace/
├── users/
│   └── <telegram-user-id>/
│       ├── MEMORY.md              ← Long-term memory (persists across conversations)
│       └── .kiro/
│           └── steering/
│               └── memory.md      ← Instructions for Kiro to maintain MEMORY.md
```

- **Within a conversation**: Kiro's `--resume` flag keeps the full chat history, so it remembers everything said in the current session
- **Across conversations**: When you start a new chat (`/new`), Kiro reads `MEMORY.md` to recall key facts — your name, preferences, projects, and anything you asked it to remember
- **Steering file**: Automatically injected into each user's workspace, teaching Kiro to read and update `MEMORY.md` during conversations

### Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a fresh conversation (Kiro reads MEMORY.md for context) |
| `/memory` | Show what Kiro remembers about you |
| `/clear` | Clear long-term memory |
| `/sessions` | List saved chat sessions |
| `/help` | Show available commands |

## Voice messages

Optional voice transcription via Groq Whisper. Set `GROQ_API_KEY` in `.env` to enable.

## Deploying as a systemd service

```bash
sudo cp kiro-telegram-bot.service /etc/systemd/system/
sudo systemctl enable --now kiro-telegram-bot
```

## Setting up your Telegram bot

1. **Open Telegram** and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts:
   - Choose a **display name** (e.g. "Kiro Assistant")
   - Choose a **username** — must end in `bot` (e.g. `my_kiro_bot`)
3. BotFather will reply with your **bot token** (looks like `123456789:ABCdefGHI...`). Copy it into your `.env` file as `TELEGRAM_BOT_TOKEN`.
4. **Get your Telegram user ID** — send any message to [@userinfobot](https://t.me/userinfobot) and it will reply with your numeric ID. Put it in `ALLOWED_USERS` so only you can use the bot.
5. **Start a chat** with your new bot — search for its username in Telegram and press **Start**.
6. Run `npm start` and send a message — you should get a reply from Kiro!

### Optional: set bot commands in Telegram

The bot registers its commands automatically on startup, but you can also set them manually via BotFather:

1. Send `/setcommands` to @BotFather
2. Select your bot
3. Paste:
   ```
   new - Start a fresh conversation
   memory - Show what Kiro remembers about you
   clear - Clear long-term memory
   sessions - List saved chat sessions
   help - Show available commands
   ```

This makes the commands appear in Telegram's `/` menu when chatting with your bot.
