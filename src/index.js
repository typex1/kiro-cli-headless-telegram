/**
 * Kiro Headless Bot — Entry Point
 *
 * Connects Kiro CLI (headless mode) to Telegram AND/OR Signal,
 * giving you a mobile AI assistant with full access to your workspace,
 * tools, and MCP servers.
 *
 * Usage:
 *   1. Copy .env.example to .env and configure
 *   2. npm install
 *   3. npm start
 *
 * Configure TELEGRAM_BOT_TOKEN for Telegram, SIGNAL_ACCOUNT for Signal,
 * or both to run dual-channel.
 */

const KiroClient = require("./kiro-client");
const TelegramAdapter = require("./telegram");
const SignalAdapter = require("./signal");

// Load .env
try {
  const fs = require("fs");
  const envPath = require("path").join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const [key, ...val] = line.split("=");
      if (key && !key.startsWith("#"))
        process.env[key.trim()] = val.join("=").trim();
    }
  }
} catch (_) {}

if (!process.env.KIRO_API_KEY) {
  console.error("Missing KIRO_API_KEY. Required for headless mode.");
  process.exit(1);
}

const hasTelegram = !!process.env.TELEGRAM_BOT_TOKEN;
const hasSignal = !!process.env.SIGNAL_ACCOUNT;

if (!hasTelegram && !hasSignal) {
  console.error("No messaging channel configured.");
  console.error("Set TELEGRAM_BOT_TOKEN for Telegram, SIGNAL_ACCOUNT for Signal, or both.");
  process.exit(1);
}

console.log("🚀 Kiro Headless Bot starting...");
console.log(`   Workspace: ${process.env.KIRO_WORKSPACE || process.cwd()}`);
console.log(`   Channels: ${[hasTelegram && "Telegram", hasSignal && "Signal"].filter(Boolean).join(", ")}`);

const kiro = new KiroClient();
const adapters = [];

if (hasTelegram) {
  const telegram = new TelegramAdapter(process.env.TELEGRAM_BOT_TOKEN, kiro);
  telegram.start();
  adapters.push(telegram);
  console.log("✅ Telegram bot online");
}

if (hasSignal) {
  const signal = new SignalAdapter(kiro);
  signal.start();
  adapters.push(signal);
  console.log("✅ Signal bot online");
}

console.log("\n📨 Waiting for messages...\n");

const shutdown = () => {
  console.log("\nShutting down...");
  adapters.forEach((a) => a.stop());
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 60_000);
