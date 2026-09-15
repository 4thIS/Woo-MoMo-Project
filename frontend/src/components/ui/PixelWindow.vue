<script setup lang="ts">
withDefaults(defineProps<{ title?: string; padding?: 'md' | 'sm' }>(), {
  title: undefined,
  padding: 'md',
})
</script>

<template>
  <section class="win" :class="`pad-${padding}`">
    <slot name="header">
      <header v-if="title || $slots.tag" class="head">
        <h2 v-if="title" class="display title">{{ title }}</h2>
        <slot name="tag" />
      </header>
    </slot>
    <slot />
  </section>
</template>

<style scoped>
.win {
  background: var(--win);
  border: var(--win-border);
  box-shadow: var(--win-inner);
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}
.pad-md {
  padding: var(--sp-6) var(--sp-8);
}
.pad-sm {
  padding: 22px 28px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
}
.title {
  margin: 0;
  font-size: var(--fs-h2);
  line-height: 1.4;
}
</style>
