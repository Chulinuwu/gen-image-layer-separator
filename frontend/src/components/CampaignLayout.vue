<script setup lang="ts">
import { ref, onMounted } from "vue";
import AIRefinementPreview from "./AIRefinementPreview.vue";

const props = defineProps({
  initialBackgroundUrl: String,
});
const emit = defineEmits(["created", "proceed"]);

const targetText = ref("SUMMER SALE 50%");
const loading = ref(false);
const analysis = ref<any>(null);
const error = ref("");
const selectedFile = ref<File | null>(null);
const previewUrl = ref<string | null>(null);
const progressMessage = ref("");
const mode = ref("full"); // "full" or "text"
const showRefinement = ref(false);
const refinementPreview = ref<any>(null);

onMounted(async () => {
  if (props.initialBackgroundUrl) {
    try {
      const fullUrl = `http://localhost:5001${props.initialBackgroundUrl}`;
      const response = await fetch(fullUrl);
      const blob = await response.blob();
      const filename = props.initialBackgroundUrl.split("/").pop() || "bg.png";
      const file = new File([blob], filename, { type: blob.type });
      selectedFile.value = file;
      previewUrl.value = URL.createObjectURL(file);
    } catch (err) {
      console.error("Failed to load initial background:", err);
    }
  }
});

const onFileChange = (e: any) => {
  const file = e.target.files[0];
  if (file) {
    selectedFile.value = file;
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = URL.createObjectURL(file);
    analysis.value = null;
  }
};

const createCampaign = async () => {
  if (!selectedFile.value) {
    error.value = "Please select a reference image first";
    return;
  }

  error.value = "";
  const formData = new FormData();
  formData.append("image", selectedFile.value);
  formData.append("text", targetText.value);
  formData.append("mode", mode.value);

  showRefinement.value = true;

  // Connect SSE via the component
  if (refinementPreview.value) {
    refinementPreview.value.connectSSE(formData);
  }
};

const handleComplete = (data: any) => {
  analysis.value = data;
  loading.value = false;
  progressMessage.value = `✅ Done! ${data.textLayers?.length || 0} text layers found.`;

  // Emit the full data so App.vue can pass to LayerEditor
  emit("created", data);
};

const goToEditor = () => {
  emit("proceed");
};

const useGeneratedBg = () => {
  // We don't need to do much because LayerEditor now prefers generatedBackgroundImageUrl by default
  // But we can trigger the transition to editor immediately
  emit("proceed");
};
</script>

<style scoped>
/* Previous styles... */
.bg-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  background: #f9fafb;
  max-width: 500px;
}
.bg-thumb {
  width: 100%;
  height: auto;
  object-fit: contain;
  display: block;
}
.bg-actions {
  padding: 8px;
  display: flex;
  justify-content: center;
}
.btn-outline-small {
  padding: 6px 12px;
  font-size: 0.8rem;
  background: transparent;
  border: 1px solid var(--primary);
  color: var(--primary);
  border-radius: 6px;
  cursor: pointer;
}
.btn-outline-small:hover {
  background: var(--primary);
  color: white;
}
</style>

<template>
  <div>
    <div class="grid">
      <div class="card">
        <h2>1. Reference Image + Brief</h2>
        <div class="mb-4">
          <label class="label">Upload Reference Ad Image</label>
          <input
            type="file"
            ref="fileInput"
            @change="onFileChange"
            accept="image/*"
            class="file-input"
          />
          <div v-if="previewUrl" class="mini-preview mt-4">
            <img :src="previewUrl" />
          </div>
        </div>

        <div class="mb-4">
          <label class="label">Processing Mode</label>
          <div class="mode-toggle">
            <button
              type="button"
              :class="{ active: mode === 'full' }"
              @click="mode = 'full'"
            >
              Full Separation (Text + Components)
            </button>
            <button
              type="button"
              :class="{ active: mode === 'text' }"
              @click="mode = 'text'"
            >
              Text & Background Only
            </button>
          </div>
        </div>

        <div class="mb-4">
          <label class="label">Campaign Text Brief</label>
          <textarea
            v-model="targetText"
            placeholder="Paste your ad brief, headlines, bullet points, or fine print here..."
            rows="6"
          ></textarea>
          <!-- <p class="small">
          AI จะวิเคราะห์ภาพ แนะนำ text + สร้าง die-cut components ให้อัตโนมัติ
        </p> -->
        </div>

        <button :disabled="loading" @click="createCampaign">
          {{ loading ? progressMessage : "Create Campaign Layers" }}
        </button>

        <div v-if="error" class="error mt-4">{{ error }}</div>
      </div>

      <div class="card" v-if="analysis">
        <h2>2. AI Analysis Results</h2>

        <div class="analysis-info mb-4">
          <p><strong>Vibe:</strong> {{ analysis.campaignVibe }}</p>
          <p class="secondary">{{ analysis.backgroundDescription }}</p>
        </div>

        <!-- Generated Background Preview -->
        <div
          v-if="analysis.generatedBackgroundImageUrl"
          class="bg-preview-section mt-4 mb-6"
        >
          <h3>AI Generated Clean Background</h3>
          <div class="bg-card">
            <img
              :src="`http://localhost:5001${analysis.generatedBackgroundImageUrl}`"
              class="bg-thumb"
              alt="Generated Background"
            />
            <div class="bg-actions mt-2">
              <button @click="useGeneratedBg" class="btn-outline-small">
                Use as Editor Background
              </button>
            </div>
          </div>
        </div>

        <!-- Text suggestions -->
        <h3 v-if="analysis.textLayers?.length">
          Text Layers ({{ analysis.textLayers.length }})
        </h3>
        <div class="suggestions-list">
          <div
            v-for="(s, idx) in analysis.textLayers"
            :key="'t' + idx"
            class="suggestion-item"
          >
            <div class="suggestion-header">
              <span
                class="hierarchy-badge"
                :class="(s.hierarchy || '').toLowerCase()"
              >
                {{ s.hierarchy || "Text" }}
              </span>
              <span class="position-info">
                x:{{ s.position?.left }} y:{{ s.position?.top }} ({{
                  s.position?.width
                }}x{{ s.position?.height }})
              </span>
            </div>
            <h4 class="text-preview">{{ s.part }}</h4>
            <div class="style-tag">
              {{ s.style?.font_family }} | {{ s.style?.font_weight }} |
              <span :style="{ color: s.style?.color_hex }">{{
                s.style?.color_hex
              }}</span>
            </div>
            <div class="style-details">
              <span class="detail-badge"
                >Size: {{ s.style?.font_size_normalized }}</span
              >
              <span
                class="detail-badge"
                v-if="s.style?.letter_spacing !== undefined"
              >
                Letter: {{ s.style?.letter_spacing }}px
              </span>
              <span class="detail-badge" v-if="s.style?.line_height">
                Line: {{ s.style?.line_height }}
              </span>
            </div>
          </div>
        </div>

        <!-- Raw stack preview -->
        <div v-if="analysis.stackImageUrls?.length" class="stack-preview mt-4">
          <h3>AI Generated Stacks (raw)</h3>
          <div class="stack-images-grid">
            <img
              v-for="(url, idx) in analysis.stackImageUrls"
              :key="idx"
              :src="`http://localhost:5001${url}`"
              alt="Stack preview"
              class="stack-img mb-2"
            />
          </div>
        </div>

        <!-- Visual components -->
        <h3 v-if="analysis.visualComponents?.length" class="mt-4">
          Components ({{ analysis.visualComponents.length }})
        </h3>
        <div class="component-grid">
          <div
            v-for="(c, idx) in analysis.visualComponents"
            :key="'c' + idx"
            class="component-card"
          >
            <img :src="`http://localhost:5001${c.imageUrl}`" :alt="c.label" />
            <span class="component-label">{{ c.label }}</span>
            <span class="position-info small">
              x:{{ c.position?.left }} y:{{ c.position?.top }} | z:{{
                c.z_index
              }}
            </span>
          </div>
        </div>

        <div class="mt-4">
          <button @click="goToEditor" class="btn-primary">
            Open in Layer Editor &rarr;
          </button>
        </div>
      </div>
    </div>

    <!-- Final AI Review Workspace -->
    <AIRefinementPreview
      :show="showRefinement"
      ref="refinementPreview"
      @close="showRefinement = false"
      @complete="handleComplete"
    />
  </div>
</template>

<style scoped>
.label {
  display: block;
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 0.9rem;
}

.mode-toggle {
  display: flex;
  gap: 8px;
  background: #f2f4f7;
  padding: 4px;
  border-radius: 8px;
  margin-bottom: 8px;
}

.mode-toggle button {
  flex: 1;
  padding: 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  color: #475467;
}

.mode-toggle button.active {
  background: white;
  color: var(--primary);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.mode-toggle button:hover:not(.active) {
  background: rgba(255, 255, 255, 0.5);
}

.file-input {
  width: 100%;
  padding: 8px;
  border: 1px dashed var(--border);
  border-radius: 8px;
}

textarea {
  min-height: 150px;
  resize: vertical;
  line-height: 1.6;
  font-family: inherit;
}

.small {
  font-size: 0.8rem;
  color: var(--secondary);
  margin-top: -8px;
  margin-bottom: 16px;
  display: block;
}

.mini-preview {
  width: 100%;
  border-radius: 8px;
  border: 1px solid var(--border);
  margin-top: 12px;
}

.mini-preview img {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 8px;
}

.error {
  color: #d92d20;
  background: #fef3f2;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #fecdca;
  font-size: 0.9rem;
}

.suggestion-item {
  border: 1px solid var(--border);
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 12px;
}

.suggestion-item h4 {
  margin-bottom: 4px;
  font-size: 1rem;
}

.text-preview {
  white-space: pre-wrap;
}

.small {
  font-size: 0.8rem;
  color: var(--secondary);
  margin-bottom: 4px;
}
.rationale {
  font-size: 0.85rem;
  margin-bottom: 8px;
}

.style-tag {
  font-size: 0.75rem;
  background: #f2f4f7;
  padding: 4px 8px;
  border-radius: 4px;
  display: inline-block;
  font-family: monospace;
  margin-bottom: 6px;
}

.style-details {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.detail-badge {
  font-size: 0.7rem;
  background: #e8f5e9;
  color: #2e7d32;
  padding: 3px 8px;
  border-radius: 12px;
  font-family: monospace;
  font-weight: 500;
}

.btn-secondary {
  background-color: #344054;
}

.btn-secondary:hover {
  background-color: #1d2939;
}

.full-width {
  grid-column: 1 / -1;
}

.final-image {
  border-radius: 12px;
  overflow: hidden;
  border: 4px solid var(--primary);
}

.final-image img {
  width: 100%;
  display: block;
}

.btn-download {
  display: inline-block;
  padding: 10px 20px;
  background: var(--primary);
  color: white;
  text-decoration: none;
  border-radius: 8px;
  font-weight: 600;
}

.btn-primary {
  display: inline-block;
  padding: 10px 20px;
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:hover {
  background: #1d4ed8;
}

.component-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  margin-top: 8px;
}

.component-card {
  background: repeating-conic-gradient(#e0e0e0 0% 25%, #fff 0% 50%) 50% / 16px
    16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  text-align: center;
  padding: 8px;
}

.component-card img {
  width: 100%;
  height: 100px;
  object-fit: contain;
}

.component-label {
  display: block;
  font-size: 0.75rem;
  margin-top: 4px;
  color: var(--secondary);
  background: rgba(255, 255, 255, 0.9);
  border-radius: 4px;
  padding: 2px 4px;
}

.suggestion-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.hierarchy-badge {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 4px;
  letter-spacing: 0.05em;
}

.hierarchy-badge.headline {
  background: #dbeafe;
  color: #1d4ed8;
}

.hierarchy-badge.body {
  background: #dcfce7;
  color: #16a34a;
}

.hierarchy-badge.fineprint {
  background: #f3f4f6;
  color: #6b7280;
}

.hierarchy-badge.text {
  background: #fef3c7;
  color: #d97706;
}

.position-info {
  font-size: 0.7rem;
  color: var(--secondary);
  font-family: monospace;
}

.position-info.small {
  display: block;
  margin-top: 2px;
  font-size: 0.65rem;
}

.stack-preview {
  margin-top: 16px;
}

.stack-images-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stack-img {
  max-width: 100%;
  border: 2px solid var(--border);
  border-radius: 8px;
}
</style>
