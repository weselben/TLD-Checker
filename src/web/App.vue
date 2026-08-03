<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import CheckForm from './components/CheckForm.vue';
import ResultList, { type ResultItem } from './components/ResultList.vue';
import { runCheck } from './lib/checker';
import { TLDS } from './lib/tlds';
import type { LookupStatus } from './lib/types';

const busy = ref(false);
const lastQuery = ref('');
const started = ref(false);
const results = reactive(new Map<string, ResultItem>());

const available = computed(() =>
  [...results.values()].filter((r) => r.status === 'available'),
);
const taken = computed(() => [...results.values()].filter((r) => r.status === 'taken'));
const unknown = computed(() =>
  [...results.values()].filter((r) => r.status === 'unknown'),
);
const done = computed(() => results.size);
const total = computed(() => (started.value ? TLDS.length : 0));

async function onSubmit(baseName: string) {
  results.clear();
  busy.value = true;
  started.value = true;
  lastQuery.value = baseName;
  try {
    await runCheck(baseName, TLDS, {
      onResult: (fqdn: string, status: LookupStatus, source: 'cache' | 'doh') => {
        results.set(fqdn, { fqdn, status, source });
      },
      onComplete: () => {
        busy.value = false;
      },
    });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <header class="navbar">
    <h1 class="navbar__brand">TLD-Checker.net</h1>
    <nav class="navbar__links">
      <span class="navbar__link navbar__link--active">Home</span>
      <a class="navbar__link" href="https://github.com/weselben/TLD-Checker">GitHub</a>
    </nav>
  </header>

  <main class="page">
    <div class="container">
      <CheckForm :busy="busy" @submit="onSubmit" />

      <p v-if="started && busy" class="progress">
        Checking <strong>{{ lastQuery }}</strong> against {{ total }} TLDs —
        {{ done }}/{{ total }} resolved…
      </p>

      <div v-if="started" class="results">
        <ResultList title="Available" :items="available" variant="available" />
        <ResultList title="Not Available" :items="taken" variant="taken" />
      </div>
      <div v-if="started && unknown.length" class="results results--unknown">
        <ResultList title="Unresolved" :items="unknown" variant="unknown" />
      </div>
    </div>
  </main>

  <footer class="footer">
    <p>
      TLD-Checker.net — availability via
      <a href="https://dns.google/resolve">dns.google</a>, cached by the community.
    </p>
  </footer>
</template>
