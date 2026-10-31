"""Build index.html from index.src.html by inlining the explainer and chart SVGs.

Inlining (rather than <img>) lets each named SVG layer build on separately and
keeps the deck working from file:// with no server. Run from anywhere:

    python3 src/build.py
"""
import re
from pathlib import Path

SRC = Path(__file__).resolve().parent
OUT = SRC.parent / "index.html"

# layer id -> (build step, delay in ms). Ungrouped elements stay visible with the slide.
LAYERS = {
    "v01-rules-become-lines": {
        "title": (0, 0), "small-print": (0, 0), "ruler": (0, 80),
        "line-1": (0, 160), "line-2": (0, 240), "line-3": (0, 320), "line-4": (0, 400),
        "ward-band": (0, 480),
        "gauge": (1, 0), "limit-tick": (1, 120), "needle-before": (1, 220),
        "needle-after": (1, 700), "readout": (1, 700),
    },
    "v03-market-or-stocks": {
        "title": (0, 0), "small-print": (0, 0), "bar-market": (0, 150),
        "bar-own": (0, 260), "share": (0, 420), "example": (0, 540),
    },
    "v06-five-percent-steps": {
        "title": (0, 0), "small-print": (0, 0), "before": (0, 100),
        **{f"before-{t}": (0, 160 + 50 * i) for i, t in enumerate("NVDA AMD AVGO MSFT GOOGL AMZN META".split())},
        "after": (1, 0),
        **{f"after-{t}": (1, 60 * i) for i, t in enumerate("NVDA AMD AVGO MSFT GOOGL AMZN META PG KO XLP".split())},
        "readout-1": (1, 650), "readout-2": (1, 800),
    },
    "v07-gemini-proposes": {
        "title": (0, 0), "small-print": (0, 0), "gemini": (0, 120),
        "tool-1": (0, 260), "tool-2": (0, 360), "tool-3": (0, 460), "tool-4": (0, 560),
        "revise": (0, 700), "news": (0, 820), "no-trade": (0, 900),
    },
    "v08-one-gate": {
        "title": (1, 0), "small-print": (1, 0), "plan-1": (1, 100), "plan-2": (1, 180),
        "gate": (1, 260), **{f"check-{i}": (1, 340 + 70 * (i - 1)) for i in range(1, 9)},
        "winner": (1, 1000),
    },
}


def clean_svg(text: str, prefix: str) -> str:
    text = re.sub(r"<\?xml[^>]*\?>", "", text)
    text = re.sub(r"@font-face\{[^}]*\}", "", text)  # the page loads Geist once
    text = re.sub(r"<title>.*?</title>", "", text, flags=re.S)
    text = re.sub(r'id="([^"]+)"', rf'id="{prefix}-\1"', text)
    text = re.sub(r"url\(#([^)]+)\)", rf"url(#{prefix}-\1)", text)
    text = re.sub(r'href="#([^"]+)"', rf'href="#{prefix}-\1"', text)
    text = re.sub(r'(<svg[^>]*?) width="\d+" height="\d+"', r'\1 width="100%" height="100%"', text, count=1)
    return text.strip()


def explainer(name: str) -> str:
    prefix = name.split("-")[0]
    text = clean_svg((SRC / "svg" / f"{name}.svg").read_text(), prefix)
    for layer, (b, d) in LAYERS[name].items():
        text, n = re.subn(rf'<g id="{prefix}-{layer}"', f'<g id="{prefix}-{layer}" data-b="{b}" style="--d:{d}ms"', text)
        assert n == 1, f"{name}: layer {layer} not found"
    return text


def chart() -> str:
    text = clean_svg((SRC / "svg" / "replay-2025q1-guardian-vs-hold.svg").read_text(), "q1")
    # The slide carries its own headline, so drop the chart's long title.
    text = re.sub(r"<text[^>]*>Same stocks, same days[^<]*</text>", "", text)
    lines = iter([("2", ' class="draw" pathLength="1"'),   # Guardian
                  ("1", ' class="draw" pathLength="1"'),   # buy and hold
                  ("3", "")])                               # sell everything
    def tag_polyline(m):
        b, extra = next(lines)
        return f'<polyline data-b="{b}"{extra} style="--d:0ms"'
    text = re.sub(r"<polyline", tag_polyline, text)
    labels = {"Sell everything": (3, 0), "Guardian": (2, 1300), "Buy and hold": (1, 1300)}
    for label, (b, d) in labels.items():
        text, n = re.subn(rf'<text([^>]*)>{label}', rf'<text\1 data-b="{b}" style="--d:{d}ms">{label}', text)
        assert n == 1, label
    # Wrap each diamond in a group: the build's CSS transform would override its rotate(45).
    def tag_diamond(m):
        cx = float(m.group(2))
        delay = round((cx - 110) / (1340 - 110) * 1400)
        return f'<g data-b="2" style="--d:{delay}ms">{m.group(1)}</g>'
    text = re.sub(r'(<rect x="[^"]*" y="[^"]*" width="18" height="18" transform="rotate\(45 ([\d.]+) [^"]*"[^>]*/>)', tag_diamond, text)
    return text


def main() -> None:
    html = (SRC / "index.src.html").read_text()
    html = re.sub(r"\{\{SVG:([\w-]+)\}\}", lambda m: explainer(m.group(1)), html)
    html = html.replace("{{CHART:q1}}", chart())
    assert "{{" not in html, "unreplaced placeholder"
    OUT.write_text(html)
    print(f"wrote {OUT} ({len(html) // 1024} KB)")


if __name__ == "__main__":
    main()
