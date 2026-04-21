from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

LOG_DIR = Path(__file__).parent.parent.parent / "logs"
LOG_FILE = LOG_DIR / "ai-trace.md"


def _ensure_log_dir() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def trace_ai(stage: str, prompt: str, response: str | None = None, details: dict | None = None) -> None:
    _ensure_log_dir()

    timestamp = datetime.now(timezone.utc).isoformat()
    content = f"\n## [{timestamp}] Stage: {stage}\n"

    if details:
        content += f"\n**Details:**\n```json\n{json.dumps(details, indent=2, ensure_ascii=False)}\n```\n"

    content += f"\n### Prompt\n```text\n{prompt}\n```\n"

    if response:
        content += f"\n### Raw Response\n```text\n{response}\n```\n"

    content += "\n---\n"

    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(content)
        print(f'[AI-TRACE] Logged stage "{stage}" to {LOG_FILE}')
    except Exception as err:
        print(f"[AI-TRACE] Failed to write to log file: {err}")


def extract_output_block(response_text: str) -> str:
    """Extract the content after `## OUTPUT` marker from a chain-of-thought response.

    If the marker is absent (older AI responses that didn't comply), return the full
    response stripped of any leading `## THINK` section and whitespace -- graceful degradation.
    """
    if "## OUTPUT" in response_text:
        return response_text.split("## OUTPUT", 1)[1].lstrip("\n :").strip()
    if response_text.strip().startswith("## THINK"):
        parts = response_text.split("\n\n", 1)
        if len(parts) == 2:
            return parts[1].strip()
    return response_text.strip()


def log_event(event: str, message: str, data: dict | None = None) -> None:
    _ensure_log_dir()

    timestamp = datetime.now(timezone.utc).isoformat()
    content = f"\n### [{timestamp}] EVENT: {event}\n"
    content += f"{message}\n"

    if data:
        content += f"\n```json\n{json.dumps(data, indent=2, ensure_ascii=False)}\n```\n"

    content += "\n---\n"

    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(content)
    except Exception as err:
        print(f"[AI-TRACE] Failed to write event to log file: {err}")
