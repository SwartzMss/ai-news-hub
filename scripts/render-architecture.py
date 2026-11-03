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
W, H, SCALE = 1000, 480, 2
INK, MUTED, GREEN, LINE = '#17392e', '#6a8176', '#08765b', '#c9dcd2'
FONT = Path('/usr/share/fonts/truetype/dejavu')
NODES = {
    'prompt': (48, 142, 150, 76, 'Topic + prompt', 'User research input'),
    'backend': (246, 142, 166, 76, 'Backend', 'Fastify / Task → Run'),
    'codex': (460, 142, 164, 76, 'Codex', 'Live search / Thread → Turn'),
    'db': (246, 284, 166, 76, 'SQLite', 'Private state + reports'),
    'review': (460, 284, 164, 76, 'Admin + Review', 'Explicit human approval'),
    'github': (708, 284, 240, 76, 'GitHub archive', 'Approved, versioned JSON'),
    'web': (708, 142, 240, 76, 'Static Web + RSS', 'React / Vite build'),
}
STEPS = [
    ('Choose a topic and an initial prompt', 'prompt', 'backend', [(198, 180), (246, 180)]),
    ('Search sources; continue in the same Thread', 'backend', 'codex', [(412, 170), (460, 170)]),
    ('Finalize explicitly; verify original sources', 'codex', 'backend', [(460, 192), (412, 192)]),
    ('Persist Run, sources and report', 'backend', 'db', [(329, 218), (329, 284)]),
    ('Review sources and approve this version', 'db', 'review', [(412, 322), (460, 322)]),
    ('Archive approved JSON, idempotently', 'review', 'github', [(624, 322), (708, 322)]),
    ('Build independent reading pages and RSS', 'github', 'web', [(828, 284), (828, 218)]),
]


class Canvas:
    def __init__(self):
        self.image = Image.new('RGB', (W*SCALE, H*SCALE), '#f6f9f7')
        self.draw = ImageDraw.Draw(self.image)
        self.svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="title desc">',
                    '<title id="title">AI News Hub architecture</title>',
                    '<desc id="desc">User topics and iterative prompts drive Codex live source research via the private Linux Backend and stdio. Explicit finalization verifies original sources before SQLite storage. Human approval precedes GitHub archiving and independent static Web/RSS builds. Cloudflare deployment and native systemd acceptance remain pending.</desc>',
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
    c.text(31, 57, 'Your topic. Codex research. Human judgment.', 12, MUTED)
    c.text(671, 30, 'Task → Run → Thread → Turn', 12, GREEN, True)
    c.box(226, 92, 424, 298, '#edf5f0', '#d6e6dc', 17)
    c.box(682, 92, 294, 298, '#f0f4ed', '#d6e6dc', 17)
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
    c.text(47, 249, 'Multi-turn prompts.', 10, MUTED)
    c.text(47, 268, 'Codex selects the sources.', 10, MUTED)
    c.text(246, 368, 'Native systemd acceptance: pending', 9, '#956e24')
    c.box(711, 235, 233, 27, '#fff4d7', '#e8d6a6', 7)
    c.text(722, 243, 'Cloudflare deployment: pending', 10, '#956e24')
    c.text(36, 412, 'PIPELINE', 9, MUTED, True)
    for i in range(7):
        c.box(36+i*22, 436, 16, 4, GREEN if stage == i else '#c9dbd1', GREEN if stage == i else '#c9dbd1', 2)
    caption = f'{stage+1:02d}  {STEPS[stage][0]}' if stage is not None else 'Only approved reports reach GitHub.'
    c.text(218, 411, caption, 13, GREEN, True)
    c.text(218, 439, 'Manual trigger and approval today. Scheduling is not implemented.', 10, MUTED)
    if stage is not None:
        path = STEPS[stage][3]
        a, b = path[0], path[-1]
        c.dot(a[0]+(b[0]-a[0])*progress, a[1]+(b[1]-a[1])*progress)
    c.svg.append('</svg>')
    return c.image.resize((W, H), Image.Resampling.LANCZOS), '\n'.join(c.svg)+'\n'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    static, svg = frame()
    (OUT/'architecture.svg').write_text(svg)
    static.save('/tmp/ai-news-hub-architecture-preview.png')
    frames, durations = [], []
    for stage in range(7):
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
