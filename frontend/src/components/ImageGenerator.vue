<script setup lang="ts">
import { ref } from "vue";

const prompt = ref("An office group photo of people looking stressed");
const aspectRatio = ref("4:3");
const loading = ref(false);
const result = ref<any>(null);
const error = ref("");

const emit = defineEmits(["generated", "proceed"]);

const generateImage = async () => {
  loading.value = true;
  error.value = "";
  result.value = null;

  console.log("[Frontend] Generating image with aspect_ratio:", aspectRatio.value);

  try {
    const formData = new FormData();
    formData.append("prompt", prompt.value);
    formData.append("aspect_ratio", aspectRatio.value);

    console.log("[Frontend] FormData contents:", {
      prompt: prompt.value,
      aspect_ratio: aspectRatio.value
    });

    const response = await fetch("http://localhost:5001/api/image/generate", {
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
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
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

    <button :disabled="loading" @click="generateImage">
      {{ loading ? "Generating..." : "Generate Image" }}
    </button>

    <div v-if="error" class="error mt-4">{{ error }}</div>

    <div v-if="result" class="result mt-4">
      <h3>Result</h3>
      <div class="image-container">
        <img :src="`http://localhost:5001${result.imageUrl}`" alt="Generated" />
      </div>
      <p class="mt-4">{{ result.text }}</p>

      <div class="flex gap-4">
        <a
          :href="`http://localhost:5001${result.imageUrl}`"
          target="_blank"
          class="btn-link"
          >Open Full Image</a
        >
        <button @click="goToCampaign" class="btn-primary mini">
          Next: Layout & Text &rarr;
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
}

.image-container img {
  width: 100%;
  height: auto;
  display: block;
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
</style>
