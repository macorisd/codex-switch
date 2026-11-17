"""Build bundled status-bar WOFF from the versioned monochrome SVG sources.

Development only: python -m pip install -r scripts/requirements-icons.txt
No font tools, network or generation is required by an installed VSIX.
"""
from pathlib import Path
import xml.etree.ElementTree as ET
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import SVGPath

ROOT = Path(__file__).resolve().parents[1]
NAMES = ['openai', 'deepseek', 'openrouter', 'openai-api', 'zai', 'moonshot', 'qwen', 'xai', 'minimax', 'mimo']


def build():
    builder = FontBuilder(1024, isTTF=True)
    order = ['.notdef'] + NAMES
    builder.setupGlyphOrder(order)
    glyphs = {'.notdef': TTGlyphPen(None).glyph()}
    for name in NAMES:
        source = ROOT / 'media/status-icons' / (name + '.svg')
        text = source.read_text('utf-8')
        viewbox = [float(n) for n in ET.fromstring(text).attrib['viewBox'].split()]
        x, y, width, height = viewbox
        size = max(width, height); scale = 896 / size
        pen = TTGlyphPen(None)
        transform = (scale, 0, 0, -scale, 64 - x * scale + (size - width) * scale / 2,
                     960 + y * scale - (size - height) * scale / 2)
        SVGPath.fromstring(text).draw(TransformPen(Cu2QuPen(pen, max_err=1), transform))
        glyphs[name] = pen.glyph()
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (1024, 0) for name in order})
    builder.setupHorizontalHeader(ascent=1024, descent=0)
    builder.setupCharacterMap({0xE900 + i: name for i, name in enumerate(NAMES)})
    builder.setupNameTable({'familyName': 'Codex Switch Providers', 'styleName': 'Regular',
                           'uniqueFontIdentifier': 'CodexSwitchProviders1', 'fullName': 'Codex Switch Providers',
                           'psName': 'CodexSwitchProviders', 'version': 'Version 1.0'})
    builder.setupOS2(sTypoAscender=1024, sTypoDescender=0, usWinAscent=1024, usWinDescent=0)
    builder.setupPost(); builder.setupMaxp()
    builder.font['head'].created = builder.font['head'].modified = 3800000000
    builder.font.recalcTimestamp = False
    builder.font.flavor = 'woff'
    builder.save(ROOT / 'media/status-icons/providers.woff')


if __name__ == '__main__':
    build()
