/**
 * Telegram Adapter — connects Telegram Bot API to Kiro headless client.
 *
 * Supports:
 *   - Per-user conversation continuity (--resume)
 *   - Long-term memory via MEMORY.md
 *   - Bot commands: /new, /memory, /clear, /sessions, /help
 *   - Voice transcription (Groq Whisper)
 *   - Typing indicators
 */

const TelegramBot = require("node-telegram-bot-api");
const { execSync } = require("child_process");
const os = require("os");
const path = require("path");

const TELEGRAM_MAX_LENGTH = 4096;

class TelegramAdapter {
  constructor(token, kiroClient) {
    this.bot = new TelegramBot(token, { polling: true });
    this.kiro = kiroClient;
    this.allowedUsers = new Set(
      (process.env.ALLOWED_USERS || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    );
    this.processing = new Set();
  }

  start() {
    // Register commands
    this.bot.setMyCommands([
      { command: "new", description: "Start a fresh conversation" },
      { command: "memory", description: "Show what Kiro remembers about you" },
      { command: "clear", description: "Clear long-term memory" },
      { command: "sessions", description: "List saved chat sessions" },
      { command: "help", description: "Show available commands" },
    ]).catch(() => {});

    this.bot.on("message", (msg) => this._onMessage(msg));
    console.log("[telegram] Listening for messages...");
  }

  stop() {
    this.bot.stopPolling();
  }

  async _onMessage(msg) {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    let text = msg.text?.trim();

    // Handle voice messages
    if (msg.voice && !text) {
      try {
        const transcript = await this._transcribeVoice(msg.voice.file_id);
        if (!transcript) {
          await this.bot.sendMessage(chatId, "❌ Could not transcribe voice message.");
          return;
        }
        text = transcript;
        console.log(`[telegram] Voice transcribed for ${userId}: ${text.slice(0, 100)}`);
      } catch (err) {
        console.error(`[telegram] Voice transcription error:`, err.message);
        await this.bot.sendMessage(chatId, `❌ Voice transcription failed: ${err.message}`);
        return;
      }
    }

    if (!text) return;

    // Auth check
    if (this.allowedUsers.size > 0 && !this.allowedUsers.has(userId)) {
      await this.bot.sendMessage(chatId, "⛔ Not authorized.");
      return;
    }

    // Handle commands
    if (text.startsWith("/")) {
      await this._handleCommand(chatId, userId, text);
      return;
    }

    // Prevent concurrent requests per user
    if (this.processing.has(userId)) {
      await this.bot.sendMessage(chatId, "⏳ Still working on your last message...");
      return;
    }

    this.processing.add(userId);
    console.log(`[telegram] IN from ${userId}: ${text.slice(0, 100)}`);

    try {
      // Show typing indicator
      await this.bot.sendChatAction(chatId, "typing");
      const typingInterval = setInterval(
        () => this.bot.sendChatAction(chatId, "typing").catch(() => {}),
        4000
      );

      const response = await this.kiro.prompt(text, userId);
      clearInterval(typingInterval);

      await this._sendResponse(chatId, response || "_(no response)_");
      console.log(`[telegram] OUT to ${userId}: ${(response || "").slice(0, 100)}`);
    } catch (err) {
      console.error(`[telegram] Error:`, err.message);
      await this.bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    } finally {
      this.processing.delete(userId);
    }
  }

  async _handleCommand(chatId, userId, text) {
    const [cmd, ...args] = text.split(/\s+/);

    switch (cmd) {
      case "/new":
      case "/start": {
        this.processing.add(userId);
        try {
          await this.bot.sendChatAction(chatId, "typing");
          const typingInterval = setInterval(
            () => this.bot.sendChatAction(chatId, "typing").catch(() => {}),
            4000
          );

          const greeting = args.length
            ? args.join(" ")
            : "Hello! I'm starting a fresh conversation. I'll check my memory for context about you.";

          const response = await this.kiro.prompt(
            `Read MEMORY.md first to recall what you know about me, then respond to: ${greeting}`,
            userId,
            { newSession: true }
          );
          clearInterval(typingInterval);

          await this._sendResponse(chatId, "🔄 *New conversation started.*\n\n" + (response || "Ready!"));
        } catch (err) {
          await this.bot.sendMessage(chatId, `❌ Error starting new chat: ${err.message}`);
        } finally {
          this.processing.delete(userId);
        }
        break;
      }

      case "/memory": {
        const memory = this.kiro.getMemory(userId);
        await this._sendResponse(chatId, "🧠 *Long-term Memory:*\n\n" + memory);
        break;
      }

      case "/clear": {
        this.kiro.clearMemory(userId);
        await this.bot.sendMessage(chatId, "🧹 Memory cleared. I'll start learning about you again.");
        break;
      }

      case "/sessions": {
        try {
          const sessions = await this.kiro.listSessions(userId);
          await this._sendResponse(chatId, "📋 *Saved Sessions:*\n\n" + sessions);
        } catch {
          await this.bot.sendMessage(chatId, "📋 No sessions found.");
        }
        break;
      }

      case "/help": {
        await this.bot.sendMessage(chatId,
          "🤖 *Kiro Telegram Bot*\n\n" +
          "Just send me a message and I'll respond using Kiro AI.\n\n" +
          "*Commands:*\n" +
          "/new — Start a fresh conversation\n" +
          "/memory — Show what I remember about you\n" +
          "/clear — Clear my long-term memory\n" +
          "/sessions — List saved chat sessions\n" +
          "/help — Show this help\n\n" +
          "💡 I remember our conversation within a session, and I store important facts in long-term memory across sessions.",
          { parse_mode: "Markdown" }
        );
        break;
      }

      default:
        // Unknown command — treat as regular message
        await this.bot.sendMessage(chatId, `Unknown command: ${cmd}\nType /help for available commands.`);
    }
  }

  async _sendResponse(chatId, text) {
    const parts = [];
    let remaining = text;

    while (remaining.length > TELEGRAM_MAX_LENGTH) {
      let splitAt = remaining.lastIndexOf("\n\n", TELEGRAM_MAX_LENGTH);
      if (splitAt === -1) splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_LENGTH);
      if (splitAt === -1) splitAt = TELEGRAM_MAX_LENGTH;
      parts.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    parts.push(remaining);

    for (const part of parts) {
      await this.bot.sendMessage(chatId, part, { parse_mode: "Markdown" }).catch(() =>
        this.bot.sendMessage(chatId, part)
      );
    }
  }

  async _transcribeVoice(fileId) {
    const file = await this.bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
    const localPath = path.join(os.tmpdir(), `voice-${Date.now()}.ogg`);

    try {
      execSync(`curl -sL -o "${localPath}" "${fileUrl}"`, { timeout: 15000 });

      const transcript = execSync(
        `curl -s "https://api.groq.com/openai/v1/audio/transcriptions" ` +
        `-H "Authorization: Bearer ${process.env.GROQ_API_KEY}" ` +
        `-F "file=@${localPath}" ` +
        `-F "model=whisper-large-v3" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("text",""))'`,
        { timeout: 30000, encoding: "utf-8" }
      ).trim();

      return transcript || null;
    } finally {
      try { require("fs").unlinkSync(localPath); } catch {}
    }
  }
}

module.exports = TelegramAdapter;
