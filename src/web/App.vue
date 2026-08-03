<script setup lang="ts">
import { computed, ref } from 'vue';
import { TLDS } from './tlds';
import type { DomainStatus } from '../shared/status';

// The SPA keeps the legacy flow: the browser checks dns.google directly for
// every TLD, then reports results back to the worker with challenge tokens.
// The worker's /api/* endpoints are only for the consensus cache + voting.

interface ResultEntry {
  fqdn: string;
  status: DomainStatus;
  fromCache: boolean;
}

const query = ref('');
const running = ref(false);
const progress = ref({ done: 0, total: 0 });
const available = ref<ResultEntry[]>([]);
const taken = ref<ResultEntry[]>([]);
const error = ref('');

const CACHE_CHUNK = 50;
const CONCURRENCY = 8;

const baseName = computed(() => query.value.trim().toLowerCase().replace(/\.+$/, ''));

async function run(): Promise<void> {
  error.value = '';
  available.value = [];
  taken.value = [];
  const base = baseName.value;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(base)) {
    error.value = 'Enter a valid domain name (letters, digits, hyphens).';
    return;
  }
  const fqdns = TLDS.map((tld) => `${base}.${tld}`);
  running.value = true;
  progress.value = { done: 0, total: fqdns.length };
  try {
    // 1. Seed from the consensus cache so we only pay DoH lookups for unknowns.
    const cached = await loadCache(fqdns);
    const remaining: string[] = [];
    for (const fqdn of fqdns) {
      const hit = cached[fqdn];
      if (hit) pushResult({ fqdn, status: hit, fromCache: true });
      else remaining.push(fqdn);
    }

    // 2. Challenge tokens cover every fqdn we are about to check ourselves.
    const tokens = await loadTokens(remaining);

    // 3. Browser-side DoH sweep, then report each result back for voting.
    await mapWithConcurrency(remaining, CONCURRENCY, async (fqdn) => {
      const status = await dohStatus(fqdn);
      if (status) {
        pushResult({ fqdn, status, fromCache: false });
        const tok = tokens[fqdn];
        if (tok) void report({ fqdn, status, token: tok.token, ts: tok.ts });
      }
      progress.value.done++;
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'lookup failed';
  } finally {
    running.value = false;
  }
}

function pushResult(entry: ResultEntry): void {
  (entry.status === 'available' ? available : taken).value.push(entry);
}

async function loadCache(fqdns: string[]): Promise<Record<string, DomainStatus>> {
  const out: Record<string, DomainStatus> = {};
  for (let i = 0; i < fqdns.length; i += CACHE_CHUNK) {
    const chunk = fqdns.slice(i, i + CACHE_CHUNK);
    const res = await fetch(`/api/check?fqdns=${chunk.join(',')}`);
    if (!res.ok) throw new Error(`cache check failed: ${res.status}`);
    const body = (await res.json()) as { cached: Record<string, DomainStatus> };
    Object.assign(out, body.cached);
  }
  return out;
}

interface TokenEntry {
  token: string;
  ts: number;
}

async function loadTokens(fqdns: string[]): Promise<Record<string, TokenEntry>> {
  const out: Record<string, TokenEntry> = {};
  for (let i = 0; i < fqdns.length; i += 50) {
    const chunk = fqdns.slice(i, i + 50);
    const res = await fetch('/api/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fqdns: chunk }),
    });
    if (!res.ok) continue; // voting is best-effort; never block the lookup itself
    const body = (await res.json()) as { tokens: Record<string, TokenEntry> };
    Object.assign(out, body.tokens);
  }
  return out;
}

async function dohStatus(fqdn: string): Promise<DomainStatus | null> {
  const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(fqdn)}&type=A`);
  const body = (await res.json()) as { Status?: number };
  if (body.Status === 0) return 'taken';
  if (body.Status === 3) return 'available';
  return null;
}

async function report(result: {
  fqdn: string;
  status: DomainStatus;
  token: string;
  ts: number;
}): Promise<void> {
  await fetch('/api/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ results: [result] }),
  }).catch(() => undefined);
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  });
  await Promise.all(workers);
}
</script>

<template>
  <header class="nav">TLD-Checker.net</header>

  <main class="container">
    <form class="search" @submit.prevent="run">
      <input v-model="query" type="text" placeholder="Domainname" required :disabled="running" />
      <button type="submit" :disabled="running">
        {{ running ? `${progress.done}/${progress.total}` : 'Check!' }}
      </button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="available.length || taken.length" class="results">
      <section>
        <h2>Available</h2>
        <ul>
          <li v-for="r in available" :key="r.fqdn">
            ✔️ {{ r.fqdn }} <em v-if="r.fromCache">(cached)</em>
          </li>
        </ul>
      </section>
      <section>
        <h2>Not Available</h2>
        <ul>
          <li v-for="r in taken" :key="r.fqdn">❌ {{ r.fqdn }}</li>
        </ul>
      </section>
    </div>
  </main>

  <footer class="footer">
    <p>
      <a href="https://github.com/weselben/TLD-Checker">GitHub</a> ·
      <a href="https://github.com/weselben/TLD-Checker/issues">Issues</a> ·
      Copyright © 2020-{{ new Date().getFullYear() }} weselben
    </p>
  </footer>
</template>
