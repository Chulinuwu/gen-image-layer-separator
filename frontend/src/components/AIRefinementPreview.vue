<template>
  <div
    v-if="show"
    class="refinement-viewport"
    :class="{ 'sidebar-collapsed': isCollapsed }"
  >
    <div class="main-canvas">
      <!-- Collapse toggle button -->
      <button
        @click="isCollapsed = !isCollapsed"
        class="toggle-sidebar-btn"
        :title="isCollapsed ? 'Show Sidebar' : 'Hide Sidebar'"
      >
        <svg
          v-if="isCollapsed"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
        <svg
          v-else
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>

      <!-- Background reference / working area -->
      <div class="canvas-container shadow-sm">
        <div class="canvas-label">LIVE DESIGN CANVAS</div>
        <div class="canvas-content">
          <img
            v-if="currentPreviewUrl"
            :src="currentPreviewUrl"
            class="design-preview"
          />
          <div v-else class="empty-canvas">
            <div class="loader-ring"></div>
            <span>INITIALIZING AI CREATIVE SUITE...</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Art Director's Sidebar -->
    <div class="sidebar">
      <div class="sidebar-header">
        <div class="brand">
          <span class="brand-ai">AI</span>
          <span class="brand-title">ART DIRECTOR</span>
        </div>
        <div class="iteration-counter">
          ITERATION {{ currentIteration }} / {{ maxIterations }}
        </div>
      </div>

      <div class="sidebar-scroll-area">
        <div class="status-tracker mb-8">
          <div class="progress-track">
            <div
              class="progress-thumb"
              :style="{ width: progressPercent + '%' }"
            ></div>
          </div>
          <div class="status-message">{{ statusText.toUpperCase() }}</div>
        </div>

        <div class="critique-container" v-if="currentCritique">
          <div class="panel-label">CRITIQUE ANALYSIS</div>
          <div :class="['critique-card', currentCritique.status.toLowerCase()]">
            <div class="status-indicator">
              <span class="dot"></span>
              {{
                currentCritique.status === "PASS"
                  ? "APPROVED"
                  : "REVISIONS REQUIRED"
              }}
            </div>
            <p
              class="feedback-text"
              v-html="formatMarkdown(currentCritique.feedback)"
            ></p>
          </div>

          <div
            v-if="currentCritique.actionableSteps?.length"
            class="refinement-plan mt-6"
          >
            <div class="panel-label">REFINEMENT PLAN</div>
            <ul class="steps-list">
              <li
                v-for="(
                  step, idx
                ) in currentCritique.actionableSteps as string[]"
                :key="idx"
              >
                <span class="step-num">{{ Number(idx) + 1 }}</span>
                <div class="step-content">
                  <div class="step-status">
                    <span class="pulse"></span>
                    Pending Refinement
                  </div>
                  <div v-html="formatMarkdown(step)"></div>
                </div>
              </li>
            </ul>
          </div>
        </div>

        <div class="history-log mt-8">
          <div class="panel-label">SESSION LOG</div>
          <div class="log-entries" ref="logContainer">
            <div
              v-for="(msg, idx) in messages"
              :key="idx"
              :class="['log-entry', msg.type]"
            >
              <span class="log-time">{{ msg.timestamp }}</span>
              <span class="log-text">{{ msg.text }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="sidebar-footer">
        <button v-if="isComplete" @click="$emit('close')" class="btn-finalize">
          FINALIZE DESIGN
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from "vue";

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "complete", data: any): void;
}>();

const formatMarkdown = (text: string) => {
  if (!text) return "";
  // Basic markdown: bold, italics, inline code, and lists
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(/^\* (.*)/gm, "<li>$1</li>")
    .replace(/^- (.*)/gm, "<li>$1</li>")
    .replace(/\n/g, "<br>");
};

const currentIteration = ref(0);
const maxIterations = ref(10);
const currentPreviewUrl = ref("");
const currentCritique = ref<any>(null);
const messages = ref<Array<{ timestamp: string; text: string; type: string }>>(
  [],
);
const statusText = ref("Initializing design suite...");
const logContainer = ref<HTMLElement | null>(null);
const isComplete = ref(false);
const isCollapsed = ref(false);

const progressPercent = computed(() => {
  return (currentIteration.value / maxIterations.value) * 100;
});

const addMessage = (text: string, type: string = "info") => {
  const now = new Date();
  const timestamp = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

  const cleanText = text.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
    "",
  );

  messages.value.push({ timestamp, text: cleanText, type });
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight;
    }
  });
};

const connectSSE = async (formData: FormData) => {
  try {
    // Reset state for new run
    messages.value = [];
    currentIteration.value = 0;
    currentPreviewUrl.value = "";
    currentCritique.value = null;
    isComplete.value = false;
    statusText.value = "Initializing design suite...";

    addMessage("Establishing design connection...", "info");

    const response = await fetch(
      "http://localhost:5001/api/image/create-campaign",
      {
        method: "POST",
        body: formData,
      },
    );

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Connection failed" }));
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Response body is not readable");

    const decoder = new TextDecoder();
    let partialData = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      partialData += chunk;

      const parts = partialData.split("\n\n");
      partialData = parts.pop() || "";

      for (const part of parts) {
        if (!part.trim()) continue;
        const lines = part.split("\n");
        let eventType = "message";
        let eventData = "";
        for (const line of lines) {
          if (line.startsWith("event:"))
            eventType = line.replace("event:", "").trim();
          else if (line.startsWith("data:"))
            eventData = line.replace("data:", "").trim();
        }
        if (eventData) {
          try {
            const data = JSON.parse(eventData);
            handleSSEEvent(eventType, data);
          } catch (e) {
            console.error("Failed to parse design session data:", e);
          }
        }
      }
    }
  } catch (err: any) {
    statusText.value = "Design session failed";
    addMessage(`Session Error: ${err.message}`, "error");
  }
};

const handleSSEEvent = (event: string, data: any) => {
  switch (event) {
    case "progress":
      statusText.value = data.message;
      addMessage(data.message, "info");
      break;
    case "iteration_start":
      currentIteration.value = data.iteration;
      maxIterations.value = data.maxIterations;
      statusText.value = `Running Iteration ${data.iteration}...`;
      addMessage(`Starting refinement pass ${data.iteration}`, "iteration");
      break;
    case "preview_ready":
      currentPreviewUrl.value = `http://localhost:5001${data.previewUrl}`;
      addMessage("Draft preview updated", "success");
      break;
    case "critique_complete":
      currentCritique.value = data;
      addMessage(
        `Critique: ${data.status}`,
        data.status === "PASS" ? "success" : "warning",
      );
      break;
    case "refining":
      statusText.value = "Executing refinement plan...";
      addMessage("Applying art director adjustments", "processing");
      break;
    case "done":
      statusText.value = "Design Approved";
      isComplete.value = true;
      addMessage("Layout finalized successfully", "success");
      setTimeout(() => {
        emit("complete", data.data);
      }, 1000);
      break;
    case "error":
      addMessage(`Engine Error: ${data.error}`, "error");
      break;
  }
};

defineExpose({ connectSSE });
</script>

<style scoped>
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Outfit:wght@500;700&display=swap");

.refinement-viewport {
  background: var(--bg);
  display: flex;
  font-family: "Inter", sans-serif;
  color: var(--primary);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  margin-top: 32px;
  height: 850px;
  width: 100%;
  position: relative;
}

/* Main Design Area */
.main-canvas {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px;
  background: #f0f2f5;
  position: relative;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.canvas-container {
  height: 100%;
  max-width: 100%;
  aspect-ratio: 4/5;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  position: relative;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.05);
}

.canvas-label {
  position: absolute;
  top: 16px;
  left: 16px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--secondary);
  z-index: 10;
}

.canvas-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.design-preview {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.empty-canvas {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  color: var(--secondary);
  font-size: 11px;
  letter-spacing: 2px;
  text-align: center;
  padding: 40px;
}

.loader-ring {
  width: 40px;
  height: 40px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

/* Sidebar */
.sidebar {
  width: 400px;
  background: var(--surface);
  border-left: 1px solid var(--border);
  padding: 32px;
  display: flex;
  flex-direction: column;
  transition:
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  position: relative;
}

.sidebar-scroll-area {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 8px; /* Space for scrollbar */
  margin-right: -8px;
}

.refinement-viewport.sidebar-collapsed .sidebar {
  width: 0;
  padding-left: 0;
  padding-right: 0;
  border-left: none;
}

.toggle-sidebar-btn {
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 10001;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--primary);
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: all 0.2s;
  padding: 0;
}

.toggle-sidebar-btn:hover {
  background: var(--bg);
  transform: scale(1.05);
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 40px;
  min-width: 336px;
}

.brand {
  display: flex;
  flex-direction: column;
}

.brand-ai {
  font-family: "Outfit", sans-serif;
  font-weight: 700;
  font-size: 24px;
  line-height: 1;
  color: var(--primary);
}

.brand-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 3px;
  color: var(--secondary);
  margin-top: 4px;
}

.iteration-counter {
  font-family: monospace;
  font-size: 11px;
  color: var(--secondary);
  padding: 4px 8px;
  background: var(--bg);
  border-radius: 4px;
  border: 1px solid var(--border);
}

.status-tracker {
  margin-bottom: 40px;
  min-width: 336px;
}

.progress-track {
  height: 4px;
  background: var(--border);
  width: 100%;
  margin-bottom: 12px;
  border-radius: 2px;
}

.progress-thumb {
  height: 100%;
  background: var(--primary);
  transition: width 0.5s cubic-bezier(0.45, 0, 0.55, 1);
  border-radius: 2px;
}

.status-message {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--primary);
}

.panel-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--secondary);
  margin-top: 16px;
  margin-bottom: 16px;
  text-transform: uppercase;
}

.critique-container {
  min-width: 336px;
}

.critique-card {
  padding: 20px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-left: 4px solid var(--secondary);
  border-radius: 8px;
}

.critique-card.pass {
  border-left-color: #10b981;
  background: #f0fdf4;
  border-color: #bbf7d0;
}
.critique-card.fail {
  border-left-color: #ef4444;
  background: #fef2f2;
  border-color: #fecaca;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 8px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.feedback-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--primary);
}

.steps-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.steps-list li {
  font-size: 13px;
  padding: 16px;
  background: white;
  border-radius: 10px;
  margin-bottom: 14px;
  display: flex;
  gap: 16px;
  color: var(--primary);
  border: 1px solid var(--border);
  line-height: 1.5;
  align-items: flex-start;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.steps-list li:hover {
  transform: translateX(4px);
  border-color: var(--primary);
}

.step-num {
  font-family: "Outfit", sans-serif;
  font-weight: 700;
  color: white;
  background: var(--primary);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 12px;
  flex-shrink: 0;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
}

.step-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.step-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 700;
  color: var(--secondary);
  margin-bottom: 4px;
}

.step-status .pulse {
  width: 6px;
  height: 6px;
  background: var(--secondary);
  border-radius: 50%;
  animation: pulse-dot 1.5s infinite;
}

@keyframes pulse-dot {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.5);
    opacity: 0.5;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

:deep(strong) {
  font-weight: 700;
  color: #101828;
}

:deep(code) {
  font-family: monospace;
  background: rgba(16, 24, 40, 0.05);
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 0.9em;
  color: #c0392b;
}

:deep(li) {
  margin-left: 1.25rem;
  margin-bottom: 0.5rem;
  list-style-type: disc;
}

.history-log {
  margin-top: 40px;
  min-width: 336px;
}

.log-entries {
  height: 150px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 11px;
  padding-right: 8px;
}

.log-entry {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
}

.log-time {
  color: var(--secondary);
}
.log-text {
  color: var(--primary);
}

.log-entry.success .log-text {
  color: #059669;
}
.log-entry.error .log-text {
  color: #dc2626;
}
.log-entry.iteration .log-text {
  color: var(--primary);
  font-weight: 600;
}

.sidebar-footer {
  margin-top: 32px;
  min-width: 336px;
}

.btn-finalize {
  width: 100%;
  padding: 16px;
  background: var(--primary);
  color: #fff;
  border: none;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 2px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(16, 24, 40, 0.1);
}

.btn-finalize:hover {
  background: var(--primary-hover);
  transform: translateY(-2px);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

::-webkit-scrollbar {
  width: 4px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}
</style>
