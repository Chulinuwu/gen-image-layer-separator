<script setup lang="ts">
import { ref, onMounted } from "vue";

const props = defineProps({
  initialBackgroundUrl: String,
});
const emit = defineEmits(["rendered", "proceed"]);

const targetText = ref("SUMMER SALE 50%");
const loading = ref(false);
const rendering = ref(false);
const analysis = ref<any>(null);
const renderedImage = ref<string | null>(null);
const error = ref("");
const selectedFile = ref<File | null>(null);
const previewUrl = ref<string | null>(null);

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
    renderedImage.value = null;
  }
};

const analyzeCampaign = async () => {
  if (!selectedFile.value) {
    error.value = "Please select an image first";
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    const formData = new FormData();
    formData.append("image", selectedFile.value);
    formData.append("text", targetText.value);

    const response = await fetch("http://localhost:5001/api/image/add-text", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (data.success) {
      analysis.value = data.data;
    } else {
      error.value = data.error || "Failed to analyze";
    }
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};

const renderImage = async () => {
  if (!selectedFile.value || !analysis.value) return;

  rendering.value = true;
  error.value = "";

  try {
    const formData = new FormData();
    formData.append("image", selectedFile.value);
    formData.append("suggestions", JSON.stringify(analysis.value.suggestions));

    const response = await fetch(
      "http://localhost:5001/api/image/render-text",
      {
        method: "POST",
        body: formData,
      },
    );

    const data = await response.json();
    if (data.success) {
      renderedImage.value = data.data.imageUrl;
      emit("rendered", { url: data.data.imageUrl, text: targetText.value });
    } else {
      error.value = data.error || "Failed to render";
    }
  } catch (err: any) {
    error.value = err.message;
  } finally {
    rendering.value = false;
  }
};

const goToEditor = () => {
  emit("proceed");
};
</script>

<template>
  <div class="grid">
    <div class="card">
      <h2>1. Analyze Image</h2>
      <div class="mb-4">
        <label class="label">Step 1: Upload Image</label>
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
        <label class="label">Step 2: Campaign Text</label>
        <input
          type="text"
          v-model="targetText"
          placeholder="What do you want to say?"
        />
      </div>

      <button :disabled="loading" @click="analyzeCampaign">
        {{ loading ? "Analyzing..." : "Get AI Suggestions" }}
      </button>

      <div v-if="error" class="error mt-4">{{ error }}</div>
    </div>

    <div class="card" v-if="analysis">
      <h2>2. AI Suggestions</h2>
      <div class="analysis-info mb-4">
        <p><strong>Vibe:</strong> {{ analysis.campaign_vibe }}</p>
        <p class="secondary">{{ analysis.background_analysis }}</p>
      </div>

      <div class="suggestions-list">
        <div
          v-for="(s, idx) in analysis.suggestions"
          :key="idx"
          class="suggestion-item"
        >
          <h4>Part: {{ s.part }}</h4>
          <p class="small">
            Position: Top {{ s.position.top }}, Left {{ s.position.left }}
          </p>
          <p class="rationale">{{ s.rationale }}</p>
          <div class="style-tag">
            Style: {{ s.style.font_family }} | {{ s.style.font_weight }} |
            <span :style="{ color: s.style.color_hex }">{{
              s.style.color_hex
            }}</span>
          </div>
        </div>
      </div>

      <div class="mt-4">
        <button
          :disabled="rendering"
          @click="renderImage"
          class="btn-secondary"
        >
          {{
            rendering
              ? "Rendering Pixel-Perfect Image..."
              : "Apply & Render Image"
          }}
        </button>
      </div>
    </div>

    <div class="card full-width" v-if="renderedImage">
      <h2>3. Final Ad Result</h2>
      <div class="final-image">
        <img :src="`http://localhost:5001${renderedImage}`" />
      </div>
      <div class="mt-4 flex gap-4">
        <a
          :href="`http://localhost:5001${renderedImage}`"
          download
          class="btn-download"
          >Download Ad</a
        >
        <button @click="goToEditor" class="btn-primary">
          Final Touch: AI Layer Editor &rarr;
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

.file-input {
  width: 100%;
  padding: 8px;
  border: 1px dashed var(--border);
  border-radius: 8px;
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
</style>
