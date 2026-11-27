import { mount } from 'svelte';
import { appUpdate } from './app/update.svelte';
import App from './ui/App.svelte';
import './ui/global.css';

mount(App, { target: document.getElementById('app')! });

// A versão nova do app é baixada em segundo plano e fica em espera; entra numa
// abertura a frio ou pelo "Atualizar" da biblioteca, nunca no meio de uma edição.
appUpdate.start();

// Pede armazenamento persistente, sem contar com isso (ver PRD, "Dados").
void navigator.storage?.persist?.().catch(() => false);
