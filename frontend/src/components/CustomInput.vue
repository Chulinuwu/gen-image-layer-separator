<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  rows?: number;
  maxRows?: number;
  multiline?: boolean;
  theme?: 'light' | 'dark';
  size?: 'sm' | 'md';
  disabled?: boolean;
}>(), {
  placeholder: '',
  rows: 1,
  maxRows: 8,
  multiline: false,
  theme: 'light',
  size: 'md',
  disabled: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);

const resize = () => {
  const el = textareaRef.value;
  if (!el || !props.multiline) return;
  el.style.height = 'auto';
  const lineHeight = props.size === 'sm' ? 20 : 24;
  const maxHeight = props.maxRows * lineHeight + 16;
  const newHeight = Math.min(el.scrollHeight, maxHeight);
  el.style.height = newHeight + 'px';
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
};

const onInput = (e: Event) => {
  const val = (e.target as HTMLTextAreaElement).value;
  emit('update:modelValue', val);
  if (props.multiline) nextTick(resize);
};

watch(() => props.modelValue, () => {
  if (props.multiline) nextTick(resize);
});

onMounted(() => {
  if (props.multiline) nextTick(resize);
});
</script>

<template>
  <div class="custom-input" :class="[`ci-${theme}`, `ci-${size}`, { disabled }]">
    <textarea
      v-if="multiline"
      ref="textareaRef"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :rows="rows"
      class="ci-field ci-textarea"
      @input="onInput"
    />
    <input
      v-else
      type="text"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      class="ci-field ci-input"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>

<style scoped>
.custom-input {
  width: 100%;
}

.ci-field {
  width: 100%;
  border: 1.5px solid #d0d5dd;
  border-radius: 10px;
  font-family: inherit;
  transition: border-color 0.2s, box-shadow 0.2s;
  resize: none;
  background: white;
  color: #1e293b;
  box-sizing: border-box;
}

.ci-field:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.ci-field::placeholder {
  color: #94a3b8;
}

.ci-md .ci-field {
  padding: 10px 14px;
  font-size: 14px;
  line-height: 24px;
}

.ci-sm .ci-field {
  padding: 6px 10px;
  font-size: 12px;
  line-height: 20px;
}

.ci-textarea {
  min-height: 0;
  overflow-y: hidden;
}

.ci-dark .ci-field {
  background: #2d2d44;
  border-color: #3d3d54;
  color: #e2e2e8;
}
.ci-dark .ci-field:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}
.ci-dark .ci-field::placeholder {
  color: #6b6b80;
}

.disabled .ci-field {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
