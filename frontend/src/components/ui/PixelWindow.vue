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
  background-color: var(--win);
  /* 주사선: 패널을 '화면'처럼 보이게 하는 유일한 장식. 가상요소를 쓰지 않아
     안쪽의 absolute 배치나 z-index를 건드리지 않는다 */
  background-image: repeating-linear-gradient(transparent 0 2px, var(--scan) 2px 4px);
  border: var(--win-border);
  box-shadow: var(--win-shadow);
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
/* 휴대폰: 좌우 28~32px은 390px 화면에서 내용 폭을 1/6이나 먹는다 (멘토링 2026-10-12) */
@media (max-width: 640px) {
  .pad-md {
    padding: var(--sp-5) var(--sp-4);
  }
  .pad-sm {
    padding: var(--sp-4);
  }
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
