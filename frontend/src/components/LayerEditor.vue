<script setup lang="ts">
import { ref, reactive, watch, computed, onMounted, onUnmounted } from "vue";
import createDOMPurify from "dompurify";
import CustomDropdown from "./CustomDropdown.vue";
import CustomInput from "./CustomInput.vue";
const DOMPurify = createDOMPurify(window);

const props = defineProps({
  initialBackground: String,
  campaignData: Object as () => any,
  outputFormat: { type: String, default: 'standard' },
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
const editorCanvasEl = ref<HTMLElement | null>(null);

const onEditorImageLoad = (e: Event) => {
  const img = e.target as HTMLImageElement;
  if (img.naturalWidth && img.naturalHeight && editorCanvasEl.value) {
    const ratio = `${img.naturalWidth} / ${img.naturalHeight}`;
    editorCanvasEl.value.style.aspectRatio = ratio;
  }
};

const renderedImage = ref<string | null>(null);
const hintText = ref("");
const renderMode = ref("ai");
const zoomLevel = ref(100);

const svgOverlay = ref<string>("");
const backgroundEffects = ref<any[]>([]);
const hasSvgOverlay = computed(() => !!svgOverlay.value && svgOverlay.value.length > 50);
const sanitizedEditorSvgOverlay = computed(() => {
  if (!svgOverlay.value) return "";
  return DOMPurify.sanitize(svgOverlay.value, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: [
      "svg", "g", "text", "tspan", "rect", "defs", "filter",
      "feDropShadow", "image", "style", "clipPath",
    ],
    ADD_ATTR: [
      "viewBox", "xmlns", "transform", "font-family", "font-size",
      "font-weight", "fill", "stroke", "stroke-width", "paint-order",
      "filter", "dy", "dx", "x", "y", "rx", "ry", "width", "height",
      "flood-color", "flood-opacity", "stdDeviation", "in",
      "preserveAspectRatio", "id", "letter-spacing", "clip-path",
    ],
  });
});

watch(
  () => props.initialBackground,
  async (bgUrl) => {
    if (!bgUrl) return;
    try {
      const response = await fetch(`http://localhost:5001${bgUrl}`);
      const blob = await response.blob();
      bgFile.value = new File([blob], "background.png", { type: blob.type });
      bgPreviewUrl.value = URL.createObjectURL(bgFile.value);
    } catch (e) {
      console.error("Editor: Failed to load initial background", e);
    }
  },
  { immediate: true },
);

watch(
  () => props.campaignData,
  async (data) => {
    if (!data) return;

    const bgToUse = data.generatedBackgroundImageUrl || data.referenceImage;
    if (bgToUse) {
      try {
        const response = await fetch(`http://localhost:5001${bgToUse}`);
        const blob = await response.blob();
        bgFile.value = new File([blob], "background.png", { type: blob.type });
        bgPreviewUrl.value = URL.createObjectURL(bgFile.value);
      } catch (e) {
        console.error("Editor: Failed to load background", e);
      }
    }

    if (data.referenceImage) {
      try {
        const response = await fetch(`http://localhost:5001${data.referenceImage}`);
        const blob = await response.blob();
        selectedFile.value = new File([blob], "reference.png", { type: blob.type });
        previewUrl.value = URL.createObjectURL(selectedFile.value);
      } catch (e) {
        console.error("Editor: Failed to load reference image", e);
      }
    }

    const newLayers: any[] = [];
    let layerId = 0;

    const fontRatio: Record<string, number> = {
      xlarge: 1.0, large: 0.75, medium: 0.5, small: 0.35, xsmall: 0.22,
    };

    const canvasW = data.canvasSize?.w || 1080;
    const canvasH = data.canvasSize?.h || 1080;

    const compUrls: Record<string, string> = {};
    if (data.visualComponents?.length) {
      for (const vc of data.visualComponents) {
        compUrls[vc.label] = `http://localhost:5001${vc.imageUrl}`;
      }
    }

    if (data.computedBoxes?.length) {
      for (const box of data.computedBoxes) {
        if (box.type === 'component') {
          const imgUrl = compUrls[box.label || ''] || '';
          if (imgUrl) {
            newLayers.push({
              type: 'image',
              label: box.label || box.id,
              imageUrl: imgUrl,
              id: layerId++,
              x: Math.round((box.x / canvasW) * 10000) / 100,
              y: Math.round((box.y / canvasH) * 10000) / 100,
              w: Math.round((box.w / canvasW) * 10000) / 100,
              h: Math.round((box.h / canvasH) * 10000) / 100,
              rotation: 0,
              z_index: 15,
              visible: true,
              skewX: 0,
              skewY: 0,
              perspective: 0,
              rotateX: 0,
              rotateY: 0,
            });
          }
        } else if (box.type === 'text' && box.text) {
          const s = box.style || {};
          let pxFont: number;
          const rawSize = s.fontSize || 'medium';
          const parsed = parseInt(rawSize, 10);
          if (!isNaN(parsed) && parsed > 0) {
            pxFont = parsed;
          } else {
            const ratio = fontRatio[rawSize] || 0.5;
            pxFont = Math.round(box.h * ratio);
          }
          const fontSizeNormalized = Math.round((pxFont / canvasW) * 1000);

          newLayers.push({
            type: 'text',
            content: box.text,
            id: layerId++,
            x: Math.round((box.x / canvasW) * 10000) / 100,
            y: Math.round((box.y / canvasH) * 10000) / 100,
            w: Math.round((box.w / canvasW) * 10000) / 100,
            h: Math.round((box.h / canvasH) * 10000) / 100,
            rotation: 0,
            z_index: 10,
            visible: true,
            visual_container: 'none',
            style: {
              font_family: 'Kanit',
              font_weight: s.fontWeight || '700',
              font_size_normalized: fontSizeNormalized,
              color_hex: s.color || '#FFFFFF',
              stroke_hex: s.strokeColor || (s.strokeWidth ? '#FFFFFF' : undefined),
              stroke_width: s.strokeWidth ?? (s.strokeColor ? 3 : undefined),
              letter_spacing: s.letterSpacing || 0,
              line_height: s.lineHeight || 1.35,
              shadow: s.textShadow || 'subtle',
              align: s.align || 'center',
              background_color: s.backgroundColor || undefined,
              skewX: s.skewX || 0,
              skewY: s.skewY || 0,
              perspective: s.perspective || 0,
              rotateX: s.rotateX || 0,
              rotateY: s.rotateY || 0,
              warpType: s.warpType || 'none',
              warpIntensity: s.warpIntensity || 0,
              warpHDistortion: s.warpHDistortion || 0,
              warpVDistortion: s.warpVDistortion || 0,
            },
          });
        }
      }
    }

    backgroundEffects.value = data.backgroundEffects || [];

    if (newLayers.length > 0) {
      svgOverlay.value = "";
      layers.value = newLayers;
    } else if (data.svg_overlay && data.svg_overlay.length > 50) {
      svgOverlay.value = data.svg_overlay;
      layers.value = [];
    } else {
      svgOverlay.value = "";
      layers.value = [];
    }

    setTimeout(() => {
      layers.value.forEach((layer) => {
        if (layer.type === "text") {
          const el = textRefs.value[layer.id];
          if (el) el.innerText = layer.content;
        }
      });
    }, 0);
  },
  { immediate: true },
);

const selectedLayerId = ref<number | null>(null);
const selectedLayerIds = ref<number[]>([]);
const isFullscreen = ref(false);
const marquee = reactive({
  active: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
});
const dragItem = ref<number | null>(null);
const dragOffset = reactive({ x: 0, y: 0 });
const dragStartPositions = ref<Record<number, { x: number; y: number }>>({});
const snapGuides = ref<{ type: 'h' | 'v'; pos: number }[]>([]);
const SNAP_THRESHOLD = 1;
const focusedLayerId = ref<number | null>(null);
const textRefs = ref<Record<number, HTMLElement>>({});

const selectedLayer = computed(() => {
  if (selectedLayerId.value === null) return null;
  return layers.value[selectedLayerId.value] || null;
});

const selectedLayers = computed(() => {
  if (selectedLayerIds.value.length === 0) return [];
  return selectedLayerIds.value.map(idx => layers.value[idx]).filter(Boolean);
});

const multiSelectCount = computed(() => selectedLayerIds.value.length);

const getMultiProp = (getter: (l: any) => any): { value: any; mixed: boolean } => {
  const selected = selectedLayers.value;
  if (selected.length === 0) return { value: null, mixed: false };
  if (selected.length === 1) return { value: getter(selected[0]), mixed: false };
  const first = getter(selected[0]);
  const allSame = selected.every(l => getter(l) === first);
  return { value: allSame ? first : null, mixed: !allSame };
};

const setMultiProp = (setter: (l: any, val: any) => void, val: any) => {
  for (const idx of selectedLayerIds.value) {
    const layer = layers.value[idx];
    if (layer) setter(layer, val);
  }
};

const setMultiStyle = (key: string, val: any) => {
  for (const idx of selectedLayerIds.value) {
    const layer = layers.value[idx];
    if (layer?.style) (layer.style as any)[key] = val;
  }
};

const marqueeRect = computed(() => {
  if (!marquee.active) return null;
  return {
    left: Math.min(marquee.startX, marquee.currentX),
    top: Math.min(marquee.startY, marquee.currentY),
    width: Math.abs(marquee.currentX - marquee.startX),
    height: Math.abs(marquee.currentY - marquee.startY),
  };
});

const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value;
};

watch(
  () => layers.value,
  (newLayers) => {
    newLayers.forEach((layer) => {
      if (layer.type === "text") {
        const el = textRefs.value[layer.id];
        if (el && focusedLayerId.value !== layers.value.indexOf(layer)) {
          if (el.innerText !== layer.content) {
            el.innerText = layer.content;
          }
        }
      }
    });
  },
  { deep: true },
);

const getEditorContainerStyle = (layer: any): Record<string, string> => {
  const s: Record<string, string> = {};
  if (layer.style?.background_color) {
    s.backgroundColor = layer.style.background_color;
    s.padding = "8px 16px";
    s.borderRadius = "4px";
  }
  if (layer.style?.align) {
    s.textAlign = layer.style.align;
  }
  if (layer.w) {
    s.width = layer.w + "cqw";
  }
  return s;
};

const getShadowStyle = (shadow: string) => {
  switch (shadow) {
    case "subtle":
      return "0 2px 4px rgba(0,0,0,0.5)";
    case "strong":
      return "0 4px 12px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.4)";
    case "outline":
      return "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 0 0 8px rgba(0,0,0,0.5)";
    default:
      return "none";
  }
};

const getBgEffectStyle = (effect: any): Record<string, string> => {
  if (!effect) return {};
  const s: Record<string, string> = {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '1',
  };

  if (effect.type === 'linear-fade') {
    const dir = effect.from === 'top' ? 'to bottom'
      : effect.from === 'left' ? 'to right'
      : effect.from === 'right' ? 'to left'
      : 'to top';
    const color = effect.color || 'rgba(0,0,0,0.7)';
    const size = effect.size || '30%';
    s.background = `linear-gradient(${dir}, ${color} 0%, transparent ${size})`;
  } else if (effect.type === 'radial-fade') {
    const cx = effect.cx ?? 50;
    const cy = effect.cy ?? 50;
    const color = effect.color || 'rgba(0,0,0,0.5)';
    const radius = effect.radius || '60%';
    s.background = `radial-gradient(ellipse at ${cx}% ${cy}%, transparent ${radius}, ${color} 100%)`;
  } else if (effect.type === 'solid-overlay') {
    s.background = effect.color || 'rgba(0,0,0,0.3)';
  }

  if (effect.opacity) {
    s.opacity = String(effect.opacity);
  }

  return s;
};

const getLayerIcon = (layer: any) => {
  if (layer.type === 'image') return 'img';
  return 'T';
};

const getLayerLabel = (layer: any) => {
  if (layer.type === 'image') return layer.label || 'Image';
  const text = layer.content || '';
  return text.length > 20 ? text.substring(0, 20) + '...' : text || 'Text';
};

const onFileChange = (e: any) => {
  const file = e.target.files[0];
  if (file) {
    selectedFile.value = file;
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = URL.createObjectURL(file);
    layers.value = [];
    renderedImage.value = null;
    selectedLayerId.value = null;
    selectedLayerIds.value = [];
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

const processImage = async (mode: string = "full") => {
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
    formData.append("mode", mode);

    const response = await fetch("http://localhost:5001/api/image/process", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (data.success && data.data.analysis.layers) {
      const textLayers = data.data.analysis.layers.map(
        (l: any, idx: number) => ({
          ...l,
          type: "text",
          id: idx,
          x: l.position.left / 10,
          y: l.position.top / 10,
          w: l.position.width / 10,
          h: l.position.height / 10,
          visible: true,
        }),
      );

      const imageLayers: any[] = [];
      if (data.data.visualComponents && data.data.visualComponents.length > 0) {
        for (const comp of data.data.visualComponents) {
          imageLayers.push({
            type: "image",
            label: comp.label,
            imageUrl: `http://localhost:5001${comp.imageUrl}`,
            id: textLayers.length + imageLayers.length,
            x: comp.position.left / 10,
            y: comp.position.top / 10,
            w: comp.position.width / 10,
            h: comp.position.height / 10,
            z_index: comp.z_index || 15,
            interaction_zone: comp.interaction_zone || null,
            visible: true,
          });
        }
      }

      layers.value = [...imageLayers, ...textLayers];
    } else {
      error.value = "No layers detected or failed to process";
    }
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};

const renderOnClient = async (): Promise<Blob | null> => {
  const bgImg = editorCanvasEl.value?.querySelector(".bg-img") as HTMLImageElement;
  if (!bgImg || !layers.value.length) return null;

  const width = bgImg.naturalWidth;
  const height = bgImg.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(bgImg, 0, 0);

  for (const l of layers.value) {
    if (!l.visible) continue;
    const x = (l.x / 100) * width;
    const y = (l.y / 100) * height;
    const w = (l.w / 100) * width;
    const h = (l.h / 100) * height;
    const rotation = l.rotation || 0;

    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    const skX = l.style?.skewX || l.skewX || 0;
    const skY = l.style?.skewY || l.skewY || 0;
    if (skX || skY) {
      ctx.transform(1, Math.tan(skY * Math.PI / 180), Math.tan(skX * Math.PI / 180), 1, 0, 0);
    }
    ctx.translate(-(x + w / 2), -(y + h / 2));

    if (l.type === "image") {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = l.imageUrl;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
        ctx.drawImage(img, x, y, w, h);
      } catch (e) {
        console.error("Client Render: Failed to draw image layer", e);
      }
    } else {
      const fontSize = l.style.font_size_normalized || 40;
      const pxFontSize = (fontSize / 1000) * width;

      ctx.font = `${l.style.font_weight || "normal"} ${pxFontSize}px ${l.style.font_family || "sans-serif"}`;
      ctx.fillStyle = l.style.color_hex || "#FFFFFF";
      ctx.textBaseline = "top";

      if (l.style.shadow !== "none") {
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = l.style.shadow === "strong" ? 12 : 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
      }

      const lines = (l.content || "").split("\n");
      const lineHeight = (l.style.line_height || 1.2) * pxFontSize;

      if (l.style.stroke_hex && l.style.stroke_width) {
        ctx.strokeStyle = l.style.stroke_hex;
        ctx.lineWidth = l.style.stroke_width * 2;
        ctx.lineJoin = "round";
        lines.forEach((line: string, i: number) => {
          ctx.strokeText(line, x, y + i * lineHeight);
        });
      }

      lines.forEach((line: string, i: number) => {
        ctx.fillText(line, x, y + i * lineHeight);
      });
    }
    ctx.restore();
  }

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
};

const renderImage = async () => {
  if (!selectedFile.value || !layers.value.length) return;
  rendering.value = true;
  error.value = "";

  try {
    const formData = new FormData();

    if (renderMode.value === "simple") {
      const blob = await renderOnClient();
      if (!blob) throw new Error("Client rendering failed");
      formData.append("rendered_image", blob, "final.png");
      formData.append("mode", "pre-rendered");
    } else {
      formData.append("image", selectedFile.value);
      if (bgFile.value) {
        formData.append("background", bgFile.value);
      }
      formData.append("mode", "ai");
    }

    const suggestions = layers.value.map((l) => ({
      part: l.type === "text" ? l.content : `[COMPONENT: ${l.label}]`,
      type: l.type,
      imageUrl: l.imageUrl,
      position: {
        top: Math.round(l.y * 10),
        left: Math.round(l.x * 10),
        width: Math.round(l.w * 10),
        height: Math.round(l.h * 10),
        rotation: l.rotation || 0,
        explanation: "Manual adjustment",
      },
      style: l.style || {},
    }));

    formData.append("suggestions", JSON.stringify(suggestions));

    const response = await fetch("http://localhost:5001/api/image/render-text", {
      method: "POST",
      body: formData,
    });

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

// --- Drag logic (FIXED: uses editorCanvasEl instead of canvasContainer) ---
const startDrag = (e: MouseEvent, idx: number) => {
  if (resizeState.active) return;
  const layer = layers.value[idx];
  const isEditable = (e.target as HTMLElement).classList.contains("editable-text");

  if (layer.type === "image" || !isEditable) {
    e.preventDefault();
  }
  e.stopPropagation();

  if (e.shiftKey) {
    if (selectedLayerIds.value.includes(idx)) {
      selectedLayerIds.value = selectedLayerIds.value.filter(i => i !== idx);
      if (selectedLayerId.value === idx) {
        const remaining = selectedLayerIds.value;
        selectedLayerId.value = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }
    } else {
      if (!selectedLayerIds.value.includes(idx)) selectedLayerIds.value.push(idx);
      selectedLayerId.value = idx;
    }
    return;
  }

  if (!selectedLayerIds.value.includes(idx)) {
    selectedLayerIds.value = [];
    if (!selectedLayerIds.value.includes(idx)) selectedLayerIds.value.push(idx);
  }
  selectedLayerId.value = idx;
  dragItem.value = idx;

  const rect = editorCanvasEl.value?.getBoundingClientRect();
  if (!rect) return;

  dragStartPositions.value = {};
  for (const selIdx of selectedLayerIds.value) {
    const l = layers.value[selIdx];
    dragStartPositions.value[selIdx] = { x: l.x, y: l.y };
  }

  dragOffset.x = e.clientX;
  dragOffset.y = e.clientY;

  window.addEventListener("mousemove", onDrag);
  window.addEventListener("mouseup", stopDrag);
};

const onDrag = (e: MouseEvent) => {
  if (dragItem.value === null || !editorCanvasEl.value) return;

  const rect = editorCanvasEl.value.getBoundingClientRect();
  const dx = ((e.clientX - dragOffset.x) / rect.width) * 100;
  const dy = ((e.clientY - dragOffset.y) / rect.height) * 100;

  for (const selIdx of selectedLayerIds.value) {
    const start = dragStartPositions.value[selIdx];
    if (!start) continue;
    layers.value[selIdx].x = start.x + dx;
    layers.value[selIdx].y = start.y + dy;
  }

  computeSnapGuides(dragItem.value);
};

const stopDrag = () => {
  dragItem.value = null;
  snapGuides.value = [];
  window.removeEventListener("mousemove", onDrag);
  window.removeEventListener("mouseup", stopDrag);
};

const computeSnapGuides = (idx: number) => {
  const layer = layers.value[idx];
  if (!layer) { snapGuides.value = []; return; }

  const guides: { type: 'h' | 'v'; pos: number }[] = [];
  const layerCx = layer.x + layer.w / 2;
  const layerCy = layer.y + layer.h / 2;
  const layerRight = layer.x + layer.w;
  const layerBottom = layer.y + layer.h;

  if (Math.abs(layerCx - 50) < SNAP_THRESHOLD) {
    layer.x = 50 - layer.w / 2;
    guides.push({ type: 'v', pos: 50 });
  }
  if (Math.abs(layerCy - 50) < SNAP_THRESHOLD) {
    layer.y = 50 - layer.h / 2;
    guides.push({ type: 'h', pos: 50 });
  }

  for (let i = 0; i < layers.value.length; i++) {
    if (i === idx || selectedLayerIds.value.includes(i)) continue;
    const other = layers.value[i];
    if (!other.visible) continue;

    const otherCx = other.x + other.w / 2;
    const otherCy = other.y + other.h / 2;
    const otherRight = other.x + other.w;
    const otherBottom = other.y + other.h;

    const vChecks = [
      { from: layer.x, to: other.x },
      { from: layerRight, to: otherRight },
      { from: layerCx, to: otherCx },
      { from: layer.x, to: otherRight },
      { from: layerRight, to: other.x },
    ];
    for (const check of vChecks) {
      if (Math.abs(check.from - check.to) < SNAP_THRESHOLD) {
        const delta = check.to - check.from;
        layer.x += delta;
        for (const selIdx of selectedLayerIds.value) {
          if (selIdx !== idx) layers.value[selIdx].x += delta;
        }
        guides.push({ type: 'v', pos: check.to });
        break;
      }
    }

    const hChecks = [
      { from: layer.y, to: other.y },
      { from: layerBottom, to: otherBottom },
      { from: layerCy, to: otherCy },
      { from: layer.y, to: otherBottom },
      { from: layerBottom, to: other.y },
    ];
    for (const check of hChecks) {
      if (Math.abs(check.from - check.to) < SNAP_THRESHOLD) {
        const delta = check.to - check.from;
        layer.y += delta;
        for (const selIdx of selectedLayerIds.value) {
          if (selIdx !== idx) layers.value[selIdx].y += delta;
        }
        guides.push({ type: 'h', pos: check.to });
        break;
      }
    }
  }

  snapGuides.value = guides;
};

const computeSnapGuidesForResize = (idx: number) => {
  const layer = layers.value[idx];
  if (!layer) { snapGuides.value = []; return; }

  const guides: { type: 'h' | 'v'; pos: number }[] = [];
  const layerRight = layer.x + layer.w;
  const layerBottom = layer.y + layer.h;
  const layerCx = layer.x + layer.w / 2;
  const layerCy = layer.y + layer.h / 2;

  if (Math.abs(layerRight - 50) < SNAP_THRESHOLD) {
    layer.w = 50 - layer.x;
    guides.push({ type: 'v', pos: 50 });
  }
  if (Math.abs(layer.x - 50) < SNAP_THRESHOLD) {
    const oldRight = layer.x + layer.w;
    layer.x = 50;
    layer.w = oldRight - 50;
    guides.push({ type: 'v', pos: 50 });
  }
  if (Math.abs(layerCx - 50) < SNAP_THRESHOLD) {
    guides.push({ type: 'v', pos: 50 });
  }
  if (Math.abs(layerBottom - 50) < SNAP_THRESHOLD) {
    layer.h = 50 - layer.y;
    guides.push({ type: 'h', pos: 50 });
  }
  if (Math.abs(layerCy - 50) < SNAP_THRESHOLD) {
    guides.push({ type: 'h', pos: 50 });
  }

  for (let i = 0; i < layers.value.length; i++) {
    if (i === idx) continue;
    const other = layers.value[i];
    if (!other.visible) continue;

    const otherRight = other.x + other.w;
    const otherBottom = other.y + other.h;

    const vEdges = [
      { edge: layerRight, target: other.x, side: 'right' },
      { edge: layerRight, target: otherRight, side: 'right' },
      { edge: layer.x, target: other.x, side: 'left' },
      { edge: layer.x, target: otherRight, side: 'left' },
    ];
    for (const check of vEdges) {
      if (Math.abs(check.edge - check.target) < SNAP_THRESHOLD) {
        if (check.side === 'right') {
          layer.w = check.target - layer.x;
        } else {
          const oldRight = layer.x + layer.w;
          layer.x = check.target;
          layer.w = oldRight - check.target;
        }
        guides.push({ type: 'v', pos: check.target });
        break;
      }
    }

    const hEdges = [
      { edge: layerBottom, target: other.y, side: 'bottom' },
      { edge: layerBottom, target: otherBottom, side: 'bottom' },
      { edge: layer.y, target: other.y, side: 'top' },
      { edge: layer.y, target: otherBottom, side: 'top' },
    ];
    for (const check of hEdges) {
      if (Math.abs(check.edge - check.target) < SNAP_THRESHOLD) {
        if (check.side === 'bottom') {
          layer.h = check.target - layer.y;
        } else {
          const oldBottom = layer.y + layer.h;
          layer.y = check.target;
          layer.h = oldBottom - check.target;
        }
        guides.push({ type: 'h', pos: check.target });
        break;
      }
    }
  }

  snapGuides.value = guides;
};

// --- Resize logic (FIXED: resizes w/h, not just font size) ---
const resizeState = reactive({
  active: false,
  handle: '',
  startX: 0,
  startY: 0,
  startLayerX: 0,
  startLayerY: 0,
  startLayerW: 0,
  startLayerH: 0,
  startFontSize: 0,
  layerIdx: -1,
});

const startResize = (e: MouseEvent, idx: number, handle: string) => {
  e.stopPropagation();
  e.preventDefault();
  const layer = layers.value[idx];
  resizeState.active = true;
  resizeState.handle = handle;
  resizeState.startX = e.clientX;
  resizeState.startY = e.clientY;
  resizeState.startLayerX = layer.x;
  resizeState.startLayerY = layer.y;
  resizeState.startLayerW = layer.w;
  resizeState.startLayerH = layer.h;
  resizeState.startFontSize = layer.style?.font_size_normalized || 0;
  resizeState.layerIdx = idx;
  selectedLayerId.value = idx;
  window.addEventListener('mousemove', onResize);
  window.addEventListener('mouseup', stopResize);
};

const onResize = (e: MouseEvent) => {
  if (!resizeState.active || !editorCanvasEl.value) return;
  const rect = editorCanvasEl.value.getBoundingClientRect();
  const dx = ((e.clientX - resizeState.startX) / rect.width) * 100;
  const dy = ((e.clientY - resizeState.startY) / rect.height) * 100;
  const layer = layers.value[resizeState.layerIdx];
  const h = resizeState.handle;

  // West edge: move x, shrink w
  if (h === 'w' || h === 'nw' || h === 'sw') {
    layer.x = resizeState.startLayerX + dx;
    layer.w = Math.max(2, resizeState.startLayerW - dx);
  }
  // East edge: grow w
  if (h === 'e' || h === 'ne' || h === 'se') {
    layer.w = Math.max(2, resizeState.startLayerW + dx);
  }
  // North edge: move y, shrink h
  if (h === 'n' || h === 'nw' || h === 'ne') {
    layer.y = resizeState.startLayerY + dy;
    layer.h = Math.max(2, resizeState.startLayerH - dy);
  }
  // South edge: grow h
  if (h === 's' || h === 'sw' || h === 'se') {
    layer.h = Math.max(2, resizeState.startLayerH + dy);
  }

  // Scale font size proportionally with height for text layers
  if (layer.type === 'text' && layer.style && resizeState.startFontSize > 0 && resizeState.startLayerH > 0) {
    const heightRatio = layer.h / resizeState.startLayerH;
    layer.style.font_size_normalized = Math.max(4, Math.round(resizeState.startFontSize * heightRatio));
  }

  // Show snap guides for resized edges
  computeSnapGuidesForResize(resizeState.layerIdx);
};

const stopResize = () => {
  resizeState.active = false;
  snapGuides.value = [];
  window.removeEventListener('mousemove', onResize);
  window.removeEventListener('mouseup', stopResize);
};

const updateText = (idx: number, e: Event) => {
  const target = e.target as HTMLElement;
  const newContent = target.innerText;
  if (layers.value[idx].content !== newContent) {
    layers.value[idx].content = newContent;
  }
};

const selectAll = (idx: number) => {
  selectedLayerId.value = idx;
  focusedLayerId.value = idx;
};

const onBlurText = () => {
  focusedLayerId.value = null;
};

const deleteLayer = () => {
  if (selectedLayerIds.value.length > 0) {
    const sorted = [...selectedLayerIds.value].sort((a, b) => b - a);
    for (const idx of sorted) {
      layers.value.splice(idx, 1);
    }
    selectedLayerIds.value = [];
    selectedLayerId.value = null;
  } else if (selectedLayerId.value !== null) {
    layers.value.splice(selectedLayerId.value, 1);
    selectedLayerId.value = null;
  }
};

const toggleVisibility = (idx: number) => {
  layers.value[idx].visible = !layers.value[idx].visible;
};

const moveLayerUp = (idx: number) => {
  if (idx <= 0) return;
  const layer = layers.value[idx];
  const other = layers.value[idx - 1];
  const tmpZ = layer.z_index;
  layer.z_index = other.z_index;
  other.z_index = tmpZ;
  layers.value.splice(idx, 1);
  layers.value.splice(idx - 1, 0, layer);
  if (selectedLayerId.value === idx) selectedLayerId.value = idx - 1;
  else if (selectedLayerId.value === idx - 1) selectedLayerId.value = idx;
};

const moveLayerDown = (idx: number) => {
  if (idx >= layers.value.length - 1) return;
  const layer = layers.value[idx];
  const other = layers.value[idx + 1];
  const tmpZ = layer.z_index;
  layer.z_index = other.z_index;
  other.z_index = tmpZ;
  layers.value.splice(idx, 1);
  layers.value.splice(idx + 1, 0, layer);
  if (selectedLayerId.value === idx) selectedLayerId.value = idx + 1;
  else if (selectedLayerId.value === idx + 1) selectedLayerId.value = idx;
};

// Cache for font base64 data
const fontCache = ref<Record<string, string>>({});

const loadFontAsBase64 = async (weight: string, filename: string): Promise<string> => {
  const key = `${weight}-${filename}`;
  if (fontCache.value[key]) return fontCache.value[key];
  try {
    const resp = await fetch(`http://localhost:5001/assets/fonts/${filename}`);
    if (!resp.ok) return '';
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const b64 = (reader.result as string).split(',')[1] || '';
        fontCache.value[key] = b64;
        resolve(b64);
      };
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
};

const downloadAsSvg = async () => {
  const bgImgElement = editorCanvasEl.value?.querySelector(".bg-img") as HTMLImageElement;
  if (!bgImgElement) return;

  if (!bgImgElement.complete || bgImgElement.naturalWidth === 0) {
    await new Promise((resolve) => { bgImgElement.onload = resolve; });
  }

  const width = bgImgElement.naturalWidth;
  const height = bgImgElement.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(bgImgElement, 0, 0);
  let base64Bg: string;
  try {
    base64Bg = canvas.toDataURL("image/png");
  } catch (e) {
    console.error("SVG Export: Canvas tainted, trying re-fetch", e);
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = bgImgElement.src;
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
      const c2 = document.createElement("canvas");
      c2.width = width;
      c2.height = height;
      const ctx2 = c2.getContext("2d")!;
      ctx2.drawImage(img, 0, 0, width, height);
      base64Bg = c2.toDataURL("image/png");
    } catch (e2) {
      console.error("SVG Export: Failed to encode background", e2);
      return;
    }
  }

  // Embed Kanit fonts as base64 @font-face
  let fontStyle = '';
  const fontFiles: [string, string][] = [['400', 'Kanit-Regular.ttf'], ['700', 'Kanit-Bold.ttf'], ['900', 'Kanit-Black.ttf']];
  for (const [weight, file] of fontFiles) {
    const b64 = await loadFontAsBase64(weight, file);
    if (b64) {
      fontStyle += `@font-face{font-family:'Kanit';font-weight:${weight};src:url('data:font/ttf;base64,${b64}') format('truetype');}`;
    }
  }

  // Build SVG with defs for filters
  let defs = fontStyle ? `<style>${fontStyle}</style>` : '';
  let filterIdx = 0;

  const makeShadowFilter = (shadow: string): string => {
    if (!shadow || shadow === 'none') return '';
    const id = `shadow-${filterIdx++}`;
    if (shadow === 'subtle') {
      defs += `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.5)" flood-opacity="0.5"/></filter>`;
    } else if (shadow === 'strong') {
      defs += `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="rgba(0,0,0,0.8)" flood-opacity="0.8"/></filter>`;
    }
    return id;
  };

  let body = '';

  // Background image
  body += `<image href="${base64Bg}" width="${width}" height="${height}" x="0" y="0" />`;

  // Background effects
  for (const effect of backgroundEffects.value) {
    if (effect.type === 'linear-fade') {
      const gradId = `grad-${filterIdx++}`;
      const dir = effect.from || 'bottom';
      const color = effect.color || 'rgba(0,0,0,0.7)';
      const size = parseInt(effect.size || '30') / 100;

      let x1 = '0', y1 = '0', x2 = '0', y2 = '0';
      if (dir === 'bottom') { y1 = '1'; y2 = String(1 - size); }
      else if (dir === 'top') { y2 = String(size); }
      else if (dir === 'left') { x2 = String(size); }
      else if (dir === 'right') { x1 = '1'; x2 = String(1 - size); }

      defs += `<linearGradient id="${gradId}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0%" stop-color="${color}"/><stop offset="100%" stop-color="transparent"/></linearGradient>`;
      body += `<rect width="${width}" height="${height}" fill="url(#${gradId})" />`;
    }
  }

  // Layers
  for (const l of layers.value) {
    if (!l.visible) continue;
    try {
    const x = (l.x / 100) * width;
    const y = (l.y / 100) * height;
    const w = (l.w / 100) * width;
    const h = (l.h / 100) * height;
    const rotation = l.rotation || 0;
    const transforms: string[] = [];
    if (rotation) transforms.push(`rotate(${rotation}, ${x + w / 2}, ${y + h / 2})`);
    if (l.style?.skewX) transforms.push(`skewX(${l.style.skewX})`);
    else if (l.skewX) transforms.push(`skewX(${l.skewX})`);
    if (l.style?.skewY) transforms.push(`skewY(${l.style.skewY})`);
    else if (l.skewY) transforms.push(`skewY(${l.skewY})`);
    // Note: perspective/rotateX/rotateY are CSS-only (3D), not supported in SVG
    const transformStr = transforms.length ? transforms.join(' ') : '';

    if (l.type === "image") {
      try {
        const resp = await fetch(l.imageUrl);
        const blob = await resp.blob();
        const reader = new FileReader();
        const base64Img = await new Promise((resolve) => {
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        body += `<image href="${base64Img}" width="${w}" height="${h}" x="${x}" y="${y}"${transformStr ? ` transform="${transformStr}"` : ''} />`;
      } catch (e) {
        console.error("SVG Export: Failed to embed component image", e);
      }
    } else {
      const fontSize = (l.style.font_size_normalized || 40) / 1000 * width;
      const fontFamily = l.style.font_family || 'Kanit';
      const fontWeight = l.style.font_weight || '700';
      const fillColor = l.style.color_hex || '#FFFFFF';
      const lineH = (l.style.line_height || 1.2) * fontSize;
      const letterSpacing = l.style.letter_spacing || 0;
      const align = l.style.align || 'center';

      const anchorMap: Record<string, string> = { left: 'start', center: 'middle', right: 'end' };
      const textAnchor = anchorMap[align] || 'middle';
      const textX = align === 'left' ? x : align === 'right' ? x + w : x + w / 2;

      const shadowId = makeShadowFilter(l.style.shadow);

      if (l.style.background_color) {
        body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${l.style.background_color}"${transformStr ? ` transform="${transformStr}"` : ''} />`;
      }

      const strokeAttrs = (l.style.stroke_hex && l.style.stroke_width)
        ? ` stroke="${l.style.stroke_hex}" stroke-width="${l.style.stroke_width * 2}" stroke-linejoin="round" paint-order="stroke"`
        : '';

      const filterAttr = shadowId ? ` filter="url(#${shadowId})"` : '';

      const escapeLine = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      // Measure-based text wrapping using canvas
      const wrapText = (text: string, maxWidth: number, font: string): string[] => {
        const measureCanvas = document.createElement('canvas');
        const mCtx = measureCanvas.getContext('2d');
        if (!mCtx) return text.split('\n');
        mCtx.font = font;

        const result: string[] = [];
        const rawLines = text.split('\n');

        for (const raw of rawLines) {
          // If line fits, keep as-is
          if (mCtx.measureText(raw).width <= maxWidth) {
            result.push(raw);
            continue;
          }
          // Wrap at word/space boundaries
          let current = '';
          // Split keeping spaces: "hello world" -> ["hello", " ", "world"]
          const tokens = raw.split(/(\s+)/);
          for (const token of tokens) {
            const test = current + token;
            if (mCtx.measureText(test).width > maxWidth && current.length > 0) {
              result.push(current.trimEnd());
              current = token.trimStart();
            } else {
              current = test;
            }
          }
          if (current.trim()) result.push(current.trimEnd());
        }
        return result;
      };

      const fontStr = `${fontWeight} ${fontSize}px ${fontFamily}, sans-serif`;
      const lines = wrapText(l.content || '', w, fontStr);

      body += `<text x="${textX}" y="${y + fontSize * 0.85}" fill="${fillColor}" font-family="${fontFamily}, sans-serif" font-size="${fontSize}px" font-weight="${fontWeight}" text-anchor="${textAnchor}" letter-spacing="${letterSpacing}px"${strokeAttrs}${filterAttr}${transformStr ? ` transform="${transformStr}"` : ''}>`;

      lines.forEach((line: string, i: number) => {
        if (i === 0) {
          body += `${escapeLine(line)}`;
        } else {
          body += `<tspan x="${textX}" dy="${lineH}px">${escapeLine(line)}</tspan>`;
        }
      });

      body += `</text>`;
    }
    } catch (e) {
      console.error("SVG Export: Failed to export layer", l, e);
    }
  }

  const svgContent = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${body}</svg>`;

  const blob = new Blob([svgContent], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ad-layout.svg";
  link.click();
  URL.revokeObjectURL(url);
};

// Collapsible sections in properties panel
const expandedSections = reactive<Record<string, boolean>>({
  transform: true,
  text: true,
  appearance: true,
  effects: false,
  transform3d: false,
});

const toggleSection = (key: string) => {
  expandedSections[key] = !expandedSections[key];
};

const onWorkspaceMouseDown = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.classList.contains('workspace') && !target.classList.contains('canvas') && !target.classList.contains('bg-img') && !target.classList.contains('bg-effect-layer')) return;

  selectedLayerId.value = null;
  selectedLayerIds.value = [];
  snapGuides.value = [];

  const rect = editorCanvasEl.value?.getBoundingClientRect();
  if (!rect) return;

  marquee.active = true;
  marquee.startX = ((e.clientX - rect.left) / rect.width) * 100;
  marquee.startY = ((e.clientY - rect.top) / rect.height) * 100;
  marquee.currentX = marquee.startX;
  marquee.currentY = marquee.startY;

  const onMarqueeMove = (me: MouseEvent) => {
    if (!marquee.active || !editorCanvasEl.value) return;
    const r = editorCanvasEl.value.getBoundingClientRect();
    marquee.currentX = ((me.clientX - r.left) / r.width) * 100;
    marquee.currentY = ((me.clientY - r.top) / r.height) * 100;
  };

  const onMarqueeUp = () => {
    if (!marquee.active) return;
    marquee.active = false;

    const mx1 = Math.min(marquee.startX, marquee.currentX);
    const my1 = Math.min(marquee.startY, marquee.currentY);
    const mx2 = Math.max(marquee.startX, marquee.currentX);
    const my2 = Math.max(marquee.startY, marquee.currentY);

    if (mx2 - mx1 > 1 || my2 - my1 > 1) {
      layers.value.forEach((layer, idx) => {
        if (!layer.visible) return;
        const lx1 = layer.x;
        const ly1 = layer.y;
        const lx2 = layer.x + layer.w;
        const ly2 = layer.y + layer.h;

        if (lx1 < mx2 && lx2 > mx1 && ly1 < my2 && ly2 > my1) {
          if (!selectedLayerIds.value.includes(idx)) selectedLayerIds.value.push(idx);
        }
      });

      const first = selectedLayerIds.value[0];
      if (first !== undefined) {
        selectedLayerId.value = first;
      }
    }

    window.removeEventListener('mousemove', onMarqueeMove);
    window.removeEventListener('mouseup', onMarqueeUp);
  };

  window.addEventListener('mousemove', onMarqueeMove);
  window.addEventListener('mouseup', onMarqueeUp);
};

const onKeyDown = (e: KeyboardEvent) => {
  const tag = (e.target as HTMLElement).tagName;
  const isEditable = (e.target as HTMLElement).getAttribute('contenteditable') === 'true';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isEditable) return;

  if (e.key === 'Escape' && isFullscreen.value) {
    isFullscreen.value = false;
    e.preventDefault();
    return;
  }

  if (selectedLayerId.value === null) return;
  const layer = layers.value[selectedLayerId.value];
  if (!layer) return;

  const step = e.shiftKey ? 0.1 : 1;

  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      deleteLayer();
      e.preventDefault();
      break;
    case 'Escape':
      selectedLayerId.value = null;
      selectedLayerIds.value = [];
      snapGuides.value = [];
      e.preventDefault();
      break;
    case 'ArrowLeft':
      for (const selIdx of selectedLayerIds.value) layers.value[selIdx].x -= step;
      if (selectedLayerIds.value.length === 0 && layer) layer.x -= step;
      e.preventDefault();
      break;
    case 'ArrowRight':
      for (const selIdx of selectedLayerIds.value) layers.value[selIdx].x += step;
      if (selectedLayerIds.value.length === 0 && layer) layer.x += step;
      e.preventDefault();
      break;
    case 'ArrowUp':
      for (const selIdx of selectedLayerIds.value) layers.value[selIdx].y -= step;
      if (selectedLayerIds.value.length === 0 && layer) layer.y -= step;
      e.preventDefault();
      break;
    case 'ArrowDown':
      for (const selIdx of selectedLayerIds.value) layers.value[selIdx].y += step;
      if (selectedLayerIds.value.length === 0 && layer) layer.y += step;
      e.preventDefault();
      break;
    case ']':
      if (e.ctrlKey || e.metaKey) {
        const idx = selectedLayerId.value;
        if (idx !== null) moveLayerUp(idx);
        e.preventDefault();
      }
      break;
    case '[':
      if (e.ctrlKey || e.metaKey) {
        const idx = selectedLayerId.value;
        if (idx !== null) moveLayerDown(idx);
        e.preventDefault();
      }
      break;
  }
};

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div class="studio-layout" :class="{ 'studio-fullscreen': isFullscreen }">
    <!-- Top toolbar -->
    <div class="toolbar">
      <div class="toolbar-left">
        <h2 class="toolbar-title">Layer Editor</h2>
        <button class="toolbar-btn toolbar-btn-icon" @click="toggleFullscreen" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'">
          <svg v-if="!isFullscreen" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        </button>
      </div>
      <div class="toolbar-center">
        <div class="zoom-controls">
          <button class="zoom-btn" @click="zoomLevel = Math.max(25, zoomLevel - 25)" :disabled="zoomLevel <= 25">-</button>
          <span class="zoom-label">{{ zoomLevel }}%</span>
          <button class="zoom-btn" @click="zoomLevel = Math.min(200, zoomLevel + 25)" :disabled="zoomLevel >= 200">+</button>
          <button class="zoom-btn zoom-fit" @click="zoomLevel = 100">Fit</button>
        </div>
        <CustomDropdown
          v-model="renderMode"
          :options="[
            { value: 'ai', label: 'AI Production' },
            { value: 'simple', label: 'Raw PNG' },
          ]"
          theme="dark"
          size="sm"
        />
      </div>
      <div class="toolbar-right">
        <button
          v-if="layers.length"
          :disabled="rendering"
          @click="renderImage"
          class="toolbar-btn toolbar-btn-primary"
        >
          {{ rendering ? "Rendering..." : "Save & Render" }}
        </button>
        <button
          v-if="layers.length"
          @click="downloadAsSvg"
          class="toolbar-btn toolbar-btn-export"
        >
          Export SVG
        </button>
        <button
          v-if="layers.length && props.outputFormat === 'psd-3d'"
          class="toolbar-btn toolbar-btn-psd"
          title="PSD export coming soon"
          disabled
        >
          Export PSD
        </button>
      </div>
    </div>

    <div class="studio-body">
      <!-- Left: Layers panel -->
      <div class="panel panel-layers">
        <div class="panel-header">Layers</div>
        <div class="panel-content">
          <!-- File inputs section -->
          <div class="panel-section">
            <div class="input-group">
              <label class="input-label">Main Image</label>
              <input type="file" @change="onFileChange" accept="image/*" class="file-input" />
            </div>
            <div class="input-group">
              <label class="input-label">Background</label>
              <input type="file" @change="onBgChange" accept="image/*" class="file-input" />
            </div>
            <div class="input-group">
              <label class="input-label">Hint Text</label>
              <CustomInput
                v-model="hintText"
                placeholder="e.g. SUMMER SALE 50%"
                theme="dark"
                size="sm"
              />
            </div>
            <button
              :disabled="!selectedFile || loading"
              @click="processImage('full')"
              class="toolbar-btn toolbar-btn-primary"
              style="width: 100%"
            >
              {{ loading ? "Separating..." : "Separate Layers" }}
            </button>
          </div>

          <div v-if="error" class="error-msg">{{ error }}</div>

          <!-- Layer list -->
          <div class="layer-list">
            <div
              v-for="(layer, idx) in layers"
              :key="layer.id"
              class="layer-item"
              :class="{ 'layer-item-selected': selectedLayerIds.includes(idx) }"
              @click="selectedLayerIds = []; selectedLayerIds.push(idx); selectedLayerId = idx"
            >
              <button
                class="visibility-btn"
                :class="{ 'visibility-off': !layer.visible }"
                @click.stop="toggleVisibility(idx)"
                :title="layer.visible ? 'Hide layer' : 'Show layer'"
              >
                <svg v-if="layer.visible" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              </button>
              <span class="layer-icon" :class="{ 'layer-icon-img': layer.type === 'image' }">
                {{ getLayerIcon(layer) }}
              </span>
              <span class="layer-name">{{ getLayerLabel(layer) }}</span>
              <div class="layer-order-btns">
                <button
                  class="order-btn"
                  @click.stop="moveLayerUp(idx)"
                  :disabled="idx === 0"
                  title="Move up"
                >&#9650;</button>
                <button
                  class="order-btn"
                  @click.stop="moveLayerDown(idx)"
                  :disabled="idx === layers.length - 1"
                  title="Move down"
                >&#9660;</button>
              </div>
            </div>

            <div v-if="bgPreviewUrl" class="layer-item layer-item-bg">
              <span class="layer-icon layer-icon-bg">BG</span>
              <span class="layer-name">Background</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Center: Canvas workspace -->
      <div class="workspace" ref="canvasContainer" @mousedown="onWorkspaceMouseDown">
        <div
          v-if="previewUrl || bgPreviewUrl || layers.length > 0"
          class="canvas"
          ref="editorCanvasEl"
          :style="{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'center center' }"
        >
          <img
            v-if="(bgPreviewUrl || previewUrl) && !hasSvgOverlay"
            :src="(layers.length > 0 ? bgPreviewUrl || previewUrl : previewUrl) ?? undefined"
            class="bg-img"
            draggable="false"
            style="user-select: none; pointer-events: none"
            @load="onEditorImageLoad"
          />

          <!-- Background effects (fade/gradient overlays from AI pipeline) -->
          <div
            v-for="(effect, eIdx) in backgroundEffects"
            :key="'effect-' + eIdx"
            class="bg-effect-layer"
            :style="getBgEffectStyle(effect)"
          ></div>

          <div
            v-if="sanitizedEditorSvgOverlay"
            v-html="sanitizedEditorSvgOverlay"
            :class="['editor-svg-overlay-layer', { 'full-svg': hasSvgOverlay }]"
            title="Text generated as SVG"
          />

          <template v-for="(layer, idx) in layers" :key="layer.id">
            <div
              v-show="layer.visible"
              class="layer-box"
              :class="{ 'layer-box-selected': selectedLayerIds.includes(idx) }"
              :style="
                layer.type === 'image'
                  ? {
                      top: layer.y + '%',
                      left: layer.x + '%',
                      width: layer.w + '%',
                      height: layer.h + '%',
                      transform: [
                        layer.perspective ? `perspective(${layer.perspective}px)` : '',
                        `rotate(${layer.rotation || 0}deg)`,
                        layer.skewX ? `skewX(${layer.skewX}deg)` : '',
                        layer.skewY ? `skewY(${layer.skewY}deg)` : '',
                        layer.rotateX ? `rotateX(${layer.rotateX}deg)` : '',
                        layer.rotateY ? `rotateY(${layer.rotateY}deg)` : '',
                      ].filter(Boolean).join(' '),
                      zIndex: layer.z_index,
                    }
                  : {
                      top: layer.y + '%',
                      left: layer.x + '%',
                      width: layer.w + '%',
                      height: layer.h + '%',
                      color: layer.style.color_hex,
                      fontSize: (layer.style.font_size_normalized || 40) * 0.1 + 'cqw',
                      fontFamily: `${layer.style.font_family || 'Kanit'}, sans-serif`,
                      fontWeight: layer.style.font_weight,
                      letterSpacing: (layer.style.letter_spacing || 0) + 'px',
                      lineHeight: layer.style.line_height || 1.2,
                      textShadow: getShadowStyle(layer.style.shadow),
                      WebkitTextStroke: layer.style.stroke_hex
                        ? `${layer.style.stroke_width || 1}px ${layer.style.stroke_hex}`
                        : undefined,
                      paintOrder: layer.style.stroke_hex ? 'stroke fill' : undefined,
                      transform: [
                        layer.style.perspective ? `perspective(${layer.style.perspective}px)` : '',
                        `rotate(${layer.rotation || 0}deg)`,
                        layer.style.skewX ? `skewX(${layer.style.skewX}deg)` : '',
                        layer.style.skewY ? `skewY(${layer.style.skewY}deg)` : '',
                        layer.style.rotateX ? `rotateX(${layer.style.rotateX}deg)` : '',
                        layer.style.rotateY ? `rotateY(${layer.style.rotateY}deg)` : '',
                      ].filter(Boolean).join(' '),
                      zIndex: layer.z_index,
                    }
              "
              @mousedown="startDrag($event, idx)"
            >
              <img
                v-if="layer.type === 'image'"
                :src="layer.imageUrl"
                :alt="layer.label"
                :title="layer.label"
                class="component-img"
                draggable="false"
              />
              <span
                v-else
                :ref="(el) => { if (el) textRefs[layer.id] = el as HTMLElement; }"
                contenteditable="true"
                @input="updateText(idx, $event)"
                @focus="selectAll(idx)"
                @blur="onBlurText"
                class="editable-text"
                :style="getEditorContainerStyle(layer)"
              ></span>

              <!-- Selection handles -->
              <template v-if="selectedLayerIds.includes(idx)">
                <div class="selection-outline"></div>
                <div class="handle handle-nw" @mousedown.stop="startResize($event, idx, 'nw')"></div>
                <div class="handle handle-n" @mousedown.stop="startResize($event, idx, 'n')"></div>
                <div class="handle handle-ne" @mousedown.stop="startResize($event, idx, 'ne')"></div>
                <div class="handle handle-e" @mousedown.stop="startResize($event, idx, 'e')"></div>
                <div class="handle handle-se" @mousedown.stop="startResize($event, idx, 'se')"></div>
                <div class="handle handle-s" @mousedown.stop="startResize($event, idx, 's')"></div>
                <div class="handle handle-sw" @mousedown.stop="startResize($event, idx, 'sw')"></div>
                <div class="handle handle-w" @mousedown.stop="startResize($event, idx, 'w')"></div>
              </template>
            </div>
          </template>

          <!-- Snap guides -->
          <div
            v-for="(guide, gIdx) in snapGuides"
            :key="'guide-' + gIdx"
            class="snap-guide"
            :class="guide.type === 'h' ? 'snap-guide-h' : 'snap-guide-v'"
            :style="guide.type === 'h'
              ? { top: guide.pos + '%', left: '0', right: '0' }
              : { left: guide.pos + '%', top: '0', bottom: '0' }
            "
          ></div>

          <!-- Marquee selection rectangle -->
          <div
            v-if="marqueeRect"
            class="marquee-rect"
            :style="{
              left: marqueeRect.left + '%',
              top: marqueeRect.top + '%',
              width: marqueeRect.width + '%',
              height: marqueeRect.height + '%',
            }"
          ></div>
        </div>
        <div v-else class="placeholder">Upload an image to start editing</div>
      </div>

      <!-- Right: Properties panel -->
      <div class="panel panel-props" v-if="selectedLayerIds.length > 0">
        <div class="panel-header">
          Properties {{ multiSelectCount > 1 ? `(${multiSelectCount})` : '' }}
          <button class="delete-btn" @click="deleteLayer" title="Delete layer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
        <div class="panel-content props-scroll">
          <!-- Transform section -->
          <div class="props-section">
            <div class="props-section-header" @click="toggleSection('transform')">
              <span>Transform</span>
              <span class="chevron" :class="{ open: expandedSections.transform }">&#9662;</span>
            </div>
            <div v-show="expandedSections.transform" class="props-section-body">
              <div class="props-grid">
                <div class="props-field">
                  <label>X</label>
                  <input
                    type="number" step="0.5"
                    :value="getMultiProp(l => Math.round(l.x * 100) / 100).value"
                    :placeholder="getMultiProp(l => l.x).mixed ? 'Mixed' : ''"
                    @input="setMultiProp((l, v) => l.x = v, Number(($event.target as HTMLInputElement).value))"
                  />
                </div>
                <div class="props-field">
                  <label>Y</label>
                  <input
                    type="number" step="0.5"
                    :value="getMultiProp(l => Math.round(l.y * 100) / 100).value"
                    :placeholder="getMultiProp(l => l.y).mixed ? 'Mixed' : ''"
                    @input="setMultiProp((l, v) => l.y = v, Number(($event.target as HTMLInputElement).value))"
                  />
                </div>
                <div class="props-field">
                  <label>W</label>
                  <input
                    type="number" step="0.5"
                    :value="getMultiProp(l => Math.round(l.w * 100) / 100).value"
                    :placeholder="getMultiProp(l => l.w).mixed ? 'Mixed' : ''"
                    @input="setMultiProp((l, v) => l.w = v, Number(($event.target as HTMLInputElement).value))"
                  />
                </div>
                <div class="props-field">
                  <label>H</label>
                  <input
                    type="number" step="0.5"
                    :value="getMultiProp(l => Math.round(l.h * 100) / 100).value"
                    :placeholder="getMultiProp(l => l.h).mixed ? 'Mixed' : ''"
                    @input="setMultiProp((l, v) => l.h = v, Number(($event.target as HTMLInputElement).value))"
                  />
                </div>
              </div>
              <div class="props-grid single">
                <div class="props-field">
                  <label>Rotation</label>
                  <input
                    type="number" step="5"
                    :value="getMultiProp(l => l.rotation).value"
                    :placeholder="getMultiProp(l => l.rotation).mixed ? 'Mixed' : ''"
                    @input="setMultiProp((l, v) => l.rotation = v, Number(($event.target as HTMLInputElement).value))"
                  />
                </div>
              </div>
              <div class="props-grid single">
                <div class="props-field">
                  <label>Z-Index</label>
                  <input
                    type="number" step="1"
                    :value="getMultiProp(l => l.z_index).value"
                    :placeholder="getMultiProp(l => l.z_index).mixed ? 'Mixed' : ''"
                    @input="setMultiProp((l, v) => l.z_index = v, Number(($event.target as HTMLInputElement).value))"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Transform Effects section -->
          <div class="props-section" v-if="outputFormat === 'psd-3d'">
            <div class="props-section-header" @click="toggleSection('transform3d')">
              <span>Transform Effects</span>
              <span class="chevron" :class="{ open: expandedSections.transform3d }">&#9662;</span>
            </div>
            <div v-show="expandedSections.transform3d" class="props-section-body">
              <div class="props-grid">
                <div class="props-field">
                  <label>Skew X</label>
                  <input
                    type="number" step="1"
                    :value="getMultiProp(l => l.style?.skewX ?? l.skewX ?? 0).value"
                    :placeholder="getMultiProp(l => l.style?.skewX ?? l.skewX).mixed ? 'Mixed' : ''"
                    @input="selectedLayers.forEach(l => { if (l.style) l.style.skewX = Number(($event.target as HTMLInputElement).value); else l.skewX = Number(($event.target as HTMLInputElement).value); })"
                  />
                </div>
                <div class="props-field">
                  <label>Skew Y</label>
                  <input
                    type="number" step="1"
                    :value="getMultiProp(l => l.style?.skewY ?? l.skewY ?? 0).value"
                    :placeholder="getMultiProp(l => l.style?.skewY ?? l.skewY).mixed ? 'Mixed' : ''"
                    @input="selectedLayers.forEach(l => { if (l.style) l.style.skewY = Number(($event.target as HTMLInputElement).value); else l.skewY = Number(($event.target as HTMLInputElement).value); })"
                  />
                </div>
              </div>
              <div class="props-grid">
                <div class="props-field">
                  <label>Perspective</label>
                  <input
                    type="number" step="50"
                    :value="getMultiProp(l => l.style?.perspective ?? l.perspective ?? 0).value"
                    :placeholder="getMultiProp(l => l.style?.perspective ?? l.perspective).mixed ? 'Mixed' : ''"
                    @input="selectedLayers.forEach(l => { if (l.style) l.style.perspective = Number(($event.target as HTMLInputElement).value); else l.perspective = Number(($event.target as HTMLInputElement).value); })"
                  />
                </div>
              </div>
              <div class="props-grid">
                <div class="props-field">
                  <label>Rotate X</label>
                  <input
                    type="number" step="5"
                    :value="getMultiProp(l => l.style?.rotateX ?? l.rotateX ?? 0).value"
                    :placeholder="getMultiProp(l => l.style?.rotateX ?? l.rotateX).mixed ? 'Mixed' : ''"
                    @input="selectedLayers.forEach(l => { if (l.style) l.style.rotateX = Number(($event.target as HTMLInputElement).value); else l.rotateX = Number(($event.target as HTMLInputElement).value); })"
                  />
                </div>
                <div class="props-field">
                  <label>Rotate Y</label>
                  <input
                    type="number" step="5"
                    :value="getMultiProp(l => l.style?.rotateY ?? l.rotateY ?? 0).value"
                    :placeholder="getMultiProp(l => l.style?.rotateY ?? l.rotateY).mixed ? 'Mixed' : ''"
                    @input="selectedLayers.forEach(l => { if (l.style) l.style.rotateY = Number(($event.target as HTMLInputElement).value); else l.rotateY = Number(($event.target as HTMLInputElement).value); })"
                  />
                </div>
              </div>
              <div class="props-grid">
                <div class="props-field">
                  <label>Warp</label>
                  <select
                    class="props-select"
                    :value="getMultiProp(l => l.style?.warpType ?? 'none').value || 'none'"
                    @change="selectedLayers.forEach(l => { if (l.style) l.style.warpType = ($event.target as HTMLSelectElement).value; })"
                  >
                    <option value="none">None</option>
                    <option value="arc">Arc</option>
                    <option value="arc_lower">Arc Lower</option>
                    <option value="arc_upper">Arc Upper</option>
                    <option value="arch">Arch</option>
                    <option value="bulge">Bulge</option>
                    <option value="shell_lower">Shell Lower</option>
                    <option value="shell_upper">Shell Upper</option>
                    <option value="flag">Flag</option>
                    <option value="wave">Wave</option>
                    <option value="fish">Fish</option>
                    <option value="rise">Rise</option>
                    <option value="fisheye">Fisheye</option>
                    <option value="inflate">Inflate</option>
                    <option value="squeeze">Squeeze</option>
                    <option value="twist">Twist</option>
                  </select>
                </div>
                <div class="props-field">
                  <label>Bend %</label>
                  <input
                    type="number" step="5" min="-100" max="100"
                    :value="getMultiProp(l => l.style?.warpIntensity ?? 0).value"
                    :placeholder="getMultiProp(l => l.style?.warpIntensity).mixed ? 'Mixed' : ''"
                    @input="selectedLayers.forEach(l => { if (l.style) l.style.warpIntensity = Number(($event.target as HTMLInputElement).value); })"
                  />
                </div>
              </div>
              <div class="props-grid">
                <div class="props-field">
                  <label>H Distort</label>
                  <input
                    type="number" step="5" min="-100" max="100"
                    :value="getMultiProp(l => l.style?.warpHDistortion ?? 0).value"
                    :placeholder="getMultiProp(l => l.style?.warpHDistortion).mixed ? 'Mixed' : ''"
                    @input="selectedLayers.forEach(l => { if (l.style) l.style.warpHDistortion = Number(($event.target as HTMLInputElement).value); })"
                  />
                </div>
                <div class="props-field">
                  <label>V Distort</label>
                  <input
                    type="number" step="5" min="-100" max="100"
                    :value="getMultiProp(l => l.style?.warpVDistortion ?? 0).value"
                    :placeholder="getMultiProp(l => l.style?.warpVDistortion).mixed ? 'Mixed' : ''"
                    @input="selectedLayers.forEach(l => { if (l.style) l.style.warpVDistortion = Number(($event.target as HTMLInputElement).value); })"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Text section (all selected must be text) -->
          <template v-if="selectedLayers.every(l => l.type === 'text')">
            <div class="props-section">
              <div class="props-section-header" @click="toggleSection('text')">
                <span>Text</span>
                <span class="chevron" :class="{ open: expandedSections.text }">&#9662;</span>
              </div>
              <div v-show="expandedSections.text" class="props-section-body">
                <div class="props-field full" v-if="multiSelectCount === 1">
                  <label>Content</label>
                  <input v-model="selectedLayer!.content" type="text" />
                </div>
                <div class="props-field full" v-else>
                  <label>Content</label>
                  <input type="text" disabled placeholder="(multiple layers)" />
                </div>
                <div class="props-field full">
                  <label>Font Family</label>
                  <CustomDropdown
                    :model-value="getMultiProp(l => l.style?.font_family).value || ''"
                    :options="[
                      ...(getMultiProp(l => l.style?.font_family).mixed ? [{ value: '', label: 'Mixed', disabled: true }] : []),
                      { value: 'Inter', label: 'Inter' },
                      { value: 'Kanit', label: 'Kanit' },
                      { value: 'Playfair Display', label: 'Playfair Display' },
                      { value: 'Roboto Mono', label: 'Roboto Mono' },
                      { value: 'sans-serif', label: 'System Sans' },
                    ]"
                    @update:model-value="setMultiStyle('font_family', $event)"
                    theme="dark"
                    size="sm"
                  />
                </div>
                <div class="props-field full">
                  <label>Font Weight</label>
                  <CustomDropdown
                    :model-value="getMultiProp(l => l.style?.font_weight).value || ''"
                    :options="[
                      ...(getMultiProp(l => l.style?.font_weight).mixed ? [{ value: '', label: 'Mixed', disabled: true }] : []),
                      { value: '400', label: 'Regular (400)' },
                      { value: '500', label: 'Medium (500)' },
                      { value: '600', label: 'Semibold (600)' },
                      { value: '700', label: 'Bold (700)' },
                      { value: '800', label: 'Extra Bold (800)' },
                      { value: '900', label: 'Black (900)' },
                    ]"
                    @update:model-value="setMultiStyle('font_weight', $event)"
                    theme="dark"
                    size="sm"
                  />
                </div>
              </div>
            </div>

            <div class="props-section">
              <div class="props-section-header" @click="toggleSection('appearance')">
                <span>Appearance</span>
                <span class="chevron" :class="{ open: expandedSections.appearance }">&#9662;</span>
              </div>
              <div v-show="expandedSections.appearance" class="props-section-body">
                <div class="props-grid">
                  <div class="props-field">
                    <label>Size</label>
                    <input
                      type="number"
                      :value="getMultiProp(l => l.style?.font_size_normalized).value"
                      :placeholder="getMultiProp(l => l.style?.font_size_normalized).mixed ? 'Mixed' : ''"
                      @input="setMultiStyle('font_size_normalized', Number(($event.target as HTMLInputElement).value))"
                    />
                  </div>
                  <div class="props-field">
                    <label>Color</label>
                    <div class="color-input-wrap">
                      <input
                        type="color" class="color-input"
                        :value="getMultiProp(l => l.style?.color_hex).value || '#FFFFFF'"
                        @input="setMultiStyle('color_hex', ($event.target as HTMLInputElement).value)"
                      />
                      <span class="color-hex">{{ getMultiProp(l => l.style?.color_hex).mixed ? 'Mixed' : getMultiProp(l => l.style?.color_hex).value }}</span>
                    </div>
                  </div>
                </div>
                <div class="props-grid">
                  <div class="props-field">
                    <label>Spacing</label>
                    <input
                      type="number" step="0.5"
                      :value="getMultiProp(l => l.style?.letter_spacing).value"
                      :placeholder="getMultiProp(l => l.style?.letter_spacing).mixed ? 'Mixed' : ''"
                      @input="setMultiStyle('letter_spacing', Number(($event.target as HTMLInputElement).value))"
                    />
                  </div>
                  <div class="props-field">
                    <label>Line H.</label>
                    <input
                      type="number" step="0.05"
                      :value="getMultiProp(l => l.style?.line_height).value"
                      :placeholder="getMultiProp(l => l.style?.line_height).mixed ? 'Mixed' : ''"
                      @input="setMultiStyle('line_height', Number(($event.target as HTMLInputElement).value))"
                    />
                  </div>
                </div>
                <div class="props-field full">
                  <label>Align</label>
                  <CustomDropdown
                    :model-value="getMultiProp(l => l.style?.align).value || ''"
                    :options="[
                      ...(getMultiProp(l => l.style?.align).mixed ? [{ value: '', label: 'Mixed', disabled: true }] : []),
                      { value: 'left', label: 'Left' },
                      { value: 'center', label: 'Center' },
                      { value: 'right', label: 'Right' },
                    ]"
                    @update:model-value="setMultiStyle('align', $event)"
                    theme="dark"
                    size="sm"
                  />
                </div>
              </div>
            </div>

            <div class="props-section">
              <div class="props-section-header" @click="toggleSection('effects')">
                <span>Effects</span>
                <span class="chevron" :class="{ open: expandedSections.effects }">&#9662;</span>
              </div>
              <div v-show="expandedSections.effects" class="props-section-body">
                <div class="props-field full">
                  <label>Shadow</label>
                  <CustomDropdown
                    :model-value="getMultiProp(l => l.style?.shadow).value || ''"
                    :options="[
                      ...(getMultiProp(l => l.style?.shadow).mixed ? [{ value: '', label: 'Mixed', disabled: true }] : []),
                      { value: 'none', label: 'None' },
                      { value: 'subtle', label: 'Subtle' },
                      { value: 'strong', label: 'Strong' },
                    ]"
                    @update:model-value="setMultiStyle('shadow', $event)"
                    theme="dark"
                    size="sm"
                  />
                </div>
                <div class="props-grid">
                  <div class="props-field">
                    <label>Stroke</label>
                    <div class="color-input-wrap">
                      <input
                        type="color" class="color-input"
                        :value="getMultiProp(l => l.style?.stroke_hex).value || '#FFFFFF'"
                        @input="setMultiStyle('stroke_hex', ($event.target as HTMLInputElement).value)"
                      />
                    </div>
                  </div>
                  <div class="props-field">
                    <label>Width</label>
                    <input
                      type="number" min="0" max="10" step="0.5"
                      :value="getMultiProp(l => l.style?.stroke_width).value"
                      :placeholder="getMultiProp(l => l.style?.stroke_width).mixed ? 'Mixed' : ''"
                      @input="setMultiStyle('stroke_width', Number(($event.target as HTMLInputElement).value))"
                    />
                  </div>
                </div>
                <button
                  v-if="multiSelectCount === 1 && selectedLayer"
                  class="toggle-stroke-btn"
                  @click="
                    selectedLayer.style.stroke_width = selectedLayer.style.stroke_width ? 0 : 4;
                    selectedLayer.style.stroke_hex = selectedLayer.style.stroke_hex || '#FFFFFF';
                  "
                >
                  {{ selectedLayer.style.stroke_width ? 'Remove Stroke' : 'Add Stroke' }}
                </button>
              </div>
            </div>
          </template>

          <!-- Image layer: all selected must be image -->
          <template v-if="selectedLayers.every(l => l.type === 'image')">
            <div class="props-section">
              <div class="props-section-header">
                <span>Image</span>
              </div>
              <div class="props-section-body">
                <div class="props-field full" v-if="multiSelectCount === 1 && selectedLayer">
                  <label>Label</label>
                  <input :value="selectedLayer.label" type="text" disabled />
                </div>
                <div class="props-field full" v-else>
                  <label>Label</label>
                  <input type="text" disabled placeholder="(multiple layers)" />
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Rendered result -->
    <div v-if="renderedImage" class="result-bar">
      <h3>Rendered Result</h3>
      <div class="result-content">
        <img :src="`http://localhost:5001${renderedImage}`" class="result-img" />
        <div class="result-actions">
          <a :href="`http://localhost:5001${renderedImage}`" download class="toolbar-btn toolbar-btn-primary">
            Download PNG
          </a>
          <button @click="downloadAsSvg" class="toolbar-btn toolbar-btn-export">
            Download SVG
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ---- Studio shell ---- */
.studio-layout {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 120px);
  min-height: 600px;
  background: #1e1e2e;
  color: #e2e2e8;
  font-family: system-ui, -apple-system, sans-serif;
  border-radius: 8px;
  overflow: hidden;
}

/* ---- Toolbar ---- */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 16px;
  background: #1a1a28;
  border-bottom: 1px solid #2d2d44;
  flex-shrink: 0;
}
.toolbar-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  color: #e2e2e8;
}
.toolbar-left,
.toolbar-center,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toolbar-btn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid #3d3d5c;
  border-radius: 4px;
  background: #2d2d44;
  color: #e2e2e8;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
.toolbar-btn:hover {
  background: #3d3d5c;
}
.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.toolbar-btn-primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.toolbar-btn-primary:hover {
  background: #1d4ed8;
}
.toolbar-btn-export {
  background: #065f46;
  border-color: #065f46;
  color: #d1fae5;
}
.toolbar-btn-export:hover {
  background: #047857;
}
.toolbar-btn-psd {
  background: #7c3aed;
  color: white;
  border: none;
  padding: 0 14px;
  height: 32px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: not-allowed;
  opacity: 0.6;
}

/* ---- Studio body (3-panel) ---- */
.studio-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ---- Panels ---- */
.panel {
  background: #252536;
  border-right: 1px solid #2d2d44;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.panel-layers {
  width: 200px;
}
.panel-props {
  width: 260px;
  border-right: none;
  border-left: 1px solid #2d2d44;
}
.panel-header {
  height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #8b8ba0;
  border-bottom: 1px solid #2d2d44;
  flex-shrink: 0;
}
.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.props-scroll {
  padding: 0;
}

/* ---- Layers panel ---- */
.panel-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid #2d2d44;
}
.input-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.input-label {
  font-size: 10px;
  font-weight: 600;
  color: #8b8ba0;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.file-input {
  font-size: 11px;
  color: #8b8ba0;
  width: 100%;
}
.file-input::file-selector-button {
  height: 24px;
  padding: 0 8px;
  background: #2d2d44;
  border: 1px solid #3d3d5c;
  border-radius: 3px;
  color: #e2e2e8;
  font-size: 11px;
  cursor: pointer;
  margin-right: 6px;
}
.text-input {
  height: 28px;
  padding: 0 8px;
  background: #1e1e2e;
  border: 1px solid #3d3d5c;
  border-radius: 4px;
  color: #e2e2e8;
  font-size: 12px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.text-input:focus {
  border-color: #2563eb;
}
.error-msg {
  background: #3b1219;
  color: #fca5a5;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 11px;
  margin-bottom: 8px;
}

.layer-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.layer-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.1s;
}
.layer-item:hover {
  background: #2d2d44;
}
.layer-item-selected {
  background: #2563eb22;
  outline: 1px solid #2563eb44;
}
.layer-item-bg {
  opacity: 0.6;
  cursor: default;
}
.layer-order-btns {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.15s;
}
.layer-item:hover .layer-order-btns {
  opacity: 1;
}
.order-btn {
  width: 18px;
  height: 14px;
  padding: 0;
  background: transparent;
  border: none;
  color: #8b8ba0;
  font-size: 8px;
  cursor: pointer;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.order-btn:hover:not(:disabled) {
  background: #3d3d54;
  color: #e2e2e8;
}
.order-btn:disabled {
  opacity: 0.2;
  cursor: default;
}
.visibility-btn {
  background: none;
  border: none;
  color: #8b8ba0;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  border-radius: 2px;
  flex-shrink: 0;
}
.visibility-btn:hover {
  color: #e2e2e8;
}
.visibility-off {
  opacity: 0.35;
}
.layer-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  background: #3d3d5c;
  border-radius: 3px;
  color: #c4b5fd;
  flex-shrink: 0;
}
.layer-icon-img {
  color: #86efac;
  font-size: 8px;
}
.layer-icon-bg {
  color: #93c5fd;
  font-size: 8px;
}
.layer-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #c8c8d4;
}

/* ---- Workspace ---- */
.workspace {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    repeating-conic-gradient(#1a1a2e 0% 25%, #222238 0% 50%) 0 0 / 20px 20px;
  padding: 24px;
  overflow: auto;
  position: relative;
}
.canvas {
  position: relative;
  width: 100%;
  max-width: 600px;
  line-height: 0;
  cursor: crosshair;
  container-type: inline-size;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  border-radius: 2px;
}
.bg-img {
  width: 100%;
  display: block;
}
.bg-effect-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 400px;
  color: #8b8ba0;
  font-size: 14px;
  font-weight: 500;
}

/* ---- SVG overlay ---- */
.editor-svg-overlay-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 10;
}
.editor-svg-overlay-layer.full-svg {
  position: relative;
  inset: auto;
}
.editor-svg-overlay-layer.full-svg :deep(svg) {
  width: 100%;
  height: auto;
  display: block;
}
.editor-svg-overlay-layer > svg {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
  overflow: hidden;
}

/* ---- Layer boxes on canvas ---- */
.layer-box {
  position: absolute;
  cursor: move;
  user-select: none;
}
.component-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
  display: block;
}
.editable-text {
  white-space: pre-wrap;
  min-width: 20px;
  outline: none;
  display: inline-block;
}

/* ---- Selection outline + handles ---- */
.selection-outline {
  position: absolute;
  inset: -1px;
  border: 2px solid #2563eb;
  pointer-events: none;
  border-radius: 1px;
}
.handle {
  position: absolute;
  width: 8px;
  height: 8px;
  background: #fff;
  border: 1.5px solid #2563eb;
  border-radius: 1px;
  z-index: 999;
}
.handle-nw { top: -5px; left: -5px; cursor: nw-resize; }
.handle-n  { top: -5px; left: 50%; transform: translateX(-50%); cursor: n-resize; }
.handle-ne { top: -5px; right: -5px; cursor: ne-resize; }
.handle-e  { top: 50%; right: -5px; transform: translateY(-50%); cursor: e-resize; }
.handle-se { bottom: -5px; right: -5px; cursor: se-resize; }
.handle-s  { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: s-resize; }
.handle-sw { bottom: -5px; left: -5px; cursor: sw-resize; }
.handle-w  { top: 50%; left: -5px; transform: translateY(-50%); cursor: w-resize; }

/* ---- Properties panel ---- */
.props-section {
  border-bottom: 1px solid #2d2d44;
}
.props-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #8b8ba0;
  cursor: pointer;
  user-select: none;
}
.props-section-header:hover {
  color: #c8c8d4;
}
.chevron {
  font-size: 10px;
  transition: transform 0.15s;
  transform: rotate(-90deg);
}
.chevron.open {
  transform: rotate(0deg);
}
.props-section-body {
  padding: 0 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.props-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.props-grid.single {
  grid-template-columns: 1fr;
}
.props-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.props-field.full {
  grid-column: 1 / -1;
}
.props-field label {
  font-size: 10px;
  font-weight: 600;
  color: #8b8ba0;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.props-field input,
.props-field select {
  height: 28px;
  padding: 0 8px;
  background: #1e1e2e;
  border: 1px solid #3d3d5c;
  border-radius: 4px;
  color: #e2e2e8;
  font-size: 12px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.props-select {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  background: #2d2d44;
  border: 1px solid #3d3d54;
  border-radius: 6px;
  color: #e2e2e8;
  font-size: 12px;
}
.props-field input:focus,
.props-field select:focus {
  border-color: #2563eb;
}
.props-field input[type="number"] {
  -moz-appearance: textfield;
}
.props-field input[type="number"]::-webkit-inner-spin-button,
.props-field input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.props-field input::placeholder {
  color: #6b6b80;
  font-style: italic;
}
.color-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 4px;
  background: #1e1e2e;
  border: 1px solid #3d3d5c;
  border-radius: 4px;
}
.color-input {
  width: 20px !important;
  height: 20px !important;
  padding: 0 !important;
  border: none !important;
  background: none !important;
  cursor: pointer;
  flex-shrink: 0;
}
.color-hex {
  font-size: 11px;
  color: #8b8ba0;
  font-family: monospace;
}
.toggle-stroke-btn {
  height: 26px;
  padding: 0 10px;
  background: #2d2d44;
  border: 1px solid #3d3d5c;
  border-radius: 4px;
  color: #c8c8d4;
  font-size: 11px;
  cursor: pointer;
  width: 100%;
}
.toggle-stroke-btn:hover {
  background: #3d3d5c;
}
.delete-btn {
  background: none;
  border: none;
  color: #f87171;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  border-radius: 3px;
}
.delete-btn:hover {
  background: #3b121944;
}

/* ---- Result bar ---- */
.result-bar {
  padding: 16px;
  border-top: 1px solid #2d2d44;
  background: #252536;
}
.result-bar h3 {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 12px;
  color: #e2e2e8;
}
.result-content {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.result-img {
  max-width: 400px;
  width: 100%;
  border-radius: 4px;
}
.result-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.zoom-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  background: #2d2d44;
  border-radius: 6px;
  padding: 2px;
  margin-right: 12px;
}
.zoom-btn {
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  color: #8b8ba0;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.zoom-btn:hover:not(:disabled) {
  background: #3d3d54;
  color: #e2e2e8;
}
.zoom-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.zoom-fit {
  width: auto;
  padding: 0 8px;
  font-size: 11px;
}
.zoom-label {
  font-size: 11px;
  font-weight: 600;
  color: #8b8ba0;
  min-width: 40px;
  text-align: center;
}

/* ---- Snap guides ---- */
.snap-guide {
  position: absolute;
  pointer-events: none;
  z-index: 9999;
}
.snap-guide-h {
  height: 1px;
  background: #ff3366;
  left: 0;
  right: 0;
}
.snap-guide-v {
  width: 1px;
  background: #ff3366;
  top: 0;
  bottom: 0;
}

/* ---- Marquee selection ---- */
.marquee-rect {
  position: absolute;
  border: 1.5px solid #2563eb;
  background: rgba(37, 99, 235, 0.1);
  pointer-events: none;
  z-index: 9998;
}

/* ---- Fullscreen ---- */
.studio-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  border-radius: 0;
  min-height: 100vh;
  height: 100vh;
}

/* ---- Fullscreen icon button ---- */
.toolbar-btn-icon {
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #8b8ba0;
  cursor: pointer;
  border-radius: 6px;
  margin-left: 8px;
  transition: all 0.15s;
}
.toolbar-btn-icon:hover {
  background: #2d2d44;
  color: #e2e2e8;
}

</style>
