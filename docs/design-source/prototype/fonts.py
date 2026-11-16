"""Shared helpers for the build scripts: embed fonts and images as base64 so each page is one self-contained file."""
import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parent          # prototype/
PACKAGE = ROOT.parent                           # DashboardUploadNov13/
FONTS, ASSETS = ROOT / "fonts", ROOT / "assets"
FIXTURES = PACKAGE / "fixtures" / "synthetic-qbo"
SITE = PACKAGE / "site"

LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"


def b64(path):
    return base64.b64encode(Path(path).read_bytes()).decode()


def face(family, pattern, weight):
    """pattern is a file name in fonts/ with {sub} where latin or latin-ext goes."""
    return "".join(
        f"@font-face{{font-family:'{family}';font-style:normal;font-display:block;font-weight:{weight};"
        f"src:url(data:font/woff2;base64,{b64(FONTS / pattern.format(sub=sub))}) format('woff2');unicode-range:{r}}}"
        for sub, r in (("latin", LATIN), ("latin-ext", EXT)))


def png(name):
    return "data:image/png;base64," + b64(ASSETS / name)
