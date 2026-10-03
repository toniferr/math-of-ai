# Why does AI work? · math-of-ai

An interactive explainer on the mathematics and history of artificial intelligence, published at
**https://toniferr.github.io/math-of-ai/** in English and Spanish ([/es/](https://toniferr.github.io/math-of-ai/es/)).

Ten chapters follow the chain of ideas that leads from Turing to ChatGPT. Each one tells the history, states the key
theorems (with foldable proofs) and includes interactive figures:

| # | Chapter | Theorems and results | Interactive figures |
| --- | --- | --- | --- |
| 00 | Computation | Universal machine, undecidability of halting | Step-by-step Turing machine |
| 01 | Probability | Law of large numbers, Bayes, maximum likelihood | Biased coin: frequency and posterior |
| 02 | Information | Entropy, source coding, Gibbs, cross-entropy | Entropy and Huffman, KL, Shannon's n-grams |
| 03 | Linear algebra | Cauchy–Schwarz, Johnson–Lindenstrauss, SVD | Embedding analogies, 2×2 matrices |
| 04 | Calculus | Chain rule, cheap gradient (Baur–Strassen) | Secant → tangent, backpropagation |
| 05 | Optimization | GD convergence, Nesterov, Robbins–Monro | Loss landscapes, SGD |
| 06 | Neural networks | Perceptron convergence, XOR, universal approximation | Perceptron vs. hidden layer, sum of sigmoids |
| 07 | Learning theory | Finite-class bound, VC, PAC, no free lunch | Overfitting, shattering with lines |
| 08 | Transformers | Attention, variance of q·k, universal approximation | Attention heads |
| 09 | LLMs | Softmax = maximum entropy, scaling, KL-optimal policy, hallucinations | Temperature/top-k/top-p, scaling laws |

Plus a home page with a “next-word predictor” and a filterable timeline from 1654 to today.

## Principles

- **No frameworks, no dependencies.** Hand-written HTML, CSS and JavaScript. The generator (`build.py`) uses only the
  Python 3.10+ standard library.
- **Native MathML.** Chapters are written with `$TeX$` and `texmath.py` converts it to MathML at build time: no MathJax,
  no KaTeX, no downloaded fonts. An unknown command fails the build.
- **Secure by default.** Strict CSP (own resources only, no inline JavaScript or styles), no CDN or analytics, and the
  workflow's actions pinned by SHA.
- **Bilingual.** English is the default language at the site root and Spanish lives under `/es/`; every page links to
  its counterpart and declares `hreflang` alternates.

## Running locally

```powershell
python build.py --serve        # builds dist/ and serves it at http://127.0.0.1:8000
python build.py --release      # strict mode (the one CI uses): any warning fails the build
```

The build warns about broken internal links and anchors, formulas that do not compile, demos without a script or not
registered, strings used by the demos but missing from `i18n`, and keys present in one language but not the other.

## Structure

```text
content/
├── site.json                  base URL, languages and chapter order
├── i18n/{en,es}.json          interface and interactive-figure strings (same keys in both)
└── {en,es}/
    ├── home.html              home page (<!--chain--> is replaced by the contents)
    ├── timeline.json          eras and events of the timeline
    └── chapters/<id>.html     one chapter: <!--meta {json} --> block + HTML with $TeX$
src/
├── template.html, favicon.svg
├── css/main.css               editorial (Distill-like) style, light and dark themes
└── js/
    ├── theme.js               flicker-free theme (synchronous in <head>)
    ├── core.js                demo registry and helpers (controls, canvas, axes, softmax…)
    ├── data/corpus-{en,es}.js public-domain training text for the n-grams (Alice; Don Quixote)
    └── demos/<group>.js       interactive figures for each chapter
texmath.py                     TeX → MathML converter
build.py                       generator → dist/ (English) and dist/es/ (Spanish)
```

## Writing a chapter

- Formulas: `$...$` inline and `$$...$$` for display. `\class{k1}{...}` colours a term (k1–k4), just like
  `<span class="k1">` in the text.
- Internal links: `href="@ch:<id>#anchor"`, `href="@timeline"` and `href="@home"`.
- Boxes: `<div class="theorem">`, `definition` or `idea`, with a `<span class="th-title">`; proofs go in
  `<details class="proof"><summary>…</summary><div>…</div></details>`.
- Margin notes: `<aside class="note">`.
- Interactive figures: `<figure class="demo" data-demo="group/name"><figcaption>…</figcaption></figure>`; the script
  `src/js/demos/group.js` registers it with `MOA.register("group/name", init)` and takes its texts from the `demos`
  section of `i18n`.
