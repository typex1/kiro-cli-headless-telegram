/**
 * Kiro Headless Telegram Bot — Entry Point
 *
 * Connects Kiro CLI (headless mode) to Telegram, giving you a mobile
 * AI assistant with full access to your workspace, tools, and MCP servers.
 *
 * Usage:
 *   1. Copy .env.example to .env and configure
 *   2. npm install
 *   3. npm start
 */

const KiroClient = require("./kiro-client");
const TelegramAdapter = require("./telegram");

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

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN. Copy .env.example to .env");
  process.exit(1);
}

if (!process.env.KIRO_API_KEY) {
  console.error("Missing KIRO_API_KEY. Required for headless mode.");
  process.exit(1);
}

console.log("🚀 Kiro Headless Telegram Bot starting...");
console.log(`   Workspace: ${process.env.KIRO_WORKSPACE || process.cwd()}`);

const kiro = new KiroClient();
const telegram = new TelegramAdapter(TOKEN, kiro);
telegram.start();
console.log("✅ Telegram bot online — send a message to your bot!\n");

const shutdown = () => {
  console.log("\nShutting down...");
  telegram.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 60_000);
