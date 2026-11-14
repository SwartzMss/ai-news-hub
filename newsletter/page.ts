export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export type NewsletterPageState = 'confirm' | 'unsubscribe' | 'success' | 'unsubscribed' | 'notice' | 'error';
interface PageOptions {
  title: string;
  message: string;
  nonce: string;
  status: number;
  state: NewsletterPageState;
  form?: {action: string; token: string};
}

const css = `
:root{color-scheme:light;--paper:#fff;--bg:#f5f7f6;--ink:#20282b;--muted:#59656b;--line:#e2e8e5;--accent:#087660;--tint:#edf5f2;font-family:"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;font-synthesis:none}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);min-height:100svh}a{color:inherit;text-decoration:none}a:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:5px}
.masthead{height:80px;max-width:1120px;margin:auto;padding:0 32px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:inline-flex;align-items:center;gap:11px;font-size:18px;font-weight:750;letter-spacing:-.5px}.brand-mark{position:relative;display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--accent);color:#fff;font:700 25px Georgia,serif}.brand-mark:after{content:"";position:absolute;top:6px;right:6px;width:5px;height:5px;border-radius:50%;background:#b9e8c8}.secondary:hover{text-decoration:underline;text-underline-offset:4px}
main{display:grid;place-items:start center;padding:clamp(40px,10vh,100px) 24px 64px}.panel{width:100%;max-width:520px;padding:44px 44px 36px;background:var(--paper);border:1px solid var(--line);border-radius:18px;box-shadow:0 12px 40px #20382c06}.status-icon{display:grid;place-items:center;width:56px;height:56px;margin-bottom:28px;border-radius:16px;background:var(--tint);color:var(--accent)}.status-icon svg{width:28px;height:28px}.unsubscribe .status-icon,.unsubscribed .status-icon{background:var(--bg);color:var(--muted)}.error .status-icon{background:#fff3e9;color:#9b5c28}
h1{margin:0 0 16px;font-size:30px;line-height:1.35;letter-spacing:-1px;font-weight:750}p{margin:0;color:var(--muted);font-size:15px;line-height:1.9;overflow-wrap:anywhere}.actions{margin-top:32px}form{margin:0}.primary{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;padding:12px 20px;background:var(--accent);color:#fff;border:1px solid transparent;border-radius:8px;font-family:inherit;font-size:15px;font-weight:650;line-height:1.5;cursor:pointer;text-align:center}.primary:hover{background:#06624f}.unsubscribe .primary{background:var(--ink)}.unsubscribe .primary:hover{background:#354047}.secondary{display:block;width:fit-content;margin:20px auto 0;font-size:13px;line-height:1.7;color:var(--muted)}
@media(max-width:560px){.masthead{height:72px;padding:0 20px}.brand{font-size:17px}main{padding:32px 16px 40px}.panel{padding:32px 26px 28px;border-radius:14px}h1{font-size:27px}.status-icon{margin-bottom:24px}.actions{margin-top:28px}}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--paper:#16221d;--bg:#101a16;--ink:#e6eee9;--muted:#a5b6ad;--line:#2b3c33;--accent:#8bd1b4;--tint:#233e32}.brand-mark,.primary{background:#087660;color:#fff}.primary:hover{background:#096e59}.unsubscribe .primary{background:#dce8e1;color:#16221d}.unsubscribe .primary:hover{background:#c9dbd0}.error .status-icon{background:#392c20;color:#edbb88}}
`;

const icons = {
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
  success: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3h.01"/>',
  unsubscribe: '<path d="M9 5H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h3m6-11 4 4-4 4m-5-4h11"/>',
};

export function renderNewsletterPage(options: PageOptions): string {
  const {title,message,nonce,form,state,status} = options;
  const icon = state === 'error' ? icons.error : state === 'success' ? icons.success : state === 'unsubscribe' || state === 'unsubscribed' ? icons.unsubscribe : icons.mail;
  const retry = state === 'error' && status < 500;
  const action = form
    ? `<form method="post" action="${escapeHtml(form.action)}"><input type="hidden" name="token" value="${escapeHtml(form.token)}"><button class="primary" type="submit">${escapeHtml(title)}</button></form><a class="secondary" href="/">${state === 'unsubscribe' ? '保留订阅，返回首页' : '暂不订阅，返回首页'}</a>`
    : `<a class="primary" href="${retry ? '/#newsletter-dialog' : '/'}">${retry ? '重新订阅' : state === 'success' ? '开始阅读' : '返回首页'}</a>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · AI News Hub</title><style nonce="${escapeHtml(nonce)}">${css}</style></head><body><header class="masthead"><a class="brand" href="/" aria-label="AI News Hub 首页"><span class="brand-mark" aria-hidden="true">N</span>AI News Hub</a></header><main><section class="panel ${state}" aria-labelledby="page-title"><div class="status-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></div><h1 id="page-title">${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><div class="actions">${action}</div></section></main></body></html>`;
}
