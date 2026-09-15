<script setup lang="ts">
import SpriteFrame from './SpriteFrame.vue'
withDefaults(defineProps<{ src: string; frames: number; frameW?: number; frameH?: number }>(), {
  frameW: 32,
  frameH: 32,
})
</script>

<template>
  <div class="avatar">
    <SpriteFrame :src="src" :frame-w="frameW" :frame-h="frameH" :frames="frames" :scale="2" />
  </div>
</template>

<style scoped>
.avatar {
  width: 96px;
  height: 96px;
  background: var(--raise);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
</style>
