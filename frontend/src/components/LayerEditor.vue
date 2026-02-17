<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";

const props = defineProps({
  initialImage: String,
  initialBackground: String,
  initialHint: String,
});

const loading = ref(false);
const rendering = ref(false);
const layers = ref<any[]>([]);
const error = ref("");
const selectedFile = ref<File | null>(null);
const bgFile = ref<File | null>(null);
const previewUrl = ref<string | null>(null);
const bgPreviewUrl = ref<string | null>(null);
const canvasContainer = ref<HTMLElement | null>(null);
const renderedImage = ref<string | null>(null);
const hintText = ref("");

onMounted(async () => {
  if (props.initialHint) hintText.value = props.initialHint;

  if (props.initialImage) {
    try {
      const response = await fetch(
        `http://localhost:5001${props.initialImage}`,
      );
      const blob = await response.blob();
      selectedFile.value = new File([blob], "campaign.png", {
        type: blob.type,
      });
      previewUrl.value = URL.createObjectURL(selectedFile.value);
    } catch (e) {
      console.error("Editor: Failed to load initial image", e);
    }
  }

  if (props.initialBackground) {
    try {
      const response = await fetch(
        `http://localhost:5001${props.initialBackground}`,
      );
      const blob = await response.blob();
      bgFile.value = new File([blob], "background.png", { type: blob.type });
      bgPreviewUrl.value = URL.createObjectURL(bgFile.value);
    } catch (e) {
      console.error("Editor: Failed to load initial background", e);
    }
  }
});

// Selected Layer for UI
const selectedLayerId = ref<number | null>(null);

// Dragging state
const dragItem = ref<number | null>(null);
const dragOffset = reactive({ x: 0, y: 0 });

const onFileChange = (e: any) => {
  const file = e.target.files[0];
  if (file) {
    selectedFile.value = file;
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = URL.createObjectURL(file);
    layers.value = [];
    renderedImage.value = null;
    selectedLayerId.value = null;
  }
};

const onBgChange = (e: any) => {
  const file = e.target.files[0];
  if (file) {
    bgFile.value = file;
    if (bgPreviewUrl.value) URL.revokeObjectURL(bgPreviewUrl.value);
    bgPreviewUrl.value = URL.createObjectURL(file);
  }
};

const processImage = async () => {
  if (!selectedFile.value) return;
  loading.value = true;
  error.value = "";

  try {
    const formData = new FormData();
    formData.append("image", selectedFile.value);
    if (bgFile.value) {
      formData.append("background", bgFile.value);
    }
    if (hintText.value) {
      formData.append("hintText", hintText.value);
    }

    const response = await fetch("http://localhost:5001/api/image/process", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (data.success && data.data.analysis.layers) {
      layers.value = data.data.analysis.layers.map((l: any, idx: number) => ({
        ...l,
        id: idx,
        x: l.position.left / 10,
        y: l.position.top / 10,
        w: l.position.width / 10,
        h: l.position.height / 10,
      }));
    } else {
      error.value = "No layers detected or failed to process";
    }
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};

const renderImage = async () => {
  if (!selectedFile.value || !layers.value.length) return;
  rendering.value = true;
  error.value = "";

  try {
    const formData = new FormData();
    formData.append("image", selectedFile.value);
    if (bgFile.value) {
      formData.append("background", bgFile.value);
    }

    const suggestions = layers.value.map((l) => ({
      part: l.content,
      position: {
        top: Math.round(l.y * 10),
        left: Math.round(l.x * 10),
        width: Math.round(l.w * 10),
        height: Math.round(l.h * 10),
        explanation: "Manual manual adjustment",
      },
      style: l.style,
    }));

    formData.append("suggestions", JSON.stringify(suggestions));

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
    } else {
      error.value = data.error || "Failed to render";
    }
  } catch (err: any) {
    error.value = err.message;
  } finally {
    rendering.value = false;
  }
};

// Dragging Logic
const startDrag = (e: MouseEvent, idx: number) => {
  selectedLayerId.value = idx;
  dragItem.value = idx;

  const clientX = e.clientX;
  const clientY = e.clientY;

  const layer = layers.value[idx];
  const rect = canvasContainer.value?.getBoundingClientRect();
  if (!rect) return;

  const posX = (layer.x / 100) * rect.width;
  const posY = (layer.y / 100) * rect.height;

  dragOffset.x = clientX - rect.left - posX;
  dragOffset.y = clientY - rect.top - posY;

  window.addEventListener("mousemove", onDrag);
  window.addEventListener("mouseup", stopDrag);
};

const onDrag = (e: MouseEvent) => {
  if (dragItem.value === null || !canvasContainer.value) return;

  const rect = canvasContainer.value.getBoundingClientRect();
  const x = e.clientX - rect.left - dragOffset.x;
  const y = e.clientY - rect.top - dragOffset.y;

  layers.value[dragItem.value].x = (x / rect.width) * 100;
  layers.value[dragItem.value].y = (y / rect.height) * 100;
};

const stopDrag = () => {
  dragItem.value = null;
  window.removeEventListener("mousemove", onDrag);
  window.removeEventListener("mouseup", stopDrag);
};

const isResizing = ref(false);
const startSize = ref(0);
const startY = ref(0);

const startResize = (e: MouseEvent, idx: number) => {
  isResizing.value = true;
  selectedLayerId.value = idx;
  startSize.value = Number(layers.value[idx].style.font_size_normalized);
  startY.value = e.clientY;

  window.addEventListener("mousemove", onResize);
  window.addEventListener("mouseup", stopResize);
};

const onResize = (e: MouseEvent) => {
  if (!isResizing.value || selectedLayerId.value === null) return;
  const deltaY = e.clientY - startY.value;
  const newSize = Math.max(8, startSize.value + deltaY);
  layers.value[selectedLayerId.value].style.font_size_normalized = newSize;
};

const stopResize = () => {
  isResizing.value = false;
  window.removeEventListener("mousemove", onResize);
  window.removeEventListener("mouseup", stopResize);
};

const updateText = (idx: number, e: Event) => {
  const target = e.target as HTMLElement;
  layers.value[idx].content = target.innerText;
};

// Fix Focus Cursor at end
const selectAll = (e: FocusEvent) => {
  selectedLayerId.value = layers.value.findIndex(
    (l) => (e.target as HTMLElement).innerText === l.content,
  );
  // Optional: auto select all text
  // window.getSelection()?.selectAllChildren(e.target as HTMLElement);
};

// Selection layer finding
const deleteLayer = () => {
  if (selectedLayerId.value !== null) {
    layers.value.splice(selectedLayerId.value, 1);
    selectedLayerId.value = null;
  }
};
</script>

<template>
  <div class="card editor-layout">
    <div class="controls mb-4">
      <h2>Layer Separator & Editor</h2>
      <div class="flex vertical">
        <div class="input-group">
          <label class="label">Main Image (with text)</label>
          <input type="file" @change="onFileChange" accept="image/*" />
        </div>
        <div class="input-group">
          <label class="label">Background Image (optional)</label>
          <input type="file" @change="onBgChange" accept="image/*" />
        </div>
        <div class="input-group">
          <label class="label">Intended Text (Hint for AI)</label>
          <input
            v-model="hintText"
            type="text"
            placeholder="e.g. SUMMER SALE 50%"
            class="hint-input"
          />
        </div>
        <button
          :disabled="!selectedFile || loading"
          @click="processImage"
          class="mt-2"
        >
          {{ loading ? "Separating Layers..." : "Separate Layers" }}
        </button>
      </div>
      <div v-if="error" class="error mt-4">{{ error }}</div>
    </div>

    <!-- Active Layer Bar (Moves to top or follows selection) -->
    <div v-if="selectedLayerId !== null" class="property-bar mb-4">
      <div class="flex align-center gap-4 w-full">
        <div class="prop-item">
          <label>Text Content</label>
          <input v-model="layers[selectedLayerId].content" type="text" />
        </div>
        <div class="prop-item">
          <label>Font</label>
          <select v-model="layers[selectedLayerId].style.font_family">
            <option value="Inter">Inter (Clean)</option>
            <option value="Kanit">Kanit (Thai)</option>
            <option value="Playfair Display">Playfair (Lux)</option>
            <option value="Roboto Mono">Mono</option>
            <option value="sans-serif">System Sans</option>
          </select>
        </div>
        <div class="prop-item">
          <label>Size</label>
          <div class="flex no-gap">
            <button
              class="mini-btn left"
              @click="layers[selectedLayerId].style.font_size_normalized -= 5"
            >
              -
            </button>
            <input
              v-model="layers[selectedLayerId].style.font_size_normalized"
              type="number"
              class="w-16"
            />
            <button
              class="mini-btn right"
              @click="layers[selectedLayerId].style.font_size_normalized += 5"
            >
              +
            </button>
          </div>
        </div>
        <div class="prop-item">
          <label>Color</label>
          <div class="color-picker-wrapper">
            <input
              v-model="layers[selectedLayerId].style.color_hex"
              type="color"
            />
          </div>
        </div>
        <div class="prop-item ml-auto">
          <button class="btn-danger" @click="deleteLayer">Delete</button>
        </div>
      </div>
    </div>

    <div class="editor-view" ref="canvasContainer">
      <div
        v-if="previewUrl"
        class="canvas"
        @mousedown.self="selectedLayerId = null"
      >
        <img
          :src="layers.length > 0 ? bgPreviewUrl || previewUrl : previewUrl"
          class="bg-img"
        />

        <div
          v-for="(layer, idx) in layers"
          :key="idx"
          class="text-layer"
          :class="{ active: selectedLayerId === idx }"
          :style="{
            top: layer.y + '%',
            left: layer.x + '%',
            color: layer.style.color_hex,
            fontSize: layer.style.font_size_normalized + 'px',
            fontFamily: `${layer.style.font_family}, sans-serif`,
            fontWeight: layer.style.font_weight,
          }"
          @mousedown="startDrag($event, idx)"
        >
          <span
            contenteditable="true"
            @input="updateText(idx, $event)"
            @focus="selectAll"
            class="editable-text"
            v-text="layer.content"
          ></span>
          <div
            v-if="selectedLayerId === idx"
            class="resize-handle"
            @mousedown.stop="startResize($event, idx)"
          ></div>
        </div>
      </div>
      <div v-else class="placeholder">Upload an image to start editing</div>
    </div>

    <div v-if="layers.length" class="layer-actions mt-4">
      <button :disabled="rendering" @click="renderImage" class="btn-primary">
        {{
          rendering ? "Rendering Final Image..." : "Save & Render Final Image"
        }}
      </button>
    </div>

    <div v-if="renderedImage" class="card mt-4 result-card">
      <h3>Rendered Result</h3>
      <div class="flex">
        <img
          :src="`http://localhost:5001${renderedImage}`"
          class="result-img"
        />
      </div>
      <div class="mt-4">
        <a
          :href="`http://localhost:5001${renderedImage}`"
          download
          class="btn-download"
          >Download Result</a
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
.property-bar {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(16, 24, 40, 0.1);
  padding: 12px 20px;
  border-radius: 16px;
  box-shadow: 0 10px 15px -3px rgba(16, 24, 40, 0.1);
  position: sticky;
  top: 10px;
  z-index: 100;
  display: flex;
  align-items: center;
  transition: all 0.3s ease;
}

.prop-item h4 {
  margin: 0 0 4px 0;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--secondary);
}

.prop-item label {
  display: block;
  font-size: 0.75rem;
  font-weight: 700;
  color: #344054;
  margin-bottom: 6px;
}

.prop-item input,
.prop-item select {
  padding: 8px 12px;
  margin-bottom: 0;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  font-size: 0.9rem;
  transition: border-color 0.2s;
}

.prop-item input:focus,
.prop-item select:focus {
  border-color: #2563eb;
  outline: none;
}

.hint-input {
  width: 100%;
  padding: 10px 14px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
}

.mini-btn {
  width: 32px;
  height: 38px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border: 1px solid #d0d5dd;
  cursor: pointer;
  font-weight: 600;
  color: #344054;
  transition: all 0.2s;
}

.mini-btn.left {
  border-radius: 8px 0 0 8px;
  border-right: none;
}

.mini-btn.right {
  border-radius: 0 8px 8px 0;
  border-left: none;
}

.mini-btn:hover {
  background: #f9fafb;
}

.w-16 {
  width: 50px;
  height: 38px;
  text-align: center;
  border-radius: 0 !important;
  border-left: 1px solid #d0d5dd !important;
  border-right: 1px solid #d0d5dd !important;
}

.color-picker-wrapper {
  width: 44px;
  height: 38px;
  padding: 4px;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.color-picker-wrapper input[type="color"] {
  border: none;
  width: 100%;
  height: 100%;
  padding: 0;
  cursor: pointer;
  background: none;
}

.btn-danger {
  background: #fee4e2;
  color: #d92d20;
  border: 1px solid #fda29b;
  height: 38px;
  padding: 0 16px;
  align-self: flex-end;
  border-radius: 8px;
}
.btn-danger:hover {
  background: #fef3f2;
}

.w-full {
  width: 100%;
}
.ml-auto {
  margin-left: auto;
}
.no-gap {
  gap: 0 !important;
}

.text-layer.active {
  outline: 2px solid var(--primary);
  outline-offset: 4px;
}

.resize-handle {
  position: absolute;
  bottom: -5px;
  right: -5px;
  width: 10px;
  height: 10px;
  background: var(--primary);
  cursor: nwse-resize;
}

.editor-layout {
  display: flex;
  flex-direction: column;
}
.flex.vertical {
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
.input-group {
  width: 100%;
}
.label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--secondary);
}

.editor-view {
  position: relative;
  width: 100%;
  background: #f2f4f7;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.05);
  margin-top: 10px;
}

.canvas {
  position: relative;
  width: 100%;
  line-height: 0;
  cursor: crosshair;
}
.bg-img {
  width: 100%;
  display: block;
}

.text-layer {
  position: absolute;
  cursor: move;
  padding: 2px 4px;
  user-select: none;
  white-space: nowrap;
  line-height: 1;
}

.editable-text {
  outline: none;
  display: inline-block;
  min-width: 10px;
  padding: 2px;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 500px;
  color: var(--secondary);
  font-weight: 600;
}

.btn-download {
  display: inline-block;
  padding: 12px 24px;
  background: var(--primary);
  color: white;
  text-decoration: none;
  border-radius: 8px;
  font-weight: 600;
}
.btn-primary {
  width: 100%;
  margin-top: 20px;
}
.result-card {
  border: 4px solid var(--primary);
  margin-top: 32px;
}
.result-img {
  width: 100%;
  border-radius: 8px;
}

.align-center {
  align-items: center;
}
.gap-4 {
  gap: 16px;
}
</style>
