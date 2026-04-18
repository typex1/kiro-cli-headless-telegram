/**
 * Kiro Headless Client — runs kiro-cli in headless mode.
 *
 * Each prompt spawns: kiro-cli chat --no-interactive --trust-all-tools "prompt"
 * and captures the full output. No protocol handling needed.
 *
 * @see https://kiro.dev/docs/cli/headless/
 */

const { execFile } = require("child_process");

const KIRO_CLI = process.env.KIRO_CLI_PATH || "kiro-cli";
const WORKSPACE = process.env.KIRO_WORKSPACE || process.cwd();
const TIMEOUT = parseInt(process.env.KIRO_TIMEOUT || "120000", 10);

class KiroClient {
  prompt(text) {
    return new Promise((resolve, reject) => {
      const args = ["chat", "--no-interactive", "--trust-all-tools", text];
      execFile(KIRO_CLI, args, {
        cwd: WORKSPACE,
        timeout: TIMEOUT,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, KIRO_LOG_LEVEL: "error" },
      }, (err, stdout, stderr) => {
        if (stderr) console.error("[kiro]", stderr.trim());
        if (err) return reject(new Error(err.message));
        // Strip ANSI escape codes (colors, cursor, etc.)
        const clean = stdout.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").trim();
        resolve(clean);
      });
    });
  }
}

module.exports = KiroClient;
