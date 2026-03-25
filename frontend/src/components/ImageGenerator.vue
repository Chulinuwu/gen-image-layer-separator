<script setup lang="ts">
import { ref, computed } from "vue";

const prompt = ref("An office group photo of people looking stressed");
const aspectRatio = ref("3:4");
const loading = ref(false);
const result = ref<any>(null);
const error = ref("");
const generationMode = ref("normal");
const textBrief = ref("");
const footerText = ref("");
const progressSteps = ref<string[]>([]);
const campaignResult = ref<any>(null);
const showBbox = ref(false);
const previewContainer = ref<HTMLElement | null>(null);

const showTextInputs = computed(() => generationMode.value === "integrated" || generationMode.value === "full-campaign");

const API_BASE = "http://localhost:5001";

const emit = defineEmits(["generated", "integrated-generated", "campaign-created", "proceed"]);

const buttonLabel = computed(() => {
  if (loading.value) return "Generating...";
  if (generationMode.value === "full-campaign") return "Generate Full Campaign";
  if (generationMode.value === "integrated") return "Generate + Plan Layout";
  return "Generate Image";
});

const generateImage = async () => {
  loading.value = true;
  error.value = "";
  result.value = null;
  campaignResult.value = null;
  progressSteps.value = [];

  try {
    if (generationMode.value === "full-campaign" && textBrief.value.trim()) {
      await runFullCampaign();
    } else if (generationMode.value === "integrated" && textBrief.value.trim()) {
      await runIntegrated();
    } else {
      await runNormal();
    }
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};

const runNormal = async () => {
  const formData = new FormData();
  formData.append("prompt", prompt.value);
  formData.append("aspect_ratio", aspectRatio.value);

  const response = await fetch(`${API_BASE}/api/image/generate`, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (data.success) {
    result.value = data.data;
    emit("generated", data.data.imageUrl);
  } else {
    error.value = data.error || "Failed to generate image";
  }
};

const runIntegrated = async () => {
  const response = await fetch(`${API_BASE}/api/image/generate-integrated`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text_brief: textBrief.value,
      visual_concept: prompt.value,
      aspect_ratio: aspectRatio.value,
    }),
  });

  const data = await response.json();
  if (data.success) {
    result.value = { imageUrl: data.data.imageUrl, text: data.data.text };
    emit("generated", data.data.imageUrl);
    emit("integrated-generated", {
      url: data.data.imageUrl,
      textBrief: textBrief.value,
      textZones: data.data.textZones || [],
      bgConstraints: data.data.bgConstraints || "",
    });
  } else {
    error.value = data.error || "Failed to generate integrated image";
  }
};

const runFullCampaign = async () => {
  const response = await fetch(`${API_BASE}/api/image/create-campaign-integrated`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text_brief: textBrief.value,
      visual_concept: prompt.value,
      aspect_ratio: aspectRatio.value,
      footer_text: footerText.value || undefined,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({ error: "Connection failed" }));
    throw new Error(errData.error || `Server error: ${response.status}`);
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
        if (line.startsWith("event:")) eventType = line.replace("event:", "").trim();
        else if (line.startsWith("data:")) eventData = line.replace("data:", "").trim();
      }
      if (eventData) {
        try {
          const data = JSON.parse(eventData);
          handleFullCampaignSSE(eventType, data);
        } catch (e) {
          // skip unparseable events
        }
      }
    }
  }
};

const handleFullCampaignSSE = (event: string, data: any) => {
  switch (event) {
    case "progress":
      progressSteps.value.push(data.message || data.step);
      if (data.imageUrl) {
        result.value = { imageUrl: data.imageUrl };
        emit("generated", data.imageUrl);
      }
      break;
    case "iteration_end":
      // intermediate layout update
      break;
    case "critique_complete":
      progressSteps.value.push(
        data.status === "PASS"
          ? `Layout approved (confidence: ${Math.round((data.confidence || 0.5) * 100)}%)`
          : `Issues found: ${data.feedback || ""}`
      );
      break;
    case "error":
      progressSteps.value.push(`Error: ${data.error || data.message || "Unknown error"}`);
      error.value = data.error || data.message || "Pipeline error";
      break;
    case "done":
      if (data.success && data.data) {
        campaignResult.value = data.data;
        if (data.data.generatedBackgroundImageUrl) {
          result.value = { imageUrl: data.data.generatedBackgroundImageUrl };
          emit("generated", data.data.generatedBackgroundImageUrl);
        }
        emit("integrated-generated", {
          url: data.data.generatedBackgroundImageUrl || data.data.referenceImage,
          textBrief: textBrief.value,
          textZones: data.data.textZones || [],
          bgConstraints: data.data.bgConstraints || "",
        });
        emit("campaign-created", data.data);
        progressSteps.value.push("Campaign complete!");
      }
      break;
    case "error":
      error.value = data.error || data.message || "Campaign generation failed";
      break;
  }
};

const goToCampaign = () => {
  emit("proceed");
};
</script>

<template>
  <div class="card">
    <h2>Generate Background</h2>
    <div class="mb-4">
      <label class="label">Prompt</label>
      <textarea
        v-model="prompt"
        rows="3"
        placeholder="Describe the scene..."
      ></textarea>
    </div>

    <div class="mb-4">
      <label class="label">Aspect Ratio</label>
      <select v-model="aspectRatio" class="select-input">
        <option value="1:1">1:1 (Square)</option>
        <option value="4:3">4:3 (Standard)</option>
        <option value="3:4">3:4 (Portrait)</option>
        <option value="16:9">16:9 (Widescreen)</option>
        <option value="9:16">9:16 (Vertical)</option>
        <option value="21:9">21:9 (Ultra Wide)</option>
        <option value="3:2">3:2 (Photo)</option>
        <option value="2:3">2:3 (Portrait Photo)</option>
        <option value="5:4">5:4 (Classic)</option>
        <option value="4:5">4:5 (Instagram)</option>
      </select>
    </div>

    <div class="mb-4">
      <label class="label">Generation Mode</label>
      <select v-model="generationMode" class="select-input">
        <option value="normal">Normal (BG only)</option>
        <option value="integrated">Integrated (BG + text zone planning)</option>
        <option value="full-campaign">Full Campaign (BG + layout + SVG render)</option>
      </select>
    </div>

    <div v-if="showTextInputs" class="mb-4">
      <label class="label">Ad Text Brief</label>
      <textarea
        v-model="textBrief"
        rows="4"
        placeholder="Paste your ad copy, headlines, and key messages here..."
      ></textarea>
    </div>

    <div v-if="generationMode === 'full-campaign'" class="mb-4">
      <label class="label">Footer Text (optional)</label>
      <input
        v-model="footerText"
        type="text"
        class="text-input"
        placeholder="Disclaimer or fine print..."
      />
    </div>

    <button :disabled="loading" @click="generateImage">
      {{ buttonLabel }}
    </button>

    <div v-if="progressSteps.length" class="progress-log mt-4">
      <div v-for="(step, idx) in progressSteps" :key="idx" class="progress-step">
        <span class="step-icon">{{ idx === progressSteps.length - 1 && loading ? '...' : 'OK' }}</span>
        {{ step }}
      </div>
      <div v-if="loading && result && !campaignResult" class="generating-hint">
        Generating layout on this background...
      </div>
    </div>

    <div v-if="loading && result && !campaignResult" class="preview-during-loading mt-4">
      <h4>Background Preview (layout in progress...)</h4>
      <div class="image-container">
        <img :src="`${API_BASE}${result.imageUrl}`" alt="BG Preview" style="opacity: 0.7" />
        <div class="loading-overlay">Generating text layout...</div>
      </div>
    </div>

    <div v-if="error" class="error mt-4">{{ error }}</div>

    <div v-if="result" class="result mt-4">
      <h3>Result</h3>
      <div class="image-container">
        <img :src="`${API_BASE}${result.imageUrl}`" alt="Generated" />
      </div>
      <p v-if="result.text" class="mt-4">{{ result.text }}</p>

      <div v-if="campaignResult && campaignResult.svg_overlay" class="mt-4">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          <h4 style="margin:0">Campaign Preview</h4>
          <button class="bbox-toggle" :class="{ active: showBbox }" @click="showBbox = !showBbox">
            {{ showBbox ? 'BBOX ON' : 'BBOX OFF' }}
          </button>
        </div>
        <div class="image-container campaign-preview" ref="previewContainer">
          <img :src="`${API_BASE}${result.imageUrl}`" alt="Background" />
          <div class="svg-overlay" v-html="campaignResult.svg_overlay"></div>
          <template v-if="showBbox && campaignResult.computedBoxes && campaignResult.canvasSize">
            <div
              v-for="box in campaignResult.computedBoxes"
              :key="box.id"
              class="debug-bbox"
              :style="{
                left: (box.x / campaignResult.canvasSize.w * 100) + '%',
                top: (box.y / campaignResult.canvasSize.h * 100) + '%',
                width: (box.w / campaignResult.canvasSize.w * 100) + '%',
                height: (box.h / campaignResult.canvasSize.h * 100) + '%',
              }"
            >
              <span class="bbox-label">{{ box.id }} ({{ box.type }})</span>
            </div>
          </template>
        </div>
      </div>

      <div class="flex gap-4 mt-4">
        <a
          :href="`${API_BASE}${result.imageUrl}`"
          target="_blank"
          class="btn-link"
          >Open Full Image</a
        >
        <button @click="goToCampaign" class="btn-primary mini">
          Next: Layout &amp; Text &rarr;
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.label {
  display: block;
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 0.9rem;
}

.error {
  color: #d92d20;
  background: #fef3f2;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #fecdca;
}

.image-container {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: #eee;
  position: relative;
}

.image-container img {
  width: 100%;
  height: auto;
  display: block;
}

.campaign-preview .svg-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.campaign-preview .svg-overlay :deep(svg) {
  width: 100%;
  height: 100%;
}

.btn-primary.mini {
  padding: 10px 20px;
  font-size: 0.9rem;
  background-color: #2563eb !important;
  color: white !important;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 700;
  display: inline-block;
}

.btn-primary.mini:hover {
  background-color: #1d4ed8 !important;
}

.btn-link {
  color: var(--secondary);
  text-decoration: underline;
  font-size: 0.9rem;
}

.select-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.95rem;
  background-color: white;
  cursor: pointer;
}

.select-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.text-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.95rem;
  background-color: white;
}

.text-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.progress-log {
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  max-height: 200px;
  overflow-y: auto;
}

.progress-step {
  font-size: 0.85rem;
  color: #475569;
  padding: 4px 0;
  border-bottom: 1px solid #f1f5f9;
}

.progress-step:last-child {
  border-bottom: none;
}
.step-icon {
  margin-right: 6px;
}
.generating-hint {
  font-size: 0.8rem;
  color: #6366f1;
  padding: 6px 0;
  animation: pulse 1.5s infinite;
}
.preview-during-loading {
  position: relative;
}
.preview-during-loading .image-container {
  position: relative;
}
.loading-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0,0,0,0.6);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 0.9rem;
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.campaign-preview {
  position: relative;
}
.campaign-preview .svg-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.bbox-toggle {
  font-size: 0.75rem;
  padding: 4px 10px;
  border: 1px solid #94a3b8;
  border-radius: 4px;
  background: #f1f5f9;
  cursor: pointer;
}
.bbox-toggle.active {
  background: #1e293b;
  color: white;
  border-color: #1e293b;
}
.debug-bbox {
  position: absolute;
  border: 1.5px dashed #3b82f6;
  pointer-events: none;
  box-sizing: border-box;
}
.bbox-label {
  position: absolute;
  top: 0;
  left: 0;
  background: #3b82f6;
  color: white;
  font-size: 0.6rem;
  padding: 1px 4px;
  border-radius: 0 0 3px 0;
  white-space: nowrap;
}
</style>
