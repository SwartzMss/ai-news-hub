export function Newsletter() {
  return (
    <section id="newsletter-signup" className="newsletter" aria-labelledby="newsletter-title">
      <div>
        <h2 id="newsletter-title">订阅每日汇总</h2>
        <p id="newsletter-note">每天一封，汇总全部话题。确认邮箱后开始订阅，可随时退订。</p>
      </div>
      <form action="/api/newsletter/subscribe" method="post" data-newsletter-form>
        <div className="newsletter-fields">
          <label className="newsletter-email">
            <span>邮箱</span>
            <input type="email" name="email" required autoComplete="email" maxLength={254} aria-describedby="newsletter-note" placeholder="you@example.com" />
          </label>
          <label className="newsletter-honeypot" aria-hidden="true">
            网站
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
          <button type="submit">订阅每日汇总</button>
        </div>
        <p role="status" aria-live="polite" data-newsletter-status />
      </form>
    </section>
  );
}
