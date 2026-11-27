import { registerSW } from 'virtual:pwa-register';

/**
 * Atualização do app (ver PRD, "Stack, deploy e atualização").
 *
 * A versão nova é baixada em segundo plano e fica em espera. Ela entra sozinha
 * quando nenhuma janela do app está aberta, mas no iOS fechar a PWA pelo
 * multitarefa nem sempre encerra o processo, e a espera pode não acabar nunca.
 * Por isso a interface oferece "Atualizar" na biblioteca (nunca no editor),
 * que ativa a versão em espera e recarrega.
 */
class AppUpdate {
  /** Há uma versão nova baixada, esperando para entrar. */
  ready = $state(false);
  private apply: ((reload?: boolean) => Promise<void>) | null = null;

  start(): void {
    this.apply = registerSW({
      immediate: true,
      onNeedRefresh: () => (this.ready = true),
      onRegisteredSW: (_url, reg) => {
        if (!reg) return;
        // O iOS raramente procura versão nova sozinho: procura ao voltar ao app.
        const check = () => document.visibilityState === 'visible' && navigator.onLine && void reg.update().catch(() => {});
        document.addEventListener('visibilitychange', check);
      },
    });
  }

  /** Ativa a versão em espera e recarrega. Só chamar fora do editor. */
  async install(): Promise<void> {
    await this.apply?.(true);
  }
}

export const appUpdate = new AppUpdate();
