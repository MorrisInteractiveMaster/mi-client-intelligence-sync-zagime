"""Build site/looks.html: nine looks of one dashboard, with the shared model, charts, panel and At a glance player.

Run from anywhere: python3 prototype/looks/build.py
"""
import json, sys
from pathlib import Path

H = Path(__file__).resolve().parent
sys.path.insert(0, str(H.parent))
from fonts import FIXTURES, SITE, face, png  # noqa: E402

SHARED, ANIM = H.parent / "shared", H.parent / "animation"
FONT_CSS = (face("Manrope", "manrope-{sub}-wght-normal.woff2", "200 800")
            + face("DM Sans", "dm-sans-{sub}-wght-normal.woff2", "100 1000")
            + face("Space Grotesk", "space-grotesk-{sub}-wght-normal.woff2", "300 700")
            + face("IBM Plex Mono", "ibm-plex-mono-{sub}-400-normal.woff2", "400")
            + face("IBM Plex Mono", "ibm-plex-mono-{sub}-600-normal.woff2", "600")
            + face("Tinos", "tinos-{sub}-400-normal.woff2", "400") + face("Tinos", "tinos-{sub}-700-normal.woff2", "700"))
LOGO = png("zagime-main-logo.png")

# Data: today the five synthetic sets. In the real app this is replaced by loadDashboardData() (see handoffDevFeedData.md).
base = json.loads((FIXTURES / "dashboardCurrent.json").read_text()); base["label"] = "Current demo"
sets = [base] + json.loads((FIXTURES / "variants" / "dashboardScenarios.json").read_text())

page_html = (SHARED / "page.html").read_text().replace("<span>Design</span>", "<span>Look</span>").replace(
    '<span id="rv-note"', '<div class="rv-group"><span>Animation</span><div id="rv-anim"></div></div><span id="rv-note"')
css = FONT_CSS + (SHARED / "shell.css").read_text() + (SHARED / "o1Briefing.css").read_text() + (H / "looks.css").read_text()
ORDER = ["nordic", "editorial", "health", "briefing", "glass", "bauhaus", "swiss", "brutal", "terminal"]  # Dan's ranking, best first
briefing = (SHARED / "o1Briefing.js").read_text().replace("Design option 1 · Synthetic data", "Briefing (the original) · synthetic data for design review").replace("name: 'Briefing'", "name: 'Briefing (original)'")
js = "".join((ANIM / f).read_text() for f in ["engine.js", "style4Dots.js", "style1Wave.js", "style3Blocks.js", "style2Editorial.js", "sound.js"]) \
     + (SHARED / "model.js").read_text() + (SHARED / "charts.js").read_text() \
     + "window.ZOPTIONS=[];" + (H / "looks.js").read_text() + briefing \
     + f"window.ZOPTIONS.sort((a,b)=>{json.dumps(ORDER)}.indexOf(a.key)-{json.dumps(ORDER)}.indexOf(b.key));" + (SHARED / "shell.js").read_text()
page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zagimē Dashboard · Nine looks · Design V03</title><style>{css}</style></head><body>{page_html}
<script>window.ZDATA={json.dumps(sets, ensure_ascii=False)};window.ZLOGO="{LOGO}";window.PULSE_DATA=window.ZDATA;window.PULSE_ASSETS={{zagime:window.ZLOGO}};</script>
<script>{js}</script></body></html>"""
SITE.mkdir(exist_ok=True)
(SITE / "looks.html").write_text(page)
print("site/looks.html", f"{len(page) / 1024:.0f} KB")
