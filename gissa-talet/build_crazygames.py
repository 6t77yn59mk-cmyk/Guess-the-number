"""Makes the folder to upload to CrazyGames.

CrazyGames only hosts the game's files, so ONLINE and PARTY play through the game server that
runs somewhere else (for example on Render). Give its address:

    py -3 build_crazygames.py https://your-game.onrender.com

The files end up in dist/guess-the-number/ (index.html, style.css and js/ with that address
filled in, and the CrazyGames SDK added to index.html). Upload that folder's contents –
CrazyGames doesn't accept zip files.
"""
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "dist" / "guess-the-number"
SDK_TAG = '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>'


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"https://[\w.-]+/?", sys.argv[1]):
        print(__doc__)
        print("Give the game server's https:// address (without anything after the name).")
        sys.exit(1)
    server = sys.argv[1].rstrip("/")

    files = [ROOT / "index.html", ROOT / "style.css", *sorted((ROOT / "js").glob("*.js"))]
    if OUT.exists():
        shutil.rmtree(OUT)
    for path in files:
        text = path.read_text(encoding="utf-8")
        if path.name == "index.html":
            # The CrazyGames SDK (js/crazygames.js uses it), loaded before the game's own code
            stylesheet = '<link rel="stylesheet" href="style.css">'
            count = text.count(stylesheet)
            text = text.replace(stylesheet, stylesheet + "\n  " + SDK_TAG)
            if count != 1:
                sys.exit("Could not find where to add the CrazyGames SDK in index.html")
        if path.name == "config.js":
            text, count = re.subn(r"export const GAME_SERVER = '[^']*';", f"export const GAME_SERVER = '{server}';", text)
            if count != 1:
                sys.exit("Could not find GAME_SERVER in js/config.js")
        target = OUT / path.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="\n")

    size_kb = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file()) / 1024
    print(f"Done: {OUT}  ({len(files)} files, {size_kb:.0f} KB)")
    print(f"Online and party connect to {server}")


if __name__ == "__main__":
    main()
