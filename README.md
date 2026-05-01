# kiro-headless-telegram-bot

Bot that forwards messages to [Kiro CLI](https://kiro.dev/docs/cli/) running in **headless mode** — with conversation memory that persists across sessions, OpenClaw-style. Supports **Telegram** and **Signal** (via signal-cli), running one or both simultaneously.

## Features

- **Dual-channel** — Connect via Telegram, Signal, or both at once
- **Conversation continuity** — Each message continues the current conversation (via `--resume`), so Kiro remembers everything said in the current chat
- **Long-term memory** — Important facts are stored in `MEMORY.md` and recalled across new conversations
- **Per-user isolation** — Each user gets their own workspace and memory (keyed by Telegram ID or phone number)
- **Voice messages** — Optional transcription via Groq Whisper (both channels)
- **Bot commands** — Telegram: `/new`, `/memory`, `/clear`, `/sessions`, `/help` · Signal: `!new`, `!memory`, `!clear`, `!sessions`, `!help`

## Prerequisites

- Node.js 18+
- [Kiro CLI v2](https://kiro.dev/docs/cli/) installed, Pro license active, and API key generated
- Kiro API key ([generate one](https://app.kiro.dev)) — requires Pro/Pro+/Power subscription
- **For Telegram:** Bot token from [@BotFather](https://t.me/BotFather)
- **For Signal:** [signal-cli](https://github.com/AsamK/signal-cli) installed and registered with a phone number
- Optional: Groq API key for voice transcription

## Quick Start

```bash
cp .env_example .env   # then fill in your values
npm install
npm start
```

Configure `TELEGRAM_BOT_TOKEN` for Telegram, `SIGNAL_ACCOUNT` for Signal, or both.

## How it works

```
Telegram ─┐
           ├──→ Node.js server ──→ kiro-cli chat --resume --no-interactive ──→ response ──→ channel
Signal  ──┘
```

### Memory architecture

Two **memory.md** files serve different purposes:

- `MEMORY.md` — Long-term memory file. Kiro reads/writes it during conversations to remember things about you. Persists across conversations.
- `.kiro/steering/memory.md` — Steering file with instructions telling Kiro how to use MEMORY.md.

```
workspace/
├── users/
│   ├── <telegram-user-id>/        ← Telegram users keyed by numeric ID
│   │   ├── MEMORY.md
│   │   └── .kiro/steering/memory.md
│   └── signal-<phone-number>/     ← Signal users keyed by phone number
│       ├── MEMORY.md
│       └── .kiro/steering/memory.md
```

## Signal Setup

### 1. Install signal-cli

```bash
# Option A: Download release
wget https://github.com/AsamK/signal-cli/releases/latest/download/signal-cli-0.13.x-Linux.tar.gz
tar xf signal-cli-*.tar.gz
sudo mv signal-cli-0.13.x /opt/signal-cli
sudo ln -s /opt/signal-cli/bin/signal-cli /usr/local/bin/signal-cli

# Option B: via package manager (Arch)
pacman -S signal-cli
```

### 2. Register your phone number

```bash
# Request verification code via SMS
signal-cli -a +491234567890 register

# Or via voice call
signal-cli -a +491234567890 register --voice

# Verify with the code you received
signal-cli -a +491234567890 verify 123-456
```

### 3. Configure .env

```bash
SIGNAL_ACCOUNT=+491234567890
# Optionally restrict who can message the bot:
SIGNAL_ALLOWED_USERS=+491234567890,+441234567890
```

### 4. Signal Commands

Since Signal doesn't have a `/command` menu like Telegram, use `!` prefix:

| Command | Description |
|---------|-------------|
| `!new` | Start a fresh conversation (Kiro reads MEMORY.md for context) |
| `!memory` | Show what Kiro remembers about you |
| `!clear` | Clear long-term memory |
| `!sessions` | List saved chat sessions |
| `!help` | Show available commands |

## Telegram Setup

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token into `.env` as `TELEGRAM_BOT_TOKEN`
4. Get your user ID from [@userinfobot](https://t.me/userinfobot), set as `ALLOWED_USERS`
5. Start a chat with your bot and run `npm start`

### Telegram Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a fresh conversation |
| `/memory` | Show what Kiro remembers about you |
| `/clear` | Clear long-term memory |
| `/sessions` | List saved chat sessions |
| `/help` | Show available commands |

## Voice Messages

Both Telegram and Signal voice notes are transcribed via Groq Whisper. Set `GROQ_API_KEY` in `.env` to enable.

## Deploying as a systemd service

```bash
sudo cp kiro-telegram-bot.service /etc/systemd/system/kiro-bot.service
# Edit the service file to match your paths
sudo systemctl enable --now kiro-bot
```

## Running Both Channels

Simply configure both `TELEGRAM_BOT_TOKEN` and `SIGNAL_ACCOUNT` in your `.env`. The bot will spin up both adapters and handle messages from both channels independently, with per-user workspace isolation.

```
🚀 Kiro Headless Bot starting...
   Workspace: /home/user/kiro-workspace
   Channels: Telegram, Signal
✅ Telegram bot online
✅ Signal bot online

📨 Waiting for messages...
```

## License

MIT-0
