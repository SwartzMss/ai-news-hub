import type { PublicData, Page } from "./types";
import { Shell } from "./Shell";

function PasswordField({ id, label, autocomplete, disabled = false }: { id: string; label: string; autocomplete: "current-password" | "new-password"; disabled?: boolean }) {
  return <div className="account-field">
    <label htmlFor={id}>{label}</label>
    <div className="account-password">
      <input id={id} name={id} type="password" autoComplete={autocomplete} minLength={12} maxLength={128} required aria-invalid="false" disabled={disabled} />
      <button type="button" data-password-toggle={id} aria-controls={id} aria-pressed="false">显示</button>
    </div>
  </div>;
}

function EmailField() {
  return <div className="account-field">
    <label htmlFor="account-email">邮箱地址</label>
    <input id="account-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required aria-invalid="false" />
  </div>;
}

function AuthForm({ kind }: { kind: "login" | "register" | "forgot-password" }) {
  const titles = { login: "登录", register: "创建账户", "forgot-password": "找回密码" };
  const actions = { login: "/api/auth/login", register: "/api/auth/register", "forgot-password": "/api/auth/forgot-password" };
  return <main id="content" className="account-layout account-auth-layout">
    <div className="account-intro"><span>AI News Hub 账户</span><h1>{titles[kind]}</h1>
      <p>{kind === "login" ? "登录后，跨设备查看你保存的文章。" : kind === "register" ? "先收取邮箱验证码，再设置密码，保存值得回看的文章。" : "输入注册邮箱，我们会发送密码重置链接。"}</p></div>
    <div className="account-panel">
    <form className="account-form" data-account-form={kind} method="post" action={actions[kind]}>
      <EmailField />
      {kind === "login" && <PasswordField id="password" label="密码" autocomplete="current-password" />}
      {kind === "register" && <>
        <section data-register-send aria-labelledby="register-send-title">
          <h2 id="register-send-title" className="account-step-title">第 1 步 · 获取验证码</h2>
          <p className="account-help">我们会发送 6 位验证码，有效期 10 分钟；同一邮箱 60 秒内只能发送一次。</p>
          <div className="account-challenge" data-turnstile-host aria-label="人机验证" />
          <button className="account-text-button" type="button" data-register-have-code>已有验证码？输入验证码</button>
        </section>
        <section className="account-verify-step" data-register-verify aria-labelledby="register-verify-title" hidden>
          <h2 id="register-verify-title" className="account-step-title">第 2 步 · 确认邮箱并设置密码</h2>
          <div className="account-field"><label htmlFor="email-code">邮箱验证码</label>
            <p id="email-code-help" className="account-help">请输入邮件中的 6 位数字验证码。</p>
            <input id="email-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} aria-describedby="email-code-help" required disabled />
          </div>
          <PasswordField id="password" label="设置密码" autocomplete="new-password" disabled />
          <PasswordField id="confirm-password" label="确认密码" autocomplete="new-password" disabled />
          <p className="account-help">密码需为 12–128 个字符。</p>
          <div className="account-verify-actions">
            <button className="account-text-button" type="button" data-register-resend>重新发送验证码</button>
            <button className="account-text-button" type="button" data-register-back>修改邮箱</button>
          </div>
        </section>
      </>}
      {kind === "forgot-password" && <div className="account-challenge" data-turnstile-host aria-label="人机验证" />}
      {kind === "login" && <div className="account-challenge" data-turnstile-host hidden aria-label="人机验证" />}
      <p className="account-status" data-account-status role="status" aria-live="polite" />
      <button className="account-primary" type="submit">{kind === "login" ? "登录账户" : kind === "register" ? "发送验证码" : "发送重置邮件"}</button>
    </form>
    <nav className="account-switch" aria-label="账户操作">
      {kind !== "login" && <a href="/account/login/" data-preserve-return>已有账户？登录</a>}
      {kind !== "register" && <a href="/account/register/" data-preserve-return>创建账户</a>}
      {kind !== "forgot-password" && <a href="/account/forgot-password/">忘记密码</a>}
    </nav>
    </div>
  </main>;
}

function AccountHome() {
  return <main id="content" className="account-layout account-auth-layout" data-account-home>
    <div className="account-intro"><span>AI News Hub 账户</span><h1>我的账户</h1><p>在这里查看账户和已保存的文章。</p></div>
    <div className="account-panel">
    <div className="account-guest" data-account-guest hidden>
      <h2>继续阅读，从这里开始</h2>
      <p>登录后，你保存的文章会留在自己的收藏里，换设备也能继续查看。</p>
      <a className="account-guest-primary" href="/account/login/?return=%2Faccount%2F">登录账户</a>
      <a className="account-guest-secondary" href="/account/register/">创建账户</a>
    </div>
    <p className="account-status" data-account-status role="status" aria-live="polite">正在确认登录状态…</p>
    <div className="account-profile" data-account-profile hidden><span>登录邮箱</span><strong data-account-email /></div>
    <div className="account-links" data-account-links hidden><a href="/account/favorites/">查看我的收藏</a><button type="button" data-account-logout>退出登录</button></div>
    <div className="account-data-tools" data-account-tools hidden>
      <section aria-labelledby="account-export-title">
        <h2 id="account-export-title">导出我的数据</h2>
        <p>下载账户资料、收藏快照和分类。文件包含私人内容，请妥善保存。</p>
        <form data-account-export aria-labelledby="account-export-title" action="/api/auth/export-data" method="post">
          <div className="account-field"><label htmlFor="export-password">当前密码</label><input id="export-password" name="password" type="password" autoComplete="current-password" minLength={12} maxLength={128} required /></div>
          <p data-account-export-status role="status" aria-live="polite" />
          <button type="submit">下载数据文件</button>
        </form>
      </section>
    </div>
    </div>
  </main>;
}

function FavoritesHome() {
  return <main id="content" className="account-layout favorites-layout" data-favorites-page>
    <div className="account-intro"><span>私人阅读架</span><h1>我的收藏</h1><p>保存时的文章内容会留在这里，即使原日报不再展示。</p></div>
    <p className="account-status" data-favorites-status role="status" aria-live="polite">正在确认登录状态…</p>
    <section data-favorites-list-view hidden>
      <search><form className="favorites-filters" action="/account/favorites/" method="get" data-favorites-filter>
        <div className="account-field"><label htmlFor="favorites-query">搜索收藏</label><input id="favorites-query" name="q" type="search" maxLength={100} placeholder="标题或来源" /></div>
        <div className="account-field"><label htmlFor="favorites-category">分类</label><select id="favorites-category" name="category"><option value="all">全部收藏</option><option value="none">未分类</option></select></div>
        <div className="account-field"><label htmlFor="favorites-sort">排序</label><select id="favorites-sort" name="sort"><option value="newest">最近收藏</option><option value="oldest">最早收藏</option></select></div>
        <button type="submit">筛选</button>
      </form></search>
      <div data-favorites-list className="favorites-list" />
      <button type="button" className="favorites-more" data-favorites-more hidden>加载更多收藏</button>
    </section>
    <section data-favorite-detail hidden><a href="/account/favorites/">返回收藏列表</a><div data-favorite-detail-content /></section>
    <section className="favorite-categories" data-categories-panel hidden>
      <h2>管理分类</h2><p>分类只对你可见。删除分类后，文章会回到未分类。</p>
      <form data-category-create action="/api/favorite-categories" method="post" className="category-create">
        <div className="account-field"><label htmlFor="category-new-name">新分类名称</label><input id="category-new-name" name="name" maxLength={50} required /></div>
        <button type="submit">创建分类</button>
      </form>
      <p data-category-status role="status" aria-live="polite" />
      <div data-category-list className="category-list" />
    </section>
  </main>;
}

export function AccountPage({ data, page }: { data: PublicData; page: Page }) {
  return <Shell data={data} active={page.kind === "favorites" ? "favorites" : "none"} page="account">
    {page.kind === "login" || page.kind === "register" || page.kind === "forgot-password"
      ? <AuthForm kind={page.kind} />
      : page.kind === "account" ? <AccountHome /> : <FavoritesHome />}
  </Shell>;
}
