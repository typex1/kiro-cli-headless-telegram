/**
 * Signal Adapter — connects signal-cli (JSON-RPC daemon) to Kiro headless client.
 *
 * Supports:
 *   - Per-user conversation continuity (--resume)
 *   - Long-term memory via MEMORY.md
 *   - Commands: !new, !memory, !clear, !sessions, !help
 *   - Voice note transcription (Groq Whisper)
 *   - Typing indicators (if supported by signal-cli version)
 *
 * Requires signal-cli installed and registered with a phone number.
 * Runs signal-cli in JSON-RPC daemon mode over stdio.
 *
 * @see https://github.com/AsamK/signal-cli
 */

const { spawn } = require("child_process");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

class SignalAdapter {
  constructor(kiroClient) {
    this.kiro = kiroClient;
    this.account = process.env.SIGNAL_ACCOUNT; // registered phone number
    this.signalCliPath = process.env.SIGNAL_CLI_PATH || "signal-cli";
    this.allowedUsers = new Set(
      (process.env.SIGNAL_ALLOWED_USERS || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    );
    this.processing = new Set();
    this.daemon = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.rl = null;
  }

  /**
   * Start the signal-cli JSON-RPC daemon and listen for incoming messages.
   */
  start() {
    const args = ["-a", this.account, "jsonRpc"];
    console.log(`[signal] Starting daemon: ${this.signalCliPath} ${args.join(" ")}`);

    this.daemon = spawn(this.signalCliPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.daemon.on("error", (err) => {
      console.error("[signal] Daemon failed to start:", err.message);
      process.exit(1);
    });

    this.daemon.on("exit", (code) => {
      console.error(`[signal] Daemon exited with code ${code}`);
      // Attempt restart after 5s
      setTimeout(() => this.start(), 5000);
    });

    this.daemon.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.error("[signal-cli]", msg);
    });

    // Read JSON-RPC messages line by line from stdout
    this.rl = readline.createInterface({ input: this.daemon.stdout });
    this.rl.on("line", (line) => this._onLine(line));

    console.log("[signal] Daemon started — listening for messages...");
  }

  stop() {
    if (this.daemon) {
      this.daemon.kill("SIGTERM");
      this.daemon = null;
    }
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  /**
   * Parse a line of JSON-RPC output from signal-cli.
   */
  _onLine(line) {
    let json;
    try {
      json = JSON.parse(line);
    } catch {
      return; // Ignore non-JSON output
    }

    // Check if it's a response to our request
    if (json.id !== undefined && this.pendingRequests.has(json.id)) {
      const { resolve, reject } = this.pendingRequests.get(json.id);
      this.pendingRequests.delete(json.id);
      if (json.error) {
        reject(new Error(json.error.message || JSON.stringify(json.error)));
      } else {
        resolve(json.result);
      }
      return;
    }

    // It's a notification (incoming message)
    if (json.method === "receive") {
      this._onReceive(json.params);
    }
  }

  /**
   * Handle an incoming Signal message.
   */
  async _onReceive(params) {
    if (!params || !params.envelope) return;

    const envelope = params.envelope;
    const sender = envelope.sourceNumber || envelope.source;
    if (!sender) return;

    // Get the data message
    const dataMessage = envelope.dataMessage;
    if (!dataMessage) return;

    let text = dataMessage.message?.trim();

    // Handle voice notes (attachments with voice flag or audio mime type)
    if (!text && dataMessage.attachments && dataMessage.attachments.length > 0) {
      const voiceAttachment = dataMessage.attachments.find(
        (a) => a.voiceNote || (a.contentType && a.contentType.startsWith("audio/"))
      );
      if (voiceAttachment && voiceAttachment.id) {
        try {
          text = await this._transcribeVoice(voiceAttachment);
          if (!text) {
            await this._send(sender, "❌ Could not transcribe voice message.");
            return;
          }
          console.log(`[signal] Voice transcribed for ${sender}: ${text.slice(0, 100)}`);
        } catch (err) {
          console.error(`[signal] Voice transcription error:`, err.message);
          await this._send(sender, `❌ Voice transcription failed: ${err.message}`);
          return;
        }
      }
    }

    if (!text) return;

    // Auth check
    if (this.allowedUsers.size > 0 && !this.allowedUsers.has(sender)) {
      await this._send(sender, "⛔ Not authorized.");
      return;
    }

    // Handle commands (Signal doesn't have /commands, use ! prefix)
    if (text.startsWith("!")) {
      await this._handleCommand(sender, text);
      return;
    }

    // Prevent concurrent requests per user
    if (this.processing.has(sender)) {
      await this._send(sender, "⏳ Still working on your last message...");
      return;
    }

    this.processing.add(sender);
    console.log(`[signal] IN from ${sender}: ${text.slice(0, 100)}`);

    try {
      // Send typing indicator
      await this._sendTyping(sender, true);

      const response = await this.kiro.prompt(text, this._userKey(sender));

      // Stop typing
      await this._sendTyping(sender, false);

      await this._send(sender, response || "_(no response)_");
      console.log(`[signal] OUT to ${sender}: ${(response || "").slice(0, 100)}`);
    } catch (err) {
      console.error(`[signal] Error:`, err.message);
      await this._send(sender, `❌ Error: ${err.message}`);
    } finally {
      this.processing.delete(sender);
    }
  }

  async _handleCommand(sender, text) {
    const [cmd, ...args] = text.split(/\s+/);

    switch (cmd) {
      case "!new":
      case "!start": {
        this.processing.add(sender);
        try {
          await this._sendTyping(sender, true);

          const greeting = args.length
            ? args.join(" ")
            : "Hello! I'm starting a fresh conversation. I'll check my memory for context about you.";

          const response = await this.kiro.prompt(
            `Read MEMORY.md first to recall what you know about me, then respond to: ${greeting}`,
            this._userKey(sender),
            { newSession: true }
          );

          await this._sendTyping(sender, false);
          await this._send(sender, "🔄 New conversation started.\n\n" + (response || "Ready!"));
        } catch (err) {
          await this._send(sender, `❌ Error starting new chat: ${err.message}`);
        } finally {
          this.processing.delete(sender);
        }
        break;
      }

      case "!memory": {
        const memory = this.kiro.getMemory(this._userKey(sender));
        await this._send(sender, "🧠 Long-term Memory:\n\n" + memory);
        break;
      }

      case "!clear": {
        this.kiro.clearMemory(this._userKey(sender));
        await this._send(sender, "🧹 Memory cleared. I'll start learning about you again.");
        break;
      }

      case "!sessions": {
        try {
          const sessions = await this.kiro.listSessions(this._userKey(sender));
          await this._send(sender, "📋 Saved Sessions:\n\n" + sessions);
        } catch {
          await this._send(sender, "📋 No sessions found.");
        }
        break;
      }

      case "!help": {
        await this._send(sender,
          "🤖 Kiro Signal Bot\n\n" +
          "Just send me a message and I'll respond using Kiro AI.\n\n" +
          "Commands:\n" +
          "!new — Start a fresh conversation\n" +
          "!memory — Show what I remember about you\n" +
          "!clear — Clear my long-term memory\n" +
          "!sessions — List saved chat sessions\n" +
          "!help — Show this help\n\n" +
          "💡 I remember our conversation within a session, and I store important facts in long-term memory across sessions."
        );
        break;
      }

      default:
        await this._send(sender, `Unknown command: ${cmd}\nType !help for available commands.`);
    }
  }

  /**
   * Send a message via JSON-RPC.
   */
  async _send(recipient, message) {
    // Signal has a ~2000 char practical limit per message for readability
    const MAX_LENGTH = 2000;
    const parts = [];
    let remaining = message;

    while (remaining.length > MAX_LENGTH) {
      let splitAt = remaining.lastIndexOf("\n\n", MAX_LENGTH);
      if (splitAt === -1) splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
      if (splitAt === -1) splitAt = MAX_LENGTH;
      parts.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    parts.push(remaining);

    for (const part of parts) {
      await this._rpc("send", {
        recipient: [recipient],
        message: part,
      });
    }
  }

  /**
   * Send typing indicator via JSON-RPC.
   */
  async _sendTyping(recipient, isTyping) {
    try {
      if (isTyping) {
        await this._rpc("sendTyping", { recipient: [recipient] });
      }
      // signal-cli doesn't have a "stop typing" — it times out automatically
    } catch {
      // Typing indicators are best-effort
    }
  }

  /**
   * Transcribe a voice note attachment using Groq Whisper.
   */
  async _transcribeVoice(attachment) {
    if (!process.env.GROQ_API_KEY) return null;

    // signal-cli 0.14+ stores attachments in a flat directory
    // The attachment object may have: file (full path), id, or filename
    let filePath = null;

    // Option 1: attachment.file is already a full path
    if (attachment.file && fs.existsSync(attachment.file)) {
      filePath = attachment.file;
    }

    // Option 2: check the flat attachments directory
    if (!filePath) {
      const signalAttachDir = path.join(
        os.homedir(),
        ".local",
        "share",
        "signal-cli",
        "attachments"
      );

      // Try attachment.id or attachment.filename
      const candidates = [
        attachment.id,
        attachment.filename,
        attachment.id && attachment.id.replace(/[^a-zA-Z0-9._-]/g, ""),
      ].filter(Boolean);

      for (const name of candidates) {
        const candidate = path.join(signalAttachDir, name);
        if (fs.existsSync(candidate)) {
          filePath = candidate;
          break;
        }
      }

      // If still not found, try listing recent files matching audio extensions
      if (!filePath) {
        try {
          const files = fs.readdirSync(signalAttachDir)
            .filter((f) => /\.(m4a|ogg|mp3|opus|wav|aac)$/i.test(f))
            .map((f) => ({
              name: f,
              mtime: fs.statSync(path.join(signalAttachDir, f)).mtimeMs,
            }))
            .sort((a, b) => b.mtime - a.mtime);

          if (files.length > 0 && Date.now() - files[0].mtime < 30000) {
            // Most recent audio file within last 30 seconds
            filePath = path.join(signalAttachDir, files[0].name);
          }
        } catch {}
      }
    }

    if (!filePath) {
      throw new Error("Voice attachment file not found");
    }

    try {
      const transcript = execSync(
        `curl -s "https://api.groq.com/openai/v1/audio/transcriptions" ` +
        `-H "Authorization: Bearer ${process.env.GROQ_API_KEY}" ` +
        `-F "file=@${filePath}" ` +
        `-F "model=whisper-large-v3" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("text",""))'`,
        { timeout: 30000, encoding: "utf-8" }
      ).trim();

      return transcript || null;
    } catch (err) {
      throw new Error(`Transcription failed: ${err.message}`);
    }
  }

  /**
   * Make a JSON-RPC call to the signal-cli daemon.
   */
  _rpc(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request = JSON.stringify({ jsonrpc: "2.0", method, id, params }) + "\n";

      this.pendingRequests.set(id, { resolve, reject });
      this.daemon.stdin.write(request);

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`RPC timeout for ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * Normalize sender to a user key for workspace isolation.
   * Prefixes with "signal-" to avoid collision with Telegram user IDs.
   */
  _userKey(sender) {
    return `signal-${sender.replace(/\+/g, "")}`;
  }
}

module.exports = SignalAdapter;
