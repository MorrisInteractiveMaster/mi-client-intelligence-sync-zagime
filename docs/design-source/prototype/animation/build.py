"""Build site/atAGlance.html: the At a glance recap in four styles, as one self-contained file.

Run from anywhere: python3 prototype/animation/build.py
"""
import json, sys
from pathlib import Path

H = Path(__file__).resolve().parent
sys.path.insert(0, str(H.parent))
from fonts import FIXTURES, SITE, face, png  # noqa: E402

FONT_CSS = face("Manrope", "manrope-{sub}-wght-normal.woff2", "200 800") + face("DM Sans", "dm-sans-{sub}-wght-normal.woff2", "100 1000")
ZAGIME, MI = png("zagime-main-logo.png"), png("miLogo96.png")
base = json.loads((FIXTURES / "dashboardCurrent.json").read_text()); base["label"] = "Current demo"
sets = [base] + json.loads((FIXTURES / "variants" / "dashboardScenarios.json").read_text())
js = "".join((H / f).read_text() for f in ["engine.js", "style1Wave.js", "style2Editorial.js", "style3Blocks.js", "style4Dots.js", "sound.js"])
page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Partnership Pulse · At a glance · Design V01</title><style>{FONT_CSS}{(H / 'page.css').read_text()}</style></head>
<body>{(H / 'page.html').read_text().replace('{{ZAGIME}}', ZAGIME)}
<script>window.PULSE_DATA={json.dumps(sets, ensure_ascii=False)};window.PULSE_ASSETS={{zagime:"{ZAGIME}",mi:"{MI}"}};</script>
<script>{js}</script><script>{(H / 'ui.js').read_text()}</script></body></html>"""
SITE.mkdir(exist_ok=True)
(SITE / "atAGlance.html").write_text(page)
print("site/atAGlance.html", f"{len(page) / 1024:.0f} KB", len(sets), "data sets")
