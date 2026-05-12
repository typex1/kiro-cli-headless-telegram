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

You have a long-term memory that persists across conversations.
Your current memory is injected at the start of each message as context.

## Updating Memory

When you learn important facts, preferences, or context about the user, output a memory update block at the END of your response using this exact format:

[MEMORY_UPDATE]
# Memory

## About the User
- Key facts...

## Projects
- Current work...

## Preferences
- Likes/dislikes...

## Notes
- Other important context...
[/MEMORY_UPDATE]

The block must contain the COMPLETE updated memory (it replaces the previous memory entirely).

## When to Update Memory

- User shares their name, preferences, projects, or technical setup
- Important decisions or outcomes are reached
- User explicitly says "remember this" or similar
- You notice recurring topics or interests
- NOT every message — only when there's something new worth remembering

## Rules
- Be selective — only store what matters for future conversations
- Update existing entries rather than duplicating
- Remove outdated info when you notice it
- Never store passwords, tokens, or secrets
- Keep it concise — aim for under 50 lines

## Sending Files

When the user asks you to send them a file, include a special marker in your response:

\`[SEND_FILE:/absolute/path/to/file]\`

Or for files relative to the current workspace:

\`[SEND_FILE:relative/path/to/file]\`

The bot will detect these markers, send the file as a Telegram document, and strip the marker from the displayed text.

**Examples:**
- User: "Send me the README" → include \`[SEND_FILE:README.md]\` in your response
- User: "Send me my memory file" → include \`[SEND_FILE:MEMORY.md]\` in your response
- You can include multiple \`[SEND_FILE:...]\` markers to send multiple files
- Always verify the file exists before including the marker (use your file tools to check)
- Add a brief text response alongside the marker (e.g., "Here's the file you asked for.")
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
   * Build the augmented prompt with memory context and update instructions.
   */
  _buildPromptWithMemory(text, userId) {
    const memory = this.getMemory(userId);
    const hasMemory = memory && !memory.includes("No memories yet") && !memory.includes("No memories stored") && !memory.includes("Cleared. Starting fresh");

    let prompt = "";

    if (hasMemory) {
      prompt += `[LONG-TERM MEMORY - context from previous conversations]\n${memory}\n[/LONG-TERM MEMORY]\n\n`;
    }

    prompt += `User message: ${text}\n\n`;
    prompt += `[SYSTEM INSTRUCTION: If you learned anything new and important about the user in this exchange (name, preferences, projects, interests, technical details, or anything they asked you to remember), append a memory update block at the very end of your response in this exact format:\n[MEMORY_UPDATE]\n# Memory\n\n## About the User\n- facts...\n\n## Notes\n- other context...\n[/MEMORY_UPDATE]\nThe block must contain the COMPLETE updated memory (it replaces previous memory). Only include this block when there is genuinely new info to store. Do NOT include it for casual/trivial exchanges.]`;

    return prompt;
  }

  /**
   * Extract [MEMORY_UPDATE]...[/MEMORY_UPDATE] block from response and persist it.
   * Returns the response text with the memory block stripped.
   */
  _processMemoryUpdate(response, userId) {
    const memoryPattern = /\[MEMORY_UPDATE\]\s*([\s\S]*?)\s*\[\/MEMORY_UPDATE\]/;
    const match = response.match(memoryPattern);

    if (match) {
      const newMemory = match[1].trim();
      if (newMemory.length > 10) { // Sanity check — don't write empty/trivial content
        const ws = this._userWorkspace(userId);
        const memoryPath = path.join(ws, "MEMORY.md");
        fs.writeFileSync(memoryPath, newMemory + "\n", "utf-8");
        console.log(`[kiro] Memory updated for user ${userId} (${newMemory.length} chars)`);
      }
      // Strip the memory block from the visible response
      return response.replace(memoryPattern, "").replace(/\n{3,}/g, "\n\n").trim();
    }
    return response;
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
    const augmentedText = this._buildPromptWithMemory(text, userId);

    return new Promise((resolve, reject) => {
      const args = ["chat", "--no-interactive", "--trust-all-tools"];

      // Resume existing conversation unless explicitly starting new
      if (!opts.newSession) {
        args.push("--resume");
      }

      args.push(augmentedText);

      execFile(KIRO_CLI, args, {
        cwd: workspace,
        timeout: TIMEOUT,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, KIRO_LOG_LEVEL: "error" },
      }, (err, stdout, stderr) => {
        if (stderr) console.error("[kiro]", stderr.trim());
        if (err) return reject(new Error(err.message));
        // Strip ANSI escape codes
        let clean = stdout.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").trim();
        // Process and persist any memory updates from the response
        clean = this._processMemoryUpdate(clean, userId);
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
