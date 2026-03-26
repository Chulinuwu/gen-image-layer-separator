<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: string | number;
    options: { value: string | number; label: string; disabled?: boolean }[];
    placeholder?: string;
    theme?: "light" | "dark";
    size?: "sm" | "md";
    disabled?: boolean;
  }>(),
  {
    placeholder: "Select...",
    theme: "light",
    size: "md",
    disabled: false,
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: string | number];
}>();

const isOpen = ref(false);
const focusedIndex = ref(-1);
const dropdownRef = ref<HTMLElement | null>(null);

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? ""
);

const toggle = () => {
  if (props.disabled) return;
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    focusedIndex.value = props.options.findIndex(
      (o) => o.value === props.modelValue
    );
  }
};

const select = (opt: { value: string | number; label: string; disabled?: boolean }) => {
  if (opt.disabled) return;
  emit("update:modelValue", opt.value);
  isOpen.value = false;
  focusedIndex.value = -1;
};

const onKeydown = (e: KeyboardEvent) => {
  if (props.disabled) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (isOpen.value && focusedIndex.value >= 0) {
      select(props.options[focusedIndex.value]);
    } else {
      toggle();
    }
  } else if (e.key === "Escape") {
    isOpen.value = false;
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!isOpen.value) {
      isOpen.value = true;
      focusedIndex.value = 0;
    } else {
      focusedIndex.value = Math.min(focusedIndex.value + 1, props.options.length - 1);
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    focusedIndex.value = Math.max(focusedIndex.value - 1, 0);
  }
};

const onClickOutside = (e: MouseEvent) => {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    isOpen.value = false;
  }
};

onMounted(() => document.addEventListener("mousedown", onClickOutside));
onUnmounted(() => document.removeEventListener("mousedown", onClickOutside));
</script>

<template>
  <div
    ref="dropdownRef"
    class="dropdown"
    :class="[`dropdown-${theme}`, `dropdown-${size}`, { open: isOpen, disabled }]"
    @keydown="onKeydown"
  >
    <button
      class="dropdown-trigger"
      type="button"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="dropdown-value">{{ selectedLabel || placeholder }}</span>
      <svg
        class="dropdown-chevron"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <path
          d="M3 5l3 3 3-3"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    </button>
    <Transition name="dropdown">
      <div v-if="isOpen" class="dropdown-menu">
        <div
          v-for="(opt, i) in options"
          :key="opt.value"
          class="dropdown-option"
          :class="{
            selected: opt.value === modelValue,
            focused: focusedIndex === i,
            disabled: opt.disabled,
          }"
          @click="select(opt)"
          @mouseenter="focusedIndex = i"
        >
          <span>{{ opt.label }}</span>
          <svg
            v-if="opt.value === modelValue"
            class="check-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.dropdown {
  position: relative;
  display: inline-block;
  width: 100%;
  font-family: inherit;
}

.dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  border: 1px solid;
  border-radius: 8px;
  cursor: pointer;
  background: none;
  font-family: inherit;
  text-align: left;
  transition: background 0.12s, border-color 0.12s;
  outline: none;
  gap: 8px;
}

.dropdown-trigger:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.dropdown-value {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-chevron {
  flex-shrink: 0;
  transition: transform 0.2s;
}

.open .dropdown-chevron {
  transform: rotate(180deg);
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 1000;
  border-radius: 8px;
  overflow: hidden;
  max-height: 240px;
  overflow-y: auto;
}

.dropdown-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  transition: background 0.1s;
  gap: 8px;
}

.dropdown-option.disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}

/* --- Size: md --- */
.dropdown-md .dropdown-trigger {
  height: 36px;
  font-size: 13px;
  padding: 6px 12px;
}

.dropdown-md .dropdown-option {
  font-size: 13px;
  padding: 7px 12px;
}

/* --- Size: sm --- */
.dropdown-sm .dropdown-trigger {
  height: 28px;
  font-size: 12px;
  padding: 4px 8px;
}

.dropdown-sm .dropdown-option {
  font-size: 12px;
  padding: 5px 8px;
}

/* --- Theme: light --- */
.dropdown-light .dropdown-trigger {
  background: #ffffff;
  border-color: #d0d5dd;
  color: #344054;
}

.dropdown-light .dropdown-trigger:not(:disabled):hover {
  background: #f9fafb;
}

.dropdown-light .dropdown-menu {
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  border: 1px solid #e4e7ec;
}

.dropdown-light .dropdown-option {
  color: #344054;
}

.dropdown-light .dropdown-option:hover,
.dropdown-light .dropdown-option.focused {
  background: #f0f4ff;
}

.dropdown-light .dropdown-option.selected {
  color: #2563eb;
  background: #eff4ff;
}

/* --- Theme: dark --- */
.dropdown-dark .dropdown-trigger {
  background: #2d2d44;
  border-color: #3d3d54;
  color: #e2e2e8;
}

.dropdown-dark .dropdown-trigger:not(:disabled):hover {
  background: #3d3d54;
}

.dropdown-dark .dropdown-menu {
  background: #2d2d44;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  border: 1px solid #3d3d54;
}

.dropdown-dark .dropdown-option {
  color: #e2e2e8;
}

.dropdown-dark .dropdown-option:hover,
.dropdown-dark .dropdown-option.focused {
  background: #3d3d54;
}

.dropdown-dark .dropdown-option.selected {
  color: #60a5fa;
  background: #1e3a5f;
}

/* --- Disabled state --- */
.dropdown.disabled .dropdown-trigger {
  opacity: 0.5;
  cursor: not-allowed;
}

/* --- Transitions --- */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
