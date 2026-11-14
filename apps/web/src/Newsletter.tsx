export function Newsletter() {
  return (
    <dialog
      id="newsletter-dialog"
      className="newsletter-dialog"
      aria-labelledby="newsletter-title"
    >
      <div className="newsletter-dialog-header">
        <div>
          <h2 id="newsletter-title">订阅每日汇总</h2>
          <p id="newsletter-note">
            每天一封，汇总全部话题。确认邮箱后开始订阅，可随时退订。
          </p>
        </div>
        <button
          className="newsletter-close"
          type="button"
          data-newsletter-close
          aria-label="关闭订阅窗口"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18"/>
          </svg>
        </button>
      </div>
      <form action="/api/newsletter/subscribe" method="post" data-newsletter-form>
        <div className="newsletter-fields">
          <label className="newsletter-email">
            <span>邮箱</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              maxLength={254}
              aria-describedby="newsletter-note"
              placeholder="you@gmail.com"
            />
          </label>
          <label className="newsletter-honeypot" aria-hidden="true">
            网站
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
          <button type="submit">订阅每日汇总</button>
        </div>
        <p role="status" aria-live="polite" data-newsletter-status />
      </form>
    </dialog>
  );
}
