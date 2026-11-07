#!/usr/bin/env python3
"""Render the README diagram with Pillow; no runtime/project dependencies.

Run: python3 scripts/render-architecture.py
Optional developer dependency: Pillow 12, DejaVu Sans fonts (Ubuntu fonts-dejavu-core).
Only architecture.gif and architecture.svg are committed; preview PNG lives in /tmp.
"""
from pathlib import Path
from html import escape
from math import hypot
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/assets'
W, H, SCALE = 1000, 750, 2
INK, MUTED, GREEN, LINE = '#17392e', '#6a8176', '#08765b', '#c9dcd2'
FONT = Path('/usr/share/fonts/truetype/dejavu')
NODES = {
    'prompt': (48, 142, 150, 76, 'Topic + input', 'Versioned templates'),
    'backend': (246, 142, 166, 76, 'Backend', 'Fastify / scheduled tasks'),
    'codex': (460, 142, 164, 76, 'Codex', 'Hosted search / stdio'),
    'db': (246, 284, 166, 76, 'SQLite', 'Private state + reports'),
    'review': (460, 284, 164, 76, 'Approval', 'Manual / automatic'),
    'github': (708, 284, 240, 76, 'GitHub archive', 'Versioned report JSON'),
    'web': (708, 142, 240, 76, 'Cloudflare Pages', 'Public Web + RSS'),
    'schedule': (48, 284, 166, 76, 'GitHub Actions', 'Daily 09:30 + retries'),
    'functions': (48, 480, 200, 76, 'Pages Functions', 'Subscribe / confirm / send'),
    'subscribers': (284, 480, 200, 76, 'Cloudflare D1', 'Emails + delivery state'),
    'resend': (520, 480, 200, 76, 'Resend', 'Confirmation + daily digest'),
    'readers': (756, 480, 200, 76, 'Subscribers', 'Inbox + unsubscribe'),
}
STEPS = [
    ('Choose a topic and ordered prompts', 'prompt', 'backend', [(198, 180), (246, 180)]),
    ('Research sources in the same Thread', 'backend', 'codex', [(412, 170), (460, 170)]),
    ('The final prompt returns a structured daily report', 'codex', 'backend', [(460, 192), (412, 192)]),
    ('Validate structure and persist the report', 'backend', 'db', [(329, 218), (329, 284)]),
    ('Approve manually or by configured task policy', 'db', 'review', [(412, 322), (460, 322)]),
    ('Archive approved JSON, idempotently', 'review', 'github', [(624, 322), (708, 322)]),
    ('Build public reading pages and RSS', 'github', 'web', [(828, 284), (828, 218)]),
    ('Trigger the daily aggregate and bounded retries', 'schedule', 'functions', [(48, 322), (20, 322), (20, 518), (48, 518)]),
    ('Read the published reports for every selected topic', 'web', 'functions', [(948, 180), (984, 180), (984, 460), (148, 460), (148, 480)]),
    ('Store confirmations and daily delivery state', 'functions', 'subscribers', [(248, 508), (284, 508)]),
    ('Load confirmed subscribers and delivery records', 'subscribers', 'functions', [(284, 530), (248, 530)]),
    ('Send confirmation emails and the daily aggregate', 'functions', 'resend', [(148, 556), (148, 602), (620, 602), (620, 556)]),
    ('Deliver one daily aggregate per confirmed reader', 'resend', 'readers', [(720, 518), (756, 518)]),
]



class Canvas:
    def __init__(self):
        self.image = Image.new('RGB', (W*SCALE, H*SCALE), '#f6f9f7')
        self.draw = ImageDraw.Draw(self.image)
        self.svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="title desc">',
                    '<title id="title">AI News Hub architecture</title>',
                    '<desc id="desc">Versioned prompts and scheduled tasks drive Codex hosted web search via a private systemd-managed Linux Backend. Structured reports are stored in SQLite and approved manually or by configured policy before GitHub archiving. Cloudflare Pages builds the public website and RSS. GitHub Actions triggers a daily aggregate. Pages Functions reads published reports, stores subscriber confirmations and delivery state in private Cloudflare D1, and sends confirmation emails and daily aggregates through Resend to confirmed subscribers.</desc>',
                    '<rect width="100%" height="100%" fill="#f6f9f7"/>']

    def box(self, x, y, w, h, fill, stroke=LINE, radius=12, width=1):
        self.draw.rounded_rectangle(tuple(round(v*SCALE) for v in (x, y, x+w, y+h)), radius=radius*SCALE, fill=fill, outline=stroke, width=width*SCALE)
        self.svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="{width}"/>')

    def text(self, x, y, value, size=12, fill=INK, bold=False):
        font = ImageFont.truetype(str(FONT / ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')), round(size*SCALE))
        self.draw.text((round(x*SCALE), round(y*SCALE)), value, font=font, fill=fill, anchor='lt')
        self.svg.append(f'<text x="{x}" y="{y+size*.85}" font-family="DejaVu Sans,Arial,sans-serif" font-size="{size}" font-weight="{700 if bold else 400}" fill="{fill}">{escape(value)}</text>')

    def line(self, points, fill=LINE, width=2, arrow=False):
        self.draw.line([(round(x*SCALE), round(y*SCALE)) for x, y in points], fill=fill, width=width*SCALE, joint='curve')
        self.svg.append(f'<polyline points="{" ".join(f"{x},{y}" for x,y in points)}" fill="none" stroke="{fill}" stroke-width="{width}"/>')
        if arrow:
            (ax, ay), (bx, by) = points[-2:]
            length = hypot(bx-ax, by-ay)
            ux, uy = (bx-ax)/length, (by-ay)/length
            wings = [(bx-ux*6-uy*3, by-uy*6+ux*3), (bx, by), (bx-ux*6+uy*3, by-uy*6-ux*3)]
            self.line(wings, fill, width)

    def dot(self, x, y):
        self.draw.ellipse(tuple(round(v*SCALE) for v in (x-4, y-4, x+4, y+4)), fill=GREEN)


def frame(stage=None, progress=0):
    c = Canvas()
    c.text(30, 21, 'AI News Hub', 25, bold=True)
    c.text(31, 57, 'Research, publish and deliver a daily digest.', 12, MUTED)
    c.text(671, 30, 'Task → Run → Thread → Turn', 12, GREEN, True)
    c.box(226, 92, 424, 298, '#edf5f0', '#d6e6dc', 17)
    c.box(682, 92, 294, 298, '#f0f4ed', '#d6e6dc', 17)
    c.box(28, 410, 948, 228, '#edf5f0', '#d6e6dc', 17)
    c.text(246, 108, 'LINUX BACKEND / PRIVATE', 10, GREEN, True)
    c.text(48, 108, 'USER INPUT', 10, GREEN, True)
    c.text(700, 108, 'ARCHIVE / PUBLIC OUTPUT', 10, GREEN, True)
    for i, (_, _a, _b, path) in enumerate(STEPS):
        c.line(path, GREEN if stage == i else '#b4c9be', 2, True)
    for key, (x, y, w, h, title, subtitle) in NODES.items():
        focused = stage is not None and key in STEPS[stage][1:3]
        c.box(x, y, w, h, '#dff1e7' if focused else '#ffffff', GREEN if focused else '#cfdfd5', 11, 2 if focused else 1)
        c.text(x+15, y+18, title, 15, INK, True)
        c.text(x+15, y+46, subtitle, 10, MUTED)
    c.text(48, 261, 'EMAIL SCHEDULE', 10, GREEN, True)
    c.text(246, 368, 'systemd service + persistent task schedules', 9, MUTED)
    c.text(48, 428, 'EMAIL SUBSCRIPTION / CLOUDFLARE + RESEND', 10, GREEN, True)
    c.text(284, 578, 'Pages Functions dispatches through Resend', 10, MUTED)
    c.text(48, 617, 'Private D1 stores subscriber data. Email delivery requires production configuration.', 10, MUTED)
    c.text(36, 682, 'PIPELINE', 9, MUTED, True)
    for i in range(len(STEPS)):
        c.box(36+i*14, 706, 10, 4, GREEN if stage == i else '#c9dbd1', GREEN if stage == i else '#c9dbd1', 2)
    caption = f'{stage+1:02d}  {STEPS[stage][0]}' if stage is not None else 'Research → approved archive → public Web, RSS and email.'
    c.text(240, 681, caption, 13, GREEN, True)
    c.text(240, 709, 'Private research state and subscriber data stay in their own databases.', 10, MUTED)
    if stage is not None:
        path = STEPS[stage][3]
        distance = progress * sum(hypot(b[0]-a[0], b[1]-a[1]) for a, b in zip(path, path[1:]))
        for a, b in zip(path, path[1:]):
            length = hypot(b[0]-a[0], b[1]-a[1])
            if distance <= length:
                c.dot(a[0]+(b[0]-a[0])*distance/length, a[1]+(b[1]-a[1])*distance/length)
                break
            distance -= length
    else:
        # SVG animates without scripts. GIF remains the README-compatible preview.
        cycle = len(STEPS) * 1.12 + 1.8
        active = 1.12 / cycle
        c.svg.append('<style>@media (prefers-reduced-motion: reduce) {.flow-dot {display:none}}</style>')
        for i, (_, _, _, path) in enumerate(STEPS):
            route = 'M ' + ' L '.join(f'{x},{y}' for x, y in path)
            c.svg.append(f'<circle class="flow-dot" r="4" fill="{GREEN}" opacity="0">'
                         f'<animateMotion path="{route}" dur="{cycle:.2f}s" begin="{i*1.12:.2f}s" repeatCount="indefinite" keyTimes="0;{active:.5f};1" keyPoints="0;1;1" calcMode="linear"/>'
                         f'<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;{active:.5f};{active+.001:.5f};1" dur="{cycle:.2f}s" begin="{i*1.12:.2f}s" repeatCount="indefinite"/>'
                         '</circle>')
    c.svg.append('</svg>')
    return c.image.resize((W, H), Image.Resampling.LANCZOS), '\n'.join(c.svg)+'\n'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    static, svg = frame()
    (OUT/'architecture.svg').write_text(svg)
    static.save('/tmp/ai-news-hub-architecture-preview.png')
    frames, durations = [], []
    for stage in range(len(STEPS)):
        for step in range(8):
            image, _ = frame(stage, step/7)
            frames.append(image)
            durations.append(140)
    frames.append(static)
    durations.append(1800)
    palette = static.quantize(colors=96, method=Image.Quantize.MEDIANCUT)
    frames = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
    target = OUT/'architecture.gif'
    frames[0].save(target, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True, disposal=1)
    with Image.open(target) as gif:
        total = sum(gif.seek(i) or gif.info.get('duration', 0) for i in range(gif.n_frames))
        print(f'{target.relative_to(ROOT)}: {gif.size}, {gif.n_frames} frames, {total/1000:.2f}s, {target.stat().st_size} bytes')


if __name__ == '__main__':
    main()
