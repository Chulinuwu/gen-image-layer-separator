<script setup lang="ts">
import { ref } from "vue";
import ImageGenerator from "./components/ImageGenerator.vue";
import CampaignLayout from "./components/CampaignLayout.vue";
import LayerEditor from "./components/LayerEditor.vue";

const activeTab = ref("generate");

// Shared Assets State
const sharedBackgroundUrl = ref<string | undefined>(undefined);
const sharedCampaignData = ref<any>(null);

const onBackgroundGenerated = (url: string) => {
  sharedBackgroundUrl.value = url;
};

const onCampaignCreated = (data: any) => {
  sharedCampaignData.value = data;
};
</script>

<template>
  <div class="container">
    <header class="mb-4">
      <h1>ไอเวอไท้สอง</h1>
    </header>

    <div class="tabs mb-4">
      <button
        :class="{ active: activeTab === 'generate' }"
        @click="activeTab = 'generate'"
      >
        1. Background Generator
      </button>
      <button
        :class="{ active: activeTab === 'campaign' }"
        @click="activeTab = 'campaign'"
      >
        2. Create Campaign
      </button>
      <button
        :class="{ active: activeTab === 'editor' }"
        @click="activeTab = 'editor'"
      >
        3. Layer Editor
      </button>
    </div>

    <main>
      <ImageGenerator
        v-if="activeTab === 'generate'"
        @generated="onBackgroundGenerated"
        @proceed="activeTab = 'campaign'"
      />
      <CampaignLayout
        v-if="activeTab === 'campaign'"
        :initialBackgroundUrl="sharedBackgroundUrl"
        @created="onCampaignCreated"
        @proceed="activeTab = 'editor'"
      />
      <LayerEditor
        v-if="activeTab === 'editor'"
        :initialBackground="sharedBackgroundUrl"
        :campaignData="sharedCampaignData"
      />
    </main>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 12px;
  border-bottom: 2px solid var(--border);
  padding-bottom: 12px;
}

.tabs button {
  background: none;
  border: none;
  color: var(--secondary);
  font-weight: 600;
  padding: 8px 16px;
  cursor: pointer;
}

.tabs button.active {
  color: var(--primary);
  border-bottom: 2px solid var(--primary);
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

header h1 {
  margin-bottom: 4px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.secondary {
  color: var(--secondary);
  font-size: 0.9rem;
}
</style>
