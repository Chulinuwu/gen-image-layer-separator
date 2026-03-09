<script setup lang="ts">
import { ref, reactive, watch, computed } from "vue";
import createDOMPurify from "dompurify";
const DOMPurify = createDOMPurify(window);

const props = defineProps({
  initialBackground: String,
  campaignData: Object as () => any,
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

// Force canvas aspect-ratio to match the loaded BG image — must match preview exactly
const onEditorImageLoad = (e: Event) => {
  const img = e.target as HTMLImageElement;
  if (img.naturalWidth && img.naturalHeight && editorCanvasEl.value) {
    const ratio = `${img.naturalWidth} / ${img.naturalHeight}`;
    editorCanvasEl.value.style.aspectRatio = ratio;
    const rect = editorCanvasEl.value.getBoundingClientRect();
    console.log(`[Editor] BG image natural: ${img.naturalWidth}x${img.naturalHeight}, container: ${Math.round(rect.width)}x${Math.round(rect.height)}, aspect-ratio: ${ratio}`);
  }
};
const renderedImage = ref<string | null>(null);
const hintText = ref("");
const renderMode = ref("ai"); // 'ai' or 'simple'

// SVG overlay mode — set when campaignData has svg_overlay
const svgOverlay = ref<string>("");
const hasSvgOverlay = computed(() => !!svgOverlay.value && svgOverlay.value.length > 50);
const sanitizedEditorSvgOverlay = computed(() => {
  if (!svgOverlay.value) return "";
  return DOMPurify.sanitize(svgOverlay.value, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: [
      "svg",
      "g",
      "text",
      "tspan",
      "rect",
      "defs",
      "filter",
      "feDropShadow",
      "image",
      "style",
      "clipPath",
    ],
    ADD_ATTR: [
      "viewBox",
      "xmlns",
      "transform",
      "font-family",
      "font-size",
      "font-weight",
      "fill",
      "stroke",
      "stroke-width",
      "paint-order",
      "filter",
      "dy",
      "dx",
      "x",
      "y",
      "rx",
      "ry",
      "width",
      "height",
      "flood-color",
      "flood-opacity",
      "stdDeviation",
      "in",
      "preserveAspectRatio",
      "id",
      "letter-spacing",
      "clip-path",
    ],
  });
});

/**
 * Convert a flex tree + component image URLs into editable layer objects.
 * Uses computeFlexLayout-equivalent logic to get bounding boxes, then maps to layers.
 */
function flexTreeToLayers(
  flexTree: any,
  canvasSize: { w: number; h: number },
  componentImageUrls: Record<string, string>,
): any[] {
  if (!flexTree) return [];

  const cw = canvasSize.w || 1080;
  const ch = canvasSize.h || 1080;
  const layers: any[] = [];
  let layerId = 0;

  // Flatten flex tree into bounding boxes (same logic as frontend flattenFlexTree + backend computeFlexLayout)
  interface Box {
    id: string; type?: string; text?: string; label?: string;
    x: number; y: number; w: number; h: number;
    style?: any;
  }

  function flatten(node: any, x: number, y: number, w: number, h: number, out: Box[]): void {
    if (!node) return;
    const pad = node.padding ?? 0;
    const ix = x + pad, iy = y + pad, iw = w - pad * 2, ih = h - pad * 2;

    if (node.type && !node.children?.length) {
      out.push({ id: node.id, type: node.type, text: node.text, label: node.label, x: ix, y: iy, w: iw, h: ih, style: node.style });
      return;
    }
    const children = node.children ?? [];
    if (!children.length) return;
    const dir = node.direction ?? 'column';
    const gap = node.gap ?? 8;
    const totalGap = gap * (children.length - 1);
    const avail = (dir === 'row' ? iw : ih) - totalGap;

    const sizes = children.map((c: any) => {
      const pct = dir === 'row' ? c.width : c.height;
      return pct ? parseFloat(pct) / 100 : null;
    });
    const allocd = sizes.reduce((s: number, v: number | null) => s + (v ?? 0), 0);
    const unalloc = sizes.filter((s: number | null) => s === null).length;
    const each = unalloc > 0 ? Math.max(0, 1 - allocd) / unalloc : 0;

    let cursor = dir === 'row' ? ix : iy;
    for (let i = 0; i < children.length; i++) {
      const frac = sizes[i] ?? each;
      const main = avail * frac;
      const cx = dir === 'row' ? cursor : ix;
      const cy = dir === 'row' ? iy : cursor;
      const cWidth = dir === 'row' ? main : iw;
      const cHeight = dir === 'row' ? ih : main;
      flatten(children[i], cx, cy, cWidth, cHeight, out);
      cursor += main + gap;
    }
  }

  const boxes: Box[] = [];
  flatten(flexTree, 0, 0, cw, ch, boxes);
  console.log(`[Editor] flexTreeToLayers: ${boxes.length} boxes from ${cw}×${ch} canvas`);

  // Font size mapping (same as svgBuilder FLEX_FONT_RATIO)
  const fontRatio: Record<string, number> = {
    xlarge: 1.0, large: 0.75, medium: 0.5, small: 0.35, xsmall: 0.22,
  };

  for (const box of boxes) {
    if (box.type === 'component') {
      const imgUrl = componentImageUrls[box.label || ''] || '';
      layers.push({
        type: 'image',
        label: box.label || box.id,
        imageUrl: imgUrl,
        id: layerId++,
        x: (box.x / cw) * 100,
        y: (box.y / ch) * 100,
        w: (box.w / cw) * 100,
        h: (box.h / ch) * 100,
        rotation: 0,
        z_index: 15,
      });
    } else if (box.type === 'text' && box.text) {
      const s = box.style || {};
      const ratio = fontRatio[s.fontSize || 'medium'] || 0.5;
      const pxFont = Math.round(box.h * ratio);
      const fontSizeNormalized = Math.round((pxFont / cw) * 1000);

      const alignMap: Record<string, string> = { left: 'left', center: 'center', right: 'right' };

      layers.push({
        type: 'text',
        content: box.text,
        id: layerId++,
        x: (box.x / cw) * 100,
        y: (box.y / ch) * 100,
        w: (box.w / cw) * 100,
        h: (box.h / ch) * 100,
        rotation: 0,
        z_index: 10,
        visual_container: 'none',
        style: {
          font_family: 'Kanit',
          font_weight: s.fontWeight || '700',
          font_size_normalized: fontSizeNormalized,
          color_hex: s.color || '#FFFFFF',
          stroke_hex: s.strokeColor || undefined,
          stroke_width: s.strokeWidth || undefined,
          letter_spacing: 0,
          line_height: 1.35,
          shadow: s.strokeColor ? 'none' : 'subtle',
          align: alignMap[s.align || 'center'] || 'center',
          background_color: s.backgroundColor || undefined,
        },
      });
    }
  }

  console.log(`[Editor] flexTreeToLayers: ${layers.length} layers (${layers.filter(l => l.type === 'image').length} images, ${layers.filter(l => l.type === 'text').length} text)`);
  return layers;
}

// Watch for background prop
watch(
  () => props.initialBackground,
  async (bgUrl) => {
    if (!bgUrl) return;
    try {
      const response = await fetch(`http://localhost:5001${bgUrl}`);
      const blob = await response.blob();
      bgFile.value = new File([blob], "background.png", { type: blob.type });
      bgPreviewUrl.value = URL.createObjectURL(bgFile.value);
      console.log("[Editor] Background loaded from prop:", bgUrl);
    } catch (e) {
      console.error("Editor: Failed to load initial background", e);
    }
  },
  { immediate: true },
);

// Watch for campaign data prop — loads layers immediately when available
watch(
  () => props.campaignData,
  async (data) => {
    if (!data) return;

    console.log(
      "[Editor] Campaign data received:",
      JSON.stringify({
        referenceImage: data.referenceImage,
        generatedBackgroundImageUrl: data.generatedBackgroundImageUrl || "NULL",
        svg_overlay: data.svg_overlay ? `${data.svg_overlay.length} chars` : "NONE",
        flexTree: data.flexTree ? "YES" : "NO",
        canvasSize: data.canvasSize || "NONE",
        textLayers: data.textLayers?.length || 0,
        visualComponents: data.visualComponents?.length || 0,
        componentPositions: data.visualComponents?.map((c: any) => ({
          label: c.label,
          top: c.position?.top,
          left: c.position?.left,
          width: c.position?.width,
          height: c.position?.height,
        })),
      }),
    );

    // Load background (prefer generated clean background if available)
    const bgToUse = data.generatedBackgroundImageUrl || data.referenceImage;
    console.log(`[Editor] BG URL: ${bgToUse} (generated: ${data.generatedBackgroundImageUrl || 'NULL'}, ref: ${data.referenceImage})`);
    if (bgToUse) {
      try {
        const response = await fetch(`http://localhost:5001${bgToUse}`);
        const blob = await response.blob();
        bgFile.value = new File([blob], "background.png", { type: blob.type });
        bgPreviewUrl.value = URL.createObjectURL(bgFile.value);
        console.log("[Editor] Background loaded:", bgToUse);
      } catch (e) {
        console.error("Editor: Failed to load background", e);
      }
    }

    // Load reference image as preview overlay
    if (data.referenceImage) {
      try {
        const response = await fetch(
          `http://localhost:5001${data.referenceImage}`,
        );
        const blob = await response.blob();
        selectedFile.value = new File([blob], "reference.png", {
          type: blob.type,
        });
        previewUrl.value = URL.createObjectURL(selectedFile.value);
        console.log("[Editor] Reference image loaded as overlay");
      } catch (e) {
        console.error("Editor: Failed to load reference image", e);
      }
    }

    // Convert campaign data directly into layers
    const imageLayers: any[] = [];
    const textLayers: any[] = [];

    // Visual components → image layers
    if (data.visualComponents?.length) {
      data.visualComponents.forEach((comp: any) => {
        imageLayers.push({
          type: "image",
          label: comp.label,
          imageUrl: `http://localhost:5001${comp.imageUrl}`,
          id: imageLayers.length,
          x: comp.position.left / 10,
          y: comp.position.top / 10,
          w: comp.position.width / 10,
          h: comp.position.height / 10,
          rotation: comp.position.rotation || 0,
          z_index: comp.z_index || 15,
          interaction_zone: comp.interaction_zone || null,
        });
      });
    }

    // Text suggestions → text layers
    if (data.textLayers?.length) {
      data.textLayers.forEach((t: any) => {
        textLayers.push({
          type: "text",
          content: t.part,
          style: t.style || {},
          id: imageLayers.length + textLayers.length,
          x: t.position.left / 10,
          y: t.position.top / 10,
          w: t.position.width / 10,
          h: t.position.height / 10,
          rotation: t.position.rotation || 0,
          z_index: t.z_index || 10,
          visual_container: t.visual_container || "none",
        });
      });
    }

    // Character depth interaction: DISABLED — no intentional overlap until system is ready
    // const characterLayers = imageLayers.filter(
    //   (l: any) => l.interaction_zone?.enabled,
    // );
    // if (characterLayers.length > 0) {
    //   textLayers.forEach((tl: any) => {
    //     const tLeft = tl.x;
    //     const tTop = tl.y;
    //     const tRight = tl.x + tl.w;
    //     const tBottom = tl.y + tl.h;
    //     for (const cl of characterLayers) {
    //       const iz = cl.interaction_zone;
    //       const izLeft = iz.overlap_left / 10;
    //       const izTop = iz.overlap_top / 10;
    //       const izRight = (iz.overlap_left + iz.overlap_width) / 10;
    //       const izBottom = (iz.overlap_top + iz.overlap_height) / 10;
    //       const overlaps = !(
    //         tRight <= izLeft ||
    //         tLeft >= izRight ||
    //         tBottom <= izTop ||
    //         tTop >= izBottom
    //       );
    //       if (overlaps) {
    //         tl.z_index = Math.min(tl.z_index, cl.z_index - 5);
    //       }
    //     }
    //   });
    // }

    // Convert flex tree into editable layers (preferred) or fall back to SVG overlay
    const hasCleanBg = !!data.generatedBackgroundImageUrl;
    if (data.flexTree && data.canvasSize) {
      // Build component image URL map from visualComponents
      const compUrls: Record<string, string> = {};
      if (data.visualComponents?.length) {
        for (const vc of data.visualComponents) {
          compUrls[vc.label] = `http://localhost:5001${vc.imageUrl}`;
        }
      }
      const flexLayers = flexTreeToLayers(data.flexTree, data.canvasSize, compUrls);
      if (flexLayers.length > 0) {
        svgOverlay.value = ""; // editable layers — no read-only SVG
        layers.value = flexLayers;
        console.log(`[Editor] Flex tree → ${flexLayers.length} editable layers`);
      } else {
        // Fallback: show read-only SVG
        svgOverlay.value = data.svg_overlay || "";
        layers.value = hasCleanBg ? [...imageLayers, ...textLayers] : [...textLayers];
        console.log(`[Editor] Flex tree empty — fallback mode`);
      }
    } else if (data.svg_overlay && data.svg_overlay.length > 50) {
      // No flex tree available — show read-only SVG
      svgOverlay.value = data.svg_overlay;
      layers.value = [];
      console.log(`[Editor] SVG overlay mode (no flex tree): ${data.svg_overlay.length} chars`);
    } else {
      svgOverlay.value = "";
      layers.value = hasCleanBg
        ? [...imageLayers, ...textLayers]
        : [...textLayers];
    }

    // Initial sync of text content to DOM refs
    setTimeout(() => {
      layers.value.forEach((layer) => {
        if (layer.type === "text") {
          const el = textRefs.value[layer.id];
          if (el) el.innerText = layer.content;
        }
      });
    }, 0);

    console.log(
      `[Editor] Loaded ${imageLayers.length} image + ${textLayers.length} text layers from campaign data`,
    );
  },
  { immediate: true },
);

// Selected Layer for UI
const selectedLayerId = ref<number | null>(null);

// Dragging state
const dragItem = ref<number | null>(null);
const dragOffset = reactive({ x: 0, y: 0 });
const focusedLayerId = ref<number | null>(null);
const textRefs = ref<Record<number, HTMLElement>>({});

// Watch for model changes and sync to DOM only if not focused
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

// Additional container styles (background color, text alignment from SVG parsing)
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
      // Worker 1: Text layers
      const textLayers = data.data.analysis.layers.map(
        (l: any, idx: number) => ({
          ...l,
          type: "text",
          id: idx,
          x: l.position.left / 10,
          y: l.position.top / 10,
          w: l.position.width / 10,
          h: l.position.height / 10,
        }),
      );

      // Worker 2: Visual component layers (die-cut PNGs from server)
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
  const bgImg = document.querySelector(".bg-img") as HTMLImageElement;
  if (!bgImg || !layers.value.length) return null;

  const width = bgImg.naturalWidth;
  const height = bgImg.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // 1. Draw Background
  ctx.drawImage(bgImg, 0, 0);

  // 2. Draw Layers
  for (const l of layers.value) {
    const x = (l.x / 100) * width;
    const y = (l.y / 100) * height;
    const w = (l.w / 100) * width;
    const h = (l.h / 100) * height;
    const rotation = l.rotation || 0;

    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((rotation * Math.PI) / 180);
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
      // Use natural scaling for font
      const pxFontSize = (fontSize / 1000) * height;

      ctx.font = `${l.style.font_weight || "normal"} ${pxFontSize}px ${l.style.font_family || "sans-serif"}`;
      ctx.fillStyle = l.style.color_hex || "#FFFFFF";
      ctx.textBaseline = "top";

      // Shadow
      if (l.style.shadow !== "none") {
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = l.style.shadow === "strong" ? 12 : 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
      }

      const lines = (l.content || "").split("\n");
      const lineHeight = (l.style.line_height || 1.2) * pxFontSize;

      // Stroke (Draw BEFORE fill to simulate paint-order: stroke fill)
      if (l.style.stroke_hex && l.style.stroke_width) {
        ctx.strokeStyle = l.style.stroke_hex;
        ctx.lineWidth = l.style.stroke_width * 2; // Scale nicely
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
  const layer = layers.value[idx];
  const isEditable = (e.target as HTMLElement).classList.contains(
    "editable-text",
  );

  // Prevent browser default ghost drag for images or clicking outside editable span
  if (layer.type === "image" || !isEditable) {
    e.preventDefault();
  }

  e.stopPropagation();
  selectedLayerId.value = idx;
  dragItem.value = idx;

  const clientX = e.clientX;
  const clientY = e.clientY;

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

// Selection layer finding
const deleteLayer = () => {
  if (selectedLayerId.value !== null) {
    layers.value.splice(selectedLayerId.value, 1);
    selectedLayerId.value = null;
  }
};

const downloadAsSvg = async () => {
  const bgImgElement = document.querySelector(".bg-img") as HTMLImageElement;
  if (!bgImgElement) return;

  const width = bgImgElement.naturalWidth;
  const height = bgImgElement.naturalHeight;

  // Convert background to base64 for embedding
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(bgImgElement, 0, 0);
  const base64Bg = canvas.toDataURL("image/png");

  let svgContent = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

  // Background
  svgContent += `<image href="${base64Bg}" width="${width}" height="${height}" x="0" y="0" />`;

  // Layers
  for (const l of layers.value) {
    const x = (l.x / 100) * width;
    const y = (l.y / 100) * height;
    const w = (l.w / 100) * width;
    const h = (l.h / 100) * height;
    const rotation = l.rotation || 0;
    const rotateStr = `rotate(${rotation}, ${x + w / 2}, ${y + h / 2})`;

    if (l.type === "image") {
      // Embedding image base64
      try {
        const resp = await fetch(l.imageUrl);
        const blob = await resp.blob();
        const reader = new FileReader();
        const base64Img = await new Promise((resolve) => {
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        svgContent += `
          <image
            href="${base64Img}"
            width="${w}"
            height="${h}"
            x="${x}"
            y="${y}"
            transform="${rotateStr}"
          />`;
      } catch (e) {
        console.error("SVG Export: Failed to embed component image", e);
      }
    } else {
      const escapedContent = (l.content || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const fontSize = l.style.font_size_normalized || 40;

      svgContent += `
        <text
          x="${x}"
          y="${y + fontSize * 0.8}"
          fill="${l.style.color_hex || "#000"}"
          font-family="${l.style.font_family || "sans-serif"}"
          font-size="${fontSize}px"
          font-weight="${l.style.font_weight || "normal"}"
          transform="${rotateStr}"
        >${escapedContent}</text>`;
    }
  }

  svgContent += "</svg>";

  const blob = new Blob([svgContent], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ad-layout.svg";
  link.click();
  URL.revokeObjectURL(url);
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
          @click="processImage('full')"
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
        <!-- Text layer controls -->
        <template v-if="layers[selectedLayerId]?.type !== 'image'">
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
          <div class="prop-item">
            <label>Letter Spacing</label>
            <div class="flex no-gap">
              <button
                class="mini-btn left"
                @click="
                  layers[selectedLayerId].style.letter_spacing =
                    (Number(layers[selectedLayerId].style.letter_spacing) ||
                      0) - 1
                "
              >
                -
              </button>
              <input
                v-model.number="layers[selectedLayerId].style.letter_spacing"
                type="number"
                class="w-16"
              />
              <button
                class="mini-btn right"
                @click="
                  layers[selectedLayerId].style.letter_spacing =
                    (Number(layers[selectedLayerId].style.letter_spacing) ||
                      0) + 1
                "
              >
                +
              </button>
            </div>
          </div>
          <div class="prop-item">
            <label>Line Height</label>
            <div class="flex no-gap">
              <button
                class="mini-btn left"
                @click="
                  layers[selectedLayerId].style.line_height =
                    (Number(layers[selectedLayerId].style.line_height) || 1.2) -
                    0.1
                "
              >
                -
              </button>
              <input
                v-model.number="layers[selectedLayerId].style.line_height"
                type="number"
                step="0.1"
                class="w-16"
              />
              <button
                class="mini-btn right"
                @click="
                  layers[selectedLayerId].style.line_height =
                    (Number(layers[selectedLayerId].style.line_height) || 1.2) +
                    0.1
                "
              >
                +
              </button>
            </div>
          </div>
          <div class="prop-item">
            <label>Effect (Shadow)</label>
            <select
              v-model="layers[selectedLayerId].style.shadow"
              class="w-full"
            >
              <option value="none">None</option>
              <option value="subtle">Subtle Shadow</option>
              <option value="strong">Strong Shadow</option>
            </select>
          </div>
          <!-- Stroke / Outline Controls -->
          <div class="prop-item">
            <label>Text Outline</label>
            <div class="flex no-gap align-center">
              <input
                type="color"
                v-model="layers[selectedLayerId].style.stroke_hex"
                class="w-8 h-8 p-0 border-none mr-2"
                title="Outline Color"
              />
              <input
                v-model.number="layers[selectedLayerId].style.stroke_width"
                type="number"
                min="0"
                max="10"
                step="0.5"
                placeholder="Width"
                class="w-16"
                title="Outline Width (px)"
              />
              <button
                class="mini-btn ml-2"
                @click="
                  layers[selectedLayerId].style.stroke_width = layers[
                    selectedLayerId
                  ].style.stroke_width
                    ? 0
                    : 4;
                  layers[selectedLayerId].style.stroke_hex = '#FFFFFF';
                "
              >
                {{ layers[selectedLayerId].style.stroke_width ? "ON" : "OFF" }}
              </button>
            </div>
          </div>
        </template>
        <!-- Mixed controls (Rotation, Opacity) -->
        <div class="prop-item">
          <label>Rotation</label>
          <div class="flex no-gap">
            <button
              class="mini-btn left"
              @click="layers[selectedLayerId].rotation -= 5"
            >
              -
            </button>
            <input
              v-model.number="layers[selectedLayerId].rotation"
              type="number"
              class="w-16"
            />
            <button
              class="mini-btn right"
              @click="layers[selectedLayerId].rotation += 5"
            >
              +
            </button>
          </div>
        </div>
        <!-- Scale controls for images -->
        <template v-if="layers[selectedLayerId].type === 'image'">
          <div class="prop-item">
            <label>Width (%)</label>
            <input
              v-model.number="layers[selectedLayerId].w"
              type="number"
              step="0.5"
              class="w-16"
            />
          </div>
          <div class="prop-item">
            <label>Height (%)</label>
            <input
              v-model.number="layers[selectedLayerId].h"
              type="number"
              step="0.5"
              class="w-16"
            />
          </div>
        </template>
        <div class="prop-item ml-auto">
          <button class="btn-danger" @click="deleteLayer">Delete</button>
        </div>
      </div>
    </div>

    <div
      class="editor-view"
      ref="canvasContainer"
      @mousedown="selectedLayerId = null"
    >
      <div
        v-if="previewUrl || bgPreviewUrl || layers.length > 0"
        class="canvas"
        ref="editorCanvasEl"
      >
        <img
          v-if="(bgPreviewUrl || previewUrl) && !hasSvgOverlay"
          :src="
            (layers.length > 0 ? bgPreviewUrl || previewUrl : previewUrl) ??
            undefined
          "
          class="bg-img"
          draggable="false"
          style="user-select: none; pointer-events: none"
          @load="onEditorImageLoad"
        />

        <!-- SVG overlay — AI-generated SVG (BG + components + text), read-only -->
        <div
          v-if="sanitizedEditorSvgOverlay"
          v-html="sanitizedEditorSvgOverlay"
          :class="['editor-svg-overlay-layer', { 'full-svg': hasSvgOverlay }]"
          title="Text generated as SVG — use AI refinement to edit"
        />

        <div
          v-for="(layer, idx) in layers"
          :key="layer.id"
          class="text-layer"
          :class="{ active: selectedLayerId === idx }"
          :style="
            layer.type === 'image'
              ? {
                  top: layer.y + '%',
                  left: layer.x + '%',
                  width: layer.w + '%',
                  height: layer.h + '%',
                  transform: `rotate(${layer.rotation || 0}deg)`,
                  zIndex: layer.z_index,
                  padding: '0',
                }
              : {
                  top: layer.y + '%',
                  left: layer.x + '%',
                  color: layer.style.color_hex,
                  fontSize:
                    (layer.style.font_size_normalized || 40) * 0.1 + 'cqw',
                  fontFamily: `${layer.style.font_family || 'Kanit'}, sans-serif`,
                  fontWeight: layer.style.font_weight,
                  letterSpacing: (layer.style.letter_spacing || 0) + 'px',
                  lineHeight: layer.style.line_height || 1.2,
                  textShadow: getShadowStyle(layer.style.shadow),
                  WebkitTextStroke: layer.style.stroke_hex
                    ? `${layer.style.stroke_width || 1}px ${layer.style.stroke_hex}`
                    : undefined,
                  paintOrder: layer.style.stroke_hex ? 'stroke fill' : undefined,
                  transform: `rotate(${layer.rotation || 0}deg)`,
                  zIndex: layer.z_index,
                }
          "
          @mousedown="startDrag($event, idx)"
        >
          <!-- Image layer -->
          <img
            v-if="layer.type === 'image'"
            :src="layer.imageUrl"
            :alt="layer.label"
            :title="layer.label"
            class="component-img"
            draggable="false"
          />
          <!-- Text layer -->
          <span
            v-else
            :ref="
              (el) => {
                if (el) textRefs[layer.id] = el as HTMLElement;
              }
            "
            contenteditable="true"
            @input="updateText(idx, $event)"
            @focus="selectAll(idx)"
            @blur="onBlurText"
            class="editable-text"
            :style="getEditorContainerStyle(layer)"
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

    <div
      v-if="layers.length"
      class="layer-actions mt-4 flex gap-4 align-center"
    >
      <div class="render-controls flex gap-2">
        <select v-model="renderMode" class="render-mode-select">
          <option value="ai">AI Production (Quality)</option>
          <option value="simple">Raw PNG (Dumb/Speed)</option>
        </select>
        <button
          :disabled="rendering"
          @click="renderImage"
          class="btn-primary"
          style="margin-top: 0"
        >
          {{ rendering ? "Rendering..." : "Save & Render" }}
        </button>
      </div>
      <button
        @click="downloadAsSvg"
        class="btn-primary"
        style="background-color: #059669 !important; margin-top: 0; width: auto"
      >
        Export as SVG
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
      <div class="mt-4 flex gap-4">
        <a
          v-if="renderedImage"
          :href="`http://localhost:5001${renderedImage}`"
          download
          class="btn-download"
          >Download PNG</a
        >
        <button
          v-if="layers.length > 0"
          @click="downloadAsSvg"
          class="btn-primary"
          style="background-color: #059669 !important"
        >
          Download SVG (Editable)
        </button>
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

select {
  height: 38px;
  padding: 0 12px;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  background: white;
  font-size: 0.9rem;
  color: #344054;
  outline: none;
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

/* SVG overlay in editor — read-only AI text overlay */
.editor-svg-overlay-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 10;
}
/* Full SVG mode — SVG contains BG + components + text, displayed as standalone */
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

.component-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.component-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: #344054;
  padding: 6px 12px;
  background: #f2f4f7;
  border-radius: 8px;
  display: inline-block;
}

.editable-text {
  white-space: pre-wrap;
  min-width: 20px;
  outline: none;
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
  max-width: 600px; /* match preview canvas max-width so proportions look identical */
  margin-left: auto;
  margin-right: auto;
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
  container-type: inline-size;
}
.bg-img {
  width: 100%;
  display: block;
}

.component-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
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

.render-controls {
  background: #f8fafc;
  padding: 4px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.render-mode-select {
  border: none;
  background: transparent;
  font-weight: 600;
  color: #475569;
  padding: 0 12px;
  cursor: pointer;
}

.render-mode-select:focus {
  outline: none;
}

.align-center {
  align-items: center;
}
.gap-2 {
  gap: 8px;
}
.gap-4 {
  gap: 16px;
}
</style>
