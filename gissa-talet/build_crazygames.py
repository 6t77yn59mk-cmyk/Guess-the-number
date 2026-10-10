"""Makes the zip file to upload to CrazyGames.

CrazyGames only hosts the game's files, so ONLINE and PARTY play through the game server that
runs somewhere else (for example on Render). Give its address:

    py -3 build_crazygames.py https://your-game.onrender.com

The zip ends up in dist/ and contains index.html, style.css and js/ with that address filled in.
"""
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "dist" / "guess-the-number-crazygames.zip"


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"https://[\w.-]+/?", sys.argv[1]):
        print(__doc__)
        print("Give the game server's https:// address (without anything after the name).")
        sys.exit(1)
    server = sys.argv[1].rstrip("/")

    files = [ROOT / "index.html", ROOT / "style.css", *sorted((ROOT / "js").glob("*.js"))]
    OUT.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for path in files:
            text = path.read_text(encoding="utf-8")
            if path.name == "config.js":
                text, count = re.subn(r"export const GAME_SERVER = '[^']*';", f"export const GAME_SERVER = '{server}';", text)
                if count != 1:
                    sys.exit("Could not find GAME_SERVER in js/config.js")
            zip_file.writestr(path.relative_to(ROOT).as_posix(), text)

    size_kb = OUT.stat().st_size / 1024
    print(f"Done: {OUT}  ({len(files)} files, {size_kb:.0f} KB)")
    print(f"Online and party connect to {server}")


if __name__ == "__main__":
    main()
