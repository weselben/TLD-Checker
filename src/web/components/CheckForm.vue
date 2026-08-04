<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  (e: 'submit', baseName: string): void;
}>();

const props = defineProps<{
  busy: boolean;
}>();

const domainname = ref('');

function sanitize(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '');
}

function onSubmit() {
  const name = sanitize(domainname.value);
  if (!name || props.busy) return;
  emit('submit', name);
}
</script>

<template>
  <form class="check-form" @submit.prevent="onSubmit">
    <input
      v-model="domainname"
      class="check-form__input"
      type="text"
      name="domainname"
      placeholder="Domainname"
      required
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      :disabled="busy"
    />
    <button class="check-form__button" type="submit" name="submit" :disabled="busy">
      {{ busy ? 'Checking…' : 'Check!' }}
    </button>
  </form>
</template>
