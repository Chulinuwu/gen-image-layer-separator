import fs from "fs";
import path from "path";

const LOG_DIR = path.join(__dirname, "../../logs");
const LOG_FILE = path.join(LOG_DIR, "ai-trace.md");

/**
 * Ensures the log directory exists
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Appends a log entry to the markdown trace file
 */
export function traceAI(
  stage: string,
  prompt: string,
  response?: string,
  details?: any,
) {
  ensureLogDir();

  const timestamp = new Date().toISOString();
  let content = `\n## [${timestamp}] Stage: ${stage}\n`;

  if (details) {
    content += `\n**Details:**\n\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\`\n`;
  }

  content += `\n### Prompt\n\`\`\`text\n${prompt}\n\`\`\`\n`;

  if (response) {
    content += `\n### Raw Response\n\`\`\`text\n${response}\n\`\`\`\n`;
  }

  content += `\n---\n`;

  try {
    fs.appendFileSync(LOG_FILE, content, "utf8");
    console.log(`[AI-TRACE] Logged stage "${stage}" to ${LOG_FILE}`);
  } catch (err) {
    console.error(`[AI-TRACE] Failed to write to log file:`, err);
  }
}

/**
 * Logs a system event or decision
 */
export function logEvent(event: string, message: string, data?: any) {
  ensureLogDir();

  const timestamp = new Date().toISOString();
  let content = `\n### [${timestamp}] EVENT: ${event}\n`;
  content += `${message}\n`;

  if (data) {
    content += `\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
  }

  content += `\n---\n`;

  try {
    fs.appendFileSync(LOG_FILE, content, "utf8");
  } catch (err) {
    console.error(`[AI-TRACE] Failed to write event to log file:`, err);
  }
}
