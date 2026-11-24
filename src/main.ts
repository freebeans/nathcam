import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import App from './ui/App.svelte';
import './ui/global.css';

mount(App, { target: document.getElementById('app')! });

// A versão nova do app é baixada em segundo plano e fica em espera; só passa a
// valer numa abertura a frio. Nunca recarrega a página no meio de uma edição.
registerSW({ immediate: true });

// Pede armazenamento persistente, sem contar com isso (ver PRD, "Dados").
void navigator.storage?.persist?.().catch(() => false);
