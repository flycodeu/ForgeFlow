import { createApp } from 'vue';
import App from './App.vue';

async function start() {
  const bootstrap = new URLSearchParams(location.hash.slice(1)).get('desktop-token');
  if (bootstrap) {
    history.replaceState(null, '', location.pathname + location.search);
    const response = await fetch('/api/runtime/session', { method: 'POST', headers: { 'X-ForgeFlow-Desktop': bootstrap } });
    if (!response.ok) throw new Error('桌面连接失败，请从托盘重新打开');
  }
  createApp(App).mount('#app');
}
start().catch((error: unknown) => {
  const root = document.querySelector('#app');
  if (root) root.textContent = error instanceof Error ? error.message : '应用启动失败';
});
