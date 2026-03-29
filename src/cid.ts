import { cidv0 } from './ipfs';

export async function initCidDisplay(): Promise<void> {
  try {
    const resp = await fetch(location.origin + location.pathname);
    if (!resp.ok) return;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const cid = await cidv0(bytes);
    const el = document.createElement('div');
    el.className = 'cid-badge';
    el.textContent = 'ipfs://' + cid;
    document.body.appendChild(el);
  } catch { /* file:// or no crypto.subtle — skip */ }
}
