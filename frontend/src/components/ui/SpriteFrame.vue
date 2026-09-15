<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    src: string
    frameW: number
    frameH: number
    frames: number
    scale: number
    index?: number
    fps?: number
  }>(),
  { index: 0, fps: 0 },
)
const cur = ref(props.index)
let timer: ReturnType<typeof setInterval> | null = null

function restart() {
  if (timer) clearInterval(timer)
  timer = null
  cur.value = props.index
  if (props.fps > 0 && props.frames > 1) {
    // 0번은 기본 자세, 1..N-1 루프 (스프라이트 규칙)
    timer = setInterval(() => (cur.value = 1 + (cur.value % (props.frames - 1))), 1000 / props.fps)
  }
}
watch(() => [props.src, props.fps, props.index], restart, { immediate: true })
onBeforeUnmount(() => timer && clearInterval(timer))

const style = computed(() => ({
  width: `${props.frameW * props.scale}px`,
  height: `${props.frameH * props.scale}px`,
  backgroundImage: `url(${props.src})`,
  backgroundSize: `${props.frameW * props.frames * props.scale}px ${props.frameH * props.scale}px`,
  backgroundPosition: `-${cur.value * props.frameW * props.scale}px 0`,
}))
</script>

<template>
  <div class="px sprite" :style="style" aria-hidden="true" />
</template>

<style scoped>
.sprite {
  background-repeat: no-repeat;
  flex-shrink: 0;
}
</style>
