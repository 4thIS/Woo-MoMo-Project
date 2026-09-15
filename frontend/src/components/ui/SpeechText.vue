<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{ text: string; typing?: boolean; size?: 'md' | 'lg'; cursor?: boolean }>(),
  {
    typing: true,
    size: 'md',
    cursor: false,
  },
)
const emit = defineEmits<{ done: [] }>()

const shown = ref('')
const busy = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function stop() {
  if (timer) clearTimeout(timer)
  timer = null
  busy.value = false
}

function run(text: string) {
  stop()
  if (!props.typing || reduced()) {
    shown.value = text
    emit('done')
    return
  }
  shown.value = ''
  busy.value = true
  let i = 0
  const step = () => {
    if (i >= text.length) {
      stop()
      emit('done')
      return
    }
    const ch = text[i++]
    shown.value += ch
    if (i >= text.length) {
      stop()
      emit('done')
      return
    }
    timer = setTimeout(step, /[.,?!]/.test(ch) ? 150 : 30)
  }
  timer = setTimeout(step, 30)
}

watch(() => props.text, run, { immediate: true })
onBeforeUnmount(stop)
</script>

<template>
  <p class="speech" :class="size">{{ shown }}<span v-if="cursor && busy" class="caret blink" /></p>
</template>

<style scoped>
.speech {
  margin: 0;
  line-height: 1.75;
  color: var(--text);
  white-space: pre-wrap;
}
.md {
  font-size: var(--fs-body-md);
}
.lg {
  font-size: var(--fs-body-lg);
  line-height: 1.6;
}
.caret {
  display: inline-block;
  width: 12px;
  height: 0.9em;
  background: var(--accent);
  vertical-align: -0.1em;
  margin-left: var(--sp-1);
}
</style>
