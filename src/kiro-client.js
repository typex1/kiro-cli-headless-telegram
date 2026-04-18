/**
 * Kiro Headless Client — runs kiro-cli in headless mode with session memory.
 *
 * Supports:
 *   - Conversation continuity via --resume (within-session memory)
 *   - Per-user workspace isolation
 *   - MEMORY.md for cross-session long-term memory (OpenClaw-style)
 *
 * @see https://kiro.dev/docs/cli/headless/
 */

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const KIRO_CLI = process.env.KIRO_CLI_PATH || "kiro-cli";
const BASE_WORKSPACE = process.env.KIRO_WORKSPACE || process.cwd();
const TIMEOUT = parseInt(process.env.KIRO_TIMEOUT || "120000", 10);

// Steering instructions that teach Kiro to maintain MEMORY.md
const STEERING_CONTENT = `# Memory Instructions

You have access to a file called \`MEMORY.md\` in the current workspace.
This is your long-term memory — it persists across conversations.

## On every conversation start

Read \`MEMORY.md\` at the beginning of the conversation (if it exists) to recall previous context.

## During conversation

When you learn important facts, preferences, or context about the user, **update MEMORY.md** using your file tools:
- User's name, preferences, projects they're working on
- Important decisions or outcomes
- Recurring topics or interests
- Technical setup details (languages, frameworks, infra)
- Anything they explicitly ask you to remember

## Format

Keep MEMORY.md organized with sections:

\`\`\`markdown
# Memory

## About the User
- Key facts...

## Projects
- Current work...

## Preferences
- Likes/dislikes...

## Notes
- Other important context...
\`\`\`

## Rules
- Be selective — don't dump every detail, just what matters
- Update existing entries rather than duplicating
- Remove outdated info when you notice it
- Never store passwords, tokens, or secrets
- When the user says "remember this" or similar, always update MEMORY.md
`;

class KiroClient {
  /**
   * Get the workspace directory for a specific user.
   * Each user gets their own subdirectory for session isolation.
   */
  _userWorkspace(userId) {
    if (!userId) return BASE_WORKSPACE;
    const userDir = path.join(BASE_WORKSPACE, "users", String(userId));
    return userDir;
  }

  /**
   * Ensure user workspace exists with steering instructions and MEMORY.md seed.
   */
  _ensureWorkspace(userId) {
    const ws = this._userWorkspace(userId);

    // Create workspace and .kiro/steering directory
    const steeringDir = path.join(ws, ".kiro", "steering");
    fs.mkdirSync(steeringDir, { recursive: true });

    // Write steering file (always overwrite to keep in sync)
    const steeringPath = path.join(steeringDir, "memory.md");
    fs.writeFileSync(steeringPath, STEERING_CONTENT, "utf-8");

    // Seed MEMORY.md if it doesn't exist
    const memoryPath = path.join(ws, "MEMORY.md");
    if (!fs.existsSync(memoryPath)) {
      fs.writeFileSync(memoryPath, "# Memory\n\n_No memories yet. I'll update this as we talk._\n", "utf-8");
    }

    return ws;
  }

  /**
   * Send a prompt to Kiro, resuming the existing conversation.
   * @param {string} text - User's message
   * @param {string} userId - Telegram user ID for workspace isolation
   * @param {object} opts - Options
   * @param {boolean} opts.newSession - Start a fresh conversation instead of resuming
   */
  prompt(text, userId, opts = {}) {
    const workspace = this._ensureWorkspace(userId);

    return new Promise((resolve, reject) => {
      const args = ["chat", "--no-interactive", "--trust-all-tools"];

      // Resume existing conversation unless explicitly starting new
      if (!opts.newSession) {
        args.push("--resume");
      }

      args.push(text);

      execFile(KIRO_CLI, args, {
        cwd: workspace,
        timeout: TIMEOUT,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, KIRO_LOG_LEVEL: "error" },
      }, (err, stdout, stderr) => {
        if (stderr) console.error("[kiro]", stderr.trim());
        if (err) return reject(new Error(err.message));
        // Strip ANSI escape codes
        const clean = stdout.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").trim();
        resolve(clean);
      });
    });
  }

  /**
   * Read the user's MEMORY.md file.
   */
  getMemory(userId) {
    const ws = this._userWorkspace(userId);
    const memoryPath = path.join(ws, "MEMORY.md");
    try {
      return fs.readFileSync(memoryPath, "utf-8");
    } catch {
      return "_No memories stored yet._";
    }
  }

  /**
   * Clear the user's MEMORY.md file.
   */
  clearMemory(userId) {
    const ws = this._userWorkspace(userId);
    const memoryPath = path.join(ws, "MEMORY.md");
    fs.writeFileSync(memoryPath, "# Memory\n\n_Cleared. Starting fresh._\n", "utf-8");
  }

  /**
   * List saved sessions for a user's workspace.
   */
  listSessions(userId) {
    const workspace = this._userWorkspace(userId);
    return new Promise((resolve, reject) => {
      execFile(KIRO_CLI, ["chat", "--list-sessions", "--format", "plain"], {
        cwd: workspace,
        timeout: 10000,
        env: { ...process.env, KIRO_LOG_LEVEL: "error" },
      }, (err, stdout) => {
        if (err) return reject(err);
        const clean = stdout.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").trim();
        resolve(clean || "_No saved sessions._");
      });
    });
  }
}

module.exports = KiroClient;
