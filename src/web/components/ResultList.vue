<script setup lang="ts">
import type { LookupStatus } from '../lib/types';

export interface ResultItem {
  fqdn: string;
  status: LookupStatus;
  source: 'cache' | 'doh';
}

defineProps<{
  title: string;
  items: ResultItem[];
  variant: 'available' | 'taken' | 'unknown';
}>();
</script>

<template>
  <section class="result-list" :class="`result-list--${variant}`">
    <h2 class="result-list__title">{{ title }} <span class="result-list__count">({{ items.length }})</span></h2>
    <ul class="result-list__items">
      <li v-for="item in items" :key="item.fqdn" class="result-list__item">
        <span class="result-list__mark" aria-hidden="true">
          {{ variant === 'available' ? '✔️' : variant === 'taken' ? '❌' : '⏳' }}
        </span>
        <span class="result-list__fqdn">{{ item.fqdn }}</span>
        <span v-if="item.source === 'cache'" class="result-list__badge">cached</span>
      </li>
    </ul>
  </section>
</template>
