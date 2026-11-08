"""Copy the shared Signoff files Partcheck's Send to Signoff ME uses into this repo, unchanged except
for a header.

    python tools/sync_vendor.py           # re-copy
    python tools/sync_vendor.py --check   # exit 1 if any copy differs from its source

- assets/vendor/model.js     Signoff engine model (ee_design_review; GitHubStore needs it)
- assets/vendor/github.js    Signoff engine GitHub storage: putFiles / listTree / blobBytes
- assets/vendor/model3d.js   Signoff PL's mesh format (PLM1) and renderer (signoff_pl), so what
                             Partcheck stores is what PL reads and its pictures look like PL's
                             (docs/send-to-signoff-me.md)

assets/suite.css has its own script, tools/sync_suite_css.py.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = [
    ("ee_design_review", "Signoff EE", "assets/model.js", "assets/vendor/model.js"),
    ("ee_design_review", "Signoff EE", "assets/github.js", "assets/vendor/github.js"),
    ("signoff_pl", "Signoff PL", "assets/model3d.js", "assets/vendor/model3d.js"),
]


def header(repo, tool, src):
    return (f"/* Vendored from {repo}/{src} ({tool}) by tools/sync_vendor.py.\n"
            "   Do not edit here: change it there and re-run the script. */\n")


def main():
    check = "--check" in sys.argv
    stale = []
    for repo, tool, src, dst in FILES:
        want = header(repo, tool, src) + (ROOT.parent / repo / src).read_text(encoding="utf-8").replace("\r\n", "\n")
        path = ROOT / dst
        have = path.read_text(encoding="utf-8") if path.exists() else None
        if have == want:
            continue
        if check:
            stale.append(dst)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(want, encoding="utf-8", newline="\n")
            print(f"copied {repo}/{src} -> {dst}")
    if check:
        if stale:
            print("stale vendored files: " + ", ".join(stale) + " (run python tools/sync_vendor.py)")
            sys.exit(1)
        print("vendored files are current")


if __name__ == "__main__":
    main()
