#!/usr/bin/env python3
"""Static site generator for "math-of-ai". Python standard library only.

    python build.py              build dist/
    python build.py --release    strict: any warning (broken link, missing string, unknown demo) fails the build
    python build.py --serve      build, then serve dist/ on http://127.0.0.1:8000

Content lives in content/ (one HTML fragment per chapter and language, math written as $TeX$),
presentation in src/. Math is converted to native MathML here, so pages ship no math JavaScript.
"""
from __future__ import annotations

import argparse
import functools
import hashlib
import html
import http.server
import json
import re
import shutil
import sys
from pathlib import Path

from texmath import TexError, to_mathml

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
SRC = ROOT / "src"
DIST = ROOT / "dist"

OG_LOCALE = {"en": "en_GB", "es": "es_ES"}

WARNINGS: list[str] = []


def warn(msg: str) -> None:
    if msg not in WARNINGS:
        WARNINGS.append(msg)
        print(f"  ! {msg}", file=sys.stderr)


def load_json(path: Path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def slugify(text: str) -> str:
    import unicodedata
    text = unicodedata.normalize("NFKD", re.sub(r"<[^>]+>", "", text)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


# --------------------------------------------------------------------------- content


META_RE = re.compile(r"^\s*<!--meta\s*(\{.*?\})\s*-->\s*", re.S)


def read_fragment(path: Path) -> tuple[dict, str]:
    """An HTML fragment with an optional leading <!--meta {json} --> block."""
    text = path.read_text(encoding="utf-8")
    m = META_RE.match(text)
    if not m:
        return {}, text
    try:
        meta = json.loads(m.group(1))
    except json.JSONDecodeError as e:
        sys.exit(f"{path}: invalid meta block: {e}")
    return meta, text[m.end():]


def key_paths(obj, prefix=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from key_paths(v, f"{prefix}.{k}" if prefix else k)
    else:
        yield prefix


def load_site() -> dict:
    site = load_json(CONTENT / "site.json")
    ui = {lang: load_json(CONTENT / "i18n" / f"{lang}.json") for lang in site["langs"]}
    ref = set(key_paths(ui[site["default_lang"]]))
    for lang, strings in ui.items():
        keys = set(key_paths(strings))
        for k in sorted(ref - keys):
            warn(f"i18n/{lang}.json: missing {k}")
        for k in sorted(keys - ref):
            warn(f"i18n/{lang}.json: extra key {k}")

    chapters: dict[str, list[dict]] = {}
    for lang in site["langs"]:
        chapters[lang] = []
        for n, cid in enumerate(site["chapters"]):
            path = CONTENT / lang / "chapters" / f"{cid}.html"
            if not path.exists():
                warn(f"missing chapter {lang}/{cid}")
                continue
            meta, body = read_fragment(path)
            for field in ("slug", "title", "headline", "dek", "era", "theorems", "people", "chain"):
                if field not in meta:
                    warn(f"{lang}/chapters/{cid}.html: meta lacks '{field}'")
            meta.update(id=cid, number=n, body=body, lang=lang)
            chapters[lang].append(meta)
    site.update(ui=ui, chapter_list=chapters)
    return site


# --------------------------------------------------------------------------- urls


def page_path(site: dict, lang: str, kind: str, chapter: dict | None = None) -> str:
    """Output path (relative to dist/) of a page, always a directory index."""
    prefix = "" if lang == site["default_lang"] else f"{lang}/"
    if kind == "home":
        return f"{prefix}index.html"
    if kind == "timeline":
        return f"{prefix}{site['ui'][lang]['timeline']['slug']}/index.html"
    return f"{prefix}{chapter['slug']}/index.html"


def rel_url(from_path: str, to_path: str) -> str:
    """Relative link between two dist/ paths; directory indexes become their folder."""
    depth = from_path.count("/")
    target = to_path[: -len("index.html")] if to_path.endswith("index.html") else to_path
    url = "../" * depth + target
    return url or "./"


# --------------------------------------------------------------------------- transforms


PROTECT_RE = re.compile(r"(<pre\b.*?</pre>|<code\b.*?</code>|<script\b.*?</script>)", re.S)
DISPLAY_RE = re.compile(r"\$\$(.+?)\$\$", re.S)
INLINE_RE = re.compile(r"(?<![\\$])\$(?!\$)(.+?)(?<!\\)\$", re.S)


def render_math(text: str, where: str) -> str:
    def convert(tex: str, display: bool) -> str:
        try:
            out = to_mathml(html.unescape(tex), display)
        except TexError as e:
            warn(f"{where}: {e}")
            return f'<code class="tex-error">{esc(tex)}</code>'
        return f'<div class="math-block">{out}</div>' if display else out

    parts = PROTECT_RE.split(text)
    for k in range(0, len(parts), 2):
        p = DISPLAY_RE.sub(lambda m: convert(m.group(1), True), parts[k])
        p = INLINE_RE.sub(lambda m: convert(m.group(1), False), p)
        parts[k] = p.replace("\\$", "$")
    return "".join(parts)


def resolve_links(text: str, site: dict, lang: str, here: str, where: str) -> str:
    """href="@ch:<id>[#frag]", "@home", "@timeline[#frag]" -> relative URLs (validated)."""
    by_id = {c["id"]: c for c in site["chapter_list"][lang]}

    def repl(m: re.Match) -> str:
        target, frag = m.group(1), m.group(2) or ""
        if target == "home":
            path = page_path(site, lang, "home")
        elif target == "timeline":
            path = page_path(site, lang, "timeline")
        elif target.startswith("ch:") and target[3:] in by_id:
            path = page_path(site, lang, "chapter", by_id[target[3:]])
        else:
            warn(f"{where}: unknown link target @{target}")
            return 'href="#"'
        return f'href="{rel_url(here, path)}{frag}"'

    return re.sub(r'href="@([a-z:\-]+)(#[^"]*)?"', repl, text)


def add_heading_ids(text: str) -> tuple[str, list[tuple[str, str]]]:
    toc: list[tuple[str, str]] = []
    seen: set[str] = set()

    def repl(m: re.Match) -> str:
        attrs, inner = m.group(1), m.group(2)
        idm = re.search(r'id="([^"]+)"', attrs)
        hid = idm.group(1) if idm else slugify(inner)
        while hid in seen:
            hid += "-2"
        seen.add(hid)
        # Keep inline maths in the table of contents; drop links and emphasis.
        toc.append((hid, re.sub(r"</?(?:a|em|strong)\b[^>]*>", "", inner).strip()))
        if not idm:
            attrs += f' id="{hid}"'
        return f'<h2{attrs}><a class="anchor" href="#{hid}" aria-hidden="true">§</a>{inner}</h2>'

    return re.sub(r"<h2([^>]*)>(.*?)</h2>", repl, text, flags=re.S), toc


DEMO_RE = re.compile(r'data-demo="([a-z0-9\-]+)/([a-z0-9\-]+)"')


def demo_scripts(text: str, where: str) -> list[str]:
    files: list[str] = []
    for group, name in DEMO_RE.findall(text):
        js = SRC / "js" / "demos" / f"{group}.js"
        if not js.exists():
            warn(f"{where}: no script for demo {group}/{name}")
            continue
        if f'"{group}/{name}"' not in js.read_text(encoding="utf-8"):
            warn(f"{where}: {js.name} does not register {group}/{name}")
        if group not in files:
            files.append(group)
    return files


def check_demo_strings(site: dict) -> None:
    """Every t("demo.key") used by a demo script must exist in each language's demos section."""
    used: set[str] = set()
    for js in (SRC / "js").rglob("*.js"):
        used |= set(re.findall(r'\bt\("([a-zA-Z0-9_.\-]+)"', js.read_text(encoding="utf-8")))
    for lang, strings in site["ui"].items():
        have = set(key_paths(strings.get("demos", {})))
        for k in sorted(used - have):
            # t("group.prefix." + variable): require at least one key under that prefix.
            if k.endswith(".") and any(h.startswith(k) for h in have):
                continue
            warn(f"i18n/{lang}.json: demos.{k} is used by a script but missing")


def transform(text: str, site: dict, lang: str, here: str, where: str) -> str:
    text = render_math(text, where)
    return resolve_links(text, site, lang, here, where)


# --------------------------------------------------------------------------- assets


def copy_assets() -> dict[str, str]:
    """Copy src/ assets to dist/assets/ and return {name: versioned url-path} for cache busting."""
    out: dict[str, str] = {}
    for f in SRC.rglob("*"):
        if f.is_dir() or f.name == "template.html":
            continue
        rel = f.relative_to(SRC).as_posix()
        dest = DIST / "assets" / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dest)
        digest = hashlib.sha256(f.read_bytes()).hexdigest()[:10]
        out[rel] = f"assets/{rel}?v={digest}"
    return out


# --------------------------------------------------------------------------- page parts


def same_page(site: dict, lang: str, current: str) -> str:
    """dist/ path of the page `current` ("home", "timeline" or a chapter id) in another language."""
    if current == "timeline":
        return page_path(site, lang, "timeline")
    match = [c for c in site["chapter_list"][lang] if c["id"] == current]
    return page_path(site, lang, "chapter", match[0]) if match else page_path(site, lang, "home")


def render_header(site: dict, lang: str, here: str, current: str) -> str:
    ui = site["ui"][lang]
    home = rel_url(here, page_path(site, lang, "home"))
    timeline = rel_url(here, page_path(site, lang, "timeline"))
    items = []
    for c in site["chapter_list"][lang]:
        url = rel_url(here, page_path(site, lang, "chapter", c))
        cur = ' aria-current="page"' if current == c["id"] else ""
        items.append(f'<li class="ch-{c["id"]}"><a href="{url}"{cur}><span class="num">{c["number"]:02d}</span>'
                     f'{esc(c["title"])}</a></li>')
    langs = ""
    if len(site["langs"]) > 1:
        links = []
        for other in site["langs"]:
            target = same_page(site, other, current)
            cur = ' aria-current="true"' if other == lang else ""
            links.append(f'<a href="{rel_url(here, target)}" hreflang="{other}" lang="{other}"{cur}>{other.upper()}</a>')
        langs = f'<nav class="langs" aria-label="{esc(ui["nav"]["lang"])}">{"".join(links)}</nav>'
    return f"""<header class="site-header">
  <a class="skip" href="#main">{esc(ui["nav"]["skip"])}</a>
  <a class="brand" href="{home}"><span class="brand-mark" aria-hidden="true">∑</span>{esc(ui["site_short"])}</a>
  <nav class="site-nav" aria-label="{esc(ui["nav"]["main"])}">
    <details class="chapters-menu">
      <summary>{esc(ui["nav"]["chapters"])}</summary>
      <ol>{"".join(items)}</ol>
    </details>
    <a href="{timeline}"{' aria-current="page"' if current == "timeline" else ""}>{esc(ui["nav"]["timeline"])}</a>
    {langs}
    <button class="theme-toggle" type="button" aria-label="{esc(ui["nav"]["theme"])}" title="{esc(ui["nav"]["theme"])}">
      <span class="theme-icon" aria-hidden="true"></span>
    </button>
  </nav>
</header>"""


def render_footer(site: dict, lang: str) -> str:
    ui = site["ui"][lang]
    return f"""<footer class="site-footer">
  <p>{ui["footer"]["text"]}</p>
  <p><a href="{esc(site["repo"])}">{esc(ui["footer"]["source"])}</a> · <a href="{esc(site["author_url"])}">{esc(site["author"])}</a></p>
</footer>"""


def render_chain(site: dict, lang: str, here: str, current: str | None = None, compact: bool = False) -> str:
    """The DATA -> ... -> LLM chain: the site's table of contents and its mental model."""
    ui = site["ui"][lang]
    rows = []
    for c in site["chapter_list"][lang]:
        url = rel_url(here, page_path(site, lang, "chapter", c))
        cur = ' aria-current="step"' if c["id"] == current else ""
        if compact:
            rows.append(f'<li class="ch-{c["id"]}"><a href="{url}"{cur} title="{esc(c["title"])}">'
                        f'<span class="dot" aria-hidden="true"></span><span class="lbl">{esc(c["chain"])}</span></a></li>')
        else:
            theorems = "".join(f"<li>{transform(t, site, lang, here, 'chain')}</li>" for t in c["theorems"])
            rows.append(f"""<li class="ch-{c["id"]}">
  <a class="chain-card" href="{url}">
    <span class="chain-num">{c["number"]:02d}</span>
    <span class="chain-body">
      <span class="chain-tag">{esc(c["chain"])} <span class="chain-era">{esc(c["era"])}</span></span>
      <span class="chain-title">{esc(c["headline"])}</span>
      <span class="chain-dek">{transform(c["dek"], site, lang, here, "chain")}</span>
      <ul class="chain-theorems" aria-label="{esc(ui["chapter"]["theorems"])}">{theorems}</ul>
    </span>
  </a>
</li>""")
    cls = "chain chain-compact" if compact else "chain"
    label = esc(ui["nav"]["chapters"])
    return f'<ol class="{cls}" aria-label="{label}">{"".join(rows)}</ol>'


def render_chapter(site: dict, lang: str, ch: dict, here: str) -> tuple[str, list[str]]:
    ui = site["ui"][lang]
    where = f"{lang}/chapters/{ch['id']}.html"
    body = transform(ch["body"], site, lang, here, where)
    body, toc = add_heading_ids(body)
    demos = demo_scripts(body, where)
    chs = site["chapter_list"][lang]
    i = ch["number"]

    def nav_card(other: dict | None, label: str, cls: str) -> str:
        if not other:
            return f'<span class="pn-card {cls} empty"></span>'
        url = rel_url(here, page_path(site, lang, "chapter", other))
        return (f'<a class="pn-card {cls} ch-{other["id"]}" href="{url}"><span class="pn-label">{esc(label)}</span>'
                f'<span class="pn-title">{other["number"]:02d} · {esc(other["title"])}</span>'
                f'<span class="pn-dek">{esc(other["headline"])}</span></a>')

    prev_ = chs[i - 1] if i > 0 else None
    next_ = chs[i + 1] if i + 1 < len(chs) else None
    toc_html = "".join(f'<li><a href="#{hid}">{label}</a></li>' for hid, label in toc)
    theorems = "".join(f"<li>{transform(t, site, lang, here, where)}</li>" for t in ch["theorems"])
    people = ", ".join(esc(p) for p in ch["people"])
    main = f"""<article class="chapter">
<header class="chapter-head">
  {render_chain(site, lang, here, ch["id"], compact=True)}
  <p class="kicker">{esc(ui["chapter"]["label"])} {ch["number"]:02d} · {esc(ch["title"])}</p>
  <h1>{esc(ch["headline"])}</h1>
  <p class="dek">{transform(ch["dek"], site, lang, here, where)}</p>
  <dl class="byline">
    <div><dt>{esc(ui["chapter"]["era"])}</dt><dd>{esc(ch["era"])}</dd></div>
    <div><dt>{esc(ui["chapter"]["people"])}</dt><dd>{people}</dd></div>
    <div class="wide"><dt>{esc(ui["chapter"]["theorems"])}</dt><dd><ul>{theorems}</ul></dd></div>
  </dl>
  <nav class="toc" aria-label="{esc(ui["chapter"]["toc"])}"><p class="toc-title">{esc(ui["chapter"]["toc"])}</p><ol>{toc_html}</ol></nav>
</header>
<div class="prose">
{body}
</div>
<nav class="prev-next" aria-label="{esc(ui["chapter"]["prevnext"])}">
  {nav_card(prev_, ui["chapter"]["prev"], "prev")}
  {nav_card(next_, ui["chapter"]["next"], "next")}
</nav>
</article>"""
    return main, demos


def render_home(site: dict, lang: str, here: str) -> tuple[str, dict, list[str]]:
    meta, body = read_fragment(CONTENT / lang / "home.html")
    where = f"{lang}/home.html"
    body = body.replace("<!--chain-->", render_chain(site, lang, here))
    body = transform(body, site, lang, here, where)
    return f'<article class="home">{body}</article>', meta, demo_scripts(body, where)


def render_timeline(site: dict, lang: str, here: str) -> tuple[str, dict, list[str]]:
    data = load_json(CONTENT / lang / "timeline.json")
    where = f"{lang}/timeline.json"
    by_id = {c["id"]: c for c in site["chapter_list"][lang]}
    ui = site["ui"][lang]

    chips = [f'<button type="button" class="chip" data-filter="all" aria-pressed="true">{esc(ui["timeline"]["all"])}</button>']
    for c in site["chapter_list"][lang]:
        chips.append(f'<button type="button" class="chip ch-{c["id"]}" data-filter="{c["id"]}" aria-pressed="false">'
                     f'<span class="dot" aria-hidden="true"></span>{esc(c["chain"])}</button>')

    events = sorted(data["events"], key=lambda e: e["year"])
    eras = data["eras"]
    out = []
    for era in eras:
        in_era = [e for e in events if era["from"] <= e["year"] < era["to"]]
        items = []
        for e in in_era:
            cid = e.get("chapter")
            if cid and cid not in by_id:
                warn(f"{where}: event {e['year']} references unknown chapter {cid}")
                cid = None
            ch = by_id.get(cid) if cid else None
            link = ""
            if ch:
                url = rel_url(here, page_path(site, lang, "chapter", ch))
                link = f'<a class="ev-link" href="{url}">{esc(ui["timeline"]["read"])} {ch["number"]:02d} · {esc(ch["title"])} →</a>'
            year = str(e["year"]) if "label" not in e else e["label"]
            kind = f' ev-{e["kind"]}' if e.get("kind") else ""
            items.append(f"""<li class="event ch-{cid or "none"}{kind}" data-chapter="{cid or ""}" id="y{e["year"]}-{slugify(e["title"])[:40]}">
  <span class="ev-year">{esc(year)}</span>
  <div class="ev-body">
    <h3>{transform(e["title"], site, lang, here, where)}</h3>
    <p class="ev-who">{esc(e.get("who", ""))}</p>
    <p>{transform(e["text"], site, lang, here, where)}</p>
    {link}
  </div>
</li>""")
        winter = " era-winter" if era.get("winter") else ""
        out.append(f"""<section class="era{winter}">
  <header class="era-head"><p class="era-years">{esc(era["label"])}</p><h2>{esc(era["title"])}</h2><p>{transform(era["text"], site, lang, here, where)}</p></header>
  <ol class="events">{"".join(items)}</ol>
</section>""")
    in_some = {id(e) for era in eras for e in events if era["from"] <= e["year"] < era["to"]}
    for e in events:
        if id(e) not in in_some:
            warn(f"{where}: event {e['year']} {e['title']!r} falls outside every era")

    main = f"""<article class="timeline">
<header class="page-head">
  <p class="kicker">{esc(ui["timeline"]["kicker"])}</p>
  <h1>{esc(data["title"])}</h1>
  <p class="dek">{transform(data["dek"], site, lang, here, where)}</p>
</header>
<div class="timeline-filter" data-demo="timeline/filter" role="group" aria-label="{esc(ui["timeline"]["filter"])}">{"".join(chips)}</div>
<div class="timeline-body">{"".join(out)}</div>
</article>"""
    return main, data, demo_scripts(main, where)


# --------------------------------------------------------------------------- pages


def write_page(site: dict, lang: str, here: str, assets: dict[str, str], *, title: str, description: str,
               main: str, demos: list[str], body_class: str, current: str) -> None:
    ui = site["ui"][lang]
    template = (SRC / "template.html").read_text(encoding="utf-8")
    root = "../" * here.count("/")
    scripts = [assets["js/core.js"]]
    for d in demos:
        for dep in DEMO_DEPS.get(d, []):
            dep = dep.format(lang=lang)
            if dep not in scripts:
                scripts.append(assets[dep])
        scripts.append(assets[f"js/demos/{d}.js"])
    script_tags = "\n".join(f'<script src="{root}{s}" defer></script>' for s in scripts)
    strings = json.dumps({"lang": lang, **ui["demos"]}, ensure_ascii=False, separators=(",", ":"))
    canonical = site["base_url"] + here[: -len("index.html")]
    alternates = []
    for other in site["langs"]:
        alt = same_page(site, other, current)
        alternates.append(f'<link rel="alternate" hreflang="{other}" href="{esc(site["base_url"] + alt[: -len("index.html")])}">')
    default = same_page(site, site["default_lang"], current)
    alternates.append(f'<link rel="alternate" hreflang="x-default" href="{esc(site["base_url"] + default[: -len("index.html")])}">')
    page = (template
            .replace("{{lang}}", lang)
            .replace("{{title}}", esc(title))
            .replace("{{description}}", esc(re.sub(r"<[^>]+>|\$", "", description)))
            .replace("{{site_title}}", esc(ui["site_title"]))
            .replace("{{canonical}}", esc(canonical))
            .replace("{{alternates}}", "\n".join(alternates))
            .replace("{{og_locale}}", OG_LOCALE.get(lang, lang))
            .replace("{{author}}", esc(site["author"]))
            .replace("{{favicon}}", root + assets["favicon.svg"])
            .replace("{{css}}", root + assets["css/main.css"])
            .replace("{{theme_js}}", root + assets["js/theme.js"])
            .replace("{{scripts}}", script_tags)
            .replace("{{body_class}}", body_class)
            .replace("{{strings}}", esc(strings))
            .replace("{{header}}", render_header(site, lang, here, current))
            .replace("{{main}}", main)
            .replace("{{footer}}", render_footer(site, lang)))
    dest = DIST / here
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(page, encoding="utf-8")


# Extra scripts a demo group needs loaded before it (shared data files).
DEMO_DEPS = {
    "information": ["js/data/corpus-{lang}.js"],
}


def check_anchors() -> None:
    """Every internal link with a #fragment must land on an existing id."""
    pages = {p: p.read_text(encoding="utf-8") for p in DIST.rglob("*.html")}
    for page, text in pages.items():
        for path, frag in re.findall(r'href="([^"#:]*)#([^"]+)"', text):
            target = (page.parent / path / "index.html").resolve() if path else page
            if target not in pages and target.resolve() not in {p.resolve() for p in pages}:
                warn(f"{page.relative_to(DIST)}: link to missing page {path}")
                continue
            if f'id="{frag}"' not in target.read_text(encoding="utf-8"):
                warn(f"{page.relative_to(DIST)}: link to missing anchor {path}#{frag}")


def build() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    site = load_site()
    check_demo_strings(site)
    assets = copy_assets()
    count = 0
    for lang in site["langs"]:
        ui = site["ui"][lang]

        here = page_path(site, lang, "home")
        main, meta, demos = render_home(site, lang, here)
        write_page(site, lang, here, assets, title=ui["site_title"], description=ui["site_description"],
                   main=main, demos=demos, body_class="page-home", current="home")
        count += 1

        here = page_path(site, lang, "timeline")
        main, data, demos = render_timeline(site, lang, here)
        write_page(site, lang, here, assets, title=f'{data["title"]} · {ui["site_short"]}', description=data["dek"],
                   main=main, demos=demos, body_class="page-timeline", current="timeline")
        count += 1

        for ch in site["chapter_list"][lang]:
            here = page_path(site, lang, "chapter", ch)
            main, demos = render_chapter(site, lang, ch, here)
            write_page(site, lang, here, assets, title=f'{ch["title"]}: {ch["headline"]} · {ui["site_short"]}',
                       description=ch["dek"], main=main, demos=demos,
                       body_class=f'page-chapter ch-{ch["id"]}', current=ch["id"])
            count += 1

    check_anchors()
    (DIST / ".nojekyll").write_text("", encoding="utf-8")
    print(f"built {count} pages into {DIST.relative_to(ROOT)}/" + (f" with {len(WARNINGS)} warning(s)" if WARNINGS else ""))


def serve(port: int) -> None:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"serving on http://127.0.0.1:{port}/  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--release", action="store_true", help="fail on any warning")
    ap.add_argument("--serve", action="store_true", help="serve dist/ after building")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    build()
    if args.release and WARNINGS:
        sys.exit(f"--release: {len(WARNINGS)} warning(s), refusing to publish")
    if args.serve:
        serve(args.port)


if __name__ == "__main__":
    main()
