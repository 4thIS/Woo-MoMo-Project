<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 가로 한 줄 스프라이트 시트 재생기.
 * - loop(기본): 0 → N-1 순환
 * - loop=false: 0 → N-1 한 번 재생하고 마지막 프레임에 멈춘 뒤 `done` emit (1회성 동작은 마지막 프레임이 기본 자세)
 * src가 바뀌면 처음부터 다시 시작한다.
 */
const props = withDefaults(
  defineProps<{
    src: string
    frameW: number
    frameH: number
    frames: number
    scale: number
    index?: number
    fps?: number
    loop?: boolean
  }>(),
  { index: 0, fps: 0, loop: true },
)
const emit = defineEmits<{ done: [] }>()
const cur = ref(props.index)
let timer: ReturnType<typeof setInterval> | null = null

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}
function restart() {
  stop()
  cur.value = props.index
  if (props.fps <= 0 || props.frames <= 1) return
  timer = setInterval(() => {
    const next = cur.value + 1
    if (next < props.frames) {
      cur.value = next
      return
    }
    if (props.loop) {
      cur.value = 0
      return
    }
    stop()
    emit('done')
  }, 1000 / props.fps)
}
watch(() => [props.src, props.fps, props.index, props.loop], restart, { immediate: true })
onBeforeUnmount(stop)

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
