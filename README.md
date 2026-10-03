# ¿Por qué funciona la IA? · math-of-ai

Web didáctica e interactiva sobre las matemáticas y la historia de la inteligencia artificial, publicada en
**https://toniferr.github.io/math-of-ai/**.

Recorre en diez capítulos la cadena de ideas que lleva de Turing a ChatGPT. Cada capítulo cuenta la historia,
enuncia los teoremas clave (con demostraciones plegables) e incluye figuras interactivas:

| # | Capítulo | Teoremas y resultados | Figuras interactivas |
| --- | --- | --- | --- |
| 00 | Computación | Máquina universal, indecidibilidad de la parada | Máquina de Turing paso a paso |
| 01 | Probabilidad | Ley de los grandes números, Bayes, máxima verosimilitud | Moneda trucada: frecuencia y posterior |
| 02 | Información | Entropía, codificación de fuente, Gibbs, entropía cruzada | Entropía y Huffman, KL, n-gramas de Shannon |
| 03 | Álgebra lineal | Cauchy-Schwarz, Johnson-Lindenstrauss, SVD | Analogías con embeddings, matrices 2×2 |
| 04 | Cálculo | Regla de la cadena, gradiente barato (Baur-Strassen) | Secante → tangente, retropropagación |
| 05 | Optimización | Convergencia de GD, Nesterov, Robbins-Monro | Paisajes de pérdida, SGD |
| 06 | Redes neuronales | Convergencia del perceptrón, XOR, aproximación universal | Perceptrón vs. red oculta, suma de sigmoides |
| 07 | Teoría del aprendizaje | Cota para clases finitas, VC, PAC, no free lunch | Sobreajuste, pulverización con rectas |
| 08 | Transformers | Atención, varianza de q·k, aproximación universal | Cabezas de atención |
| 09 | LLM | Softmax = máxima entropía, escalado, política óptima con KL, alucinaciones | Temperatura/top-k/top-p, leyes de escalado |

Además: una portada con un «predictor de la siguiente palabra» y una línea temporal filtrable de 1654 a hoy.

## Principios

- **Sin frameworks ni dependencias.** HTML, CSS y JavaScript propios. El generador (`build.py`) solo usa la
  biblioteca estándar de Python 3.10+.
- **Fórmulas en MathML nativo.** Los capítulos se escriben con `$TeX$` y `texmath.py` los convierte a MathML al
  generar el sitio: sin MathJax, sin KaTeX y sin fuentes descargadas. Un comando desconocido hace fallar el build.
- **Seguro por defecto.** CSP estricta (solo recursos propios, sin JavaScript ni estilos en línea), sin CDN ni
  analítica, y las actions del workflow fijadas por SHA.
- **Preparada para traducir.** Todo el texto está en `content/` (capítulos por idioma y cadenas de la interfaz y
  de las demos en `content/i18n/`). Hoy solo existe `es`; el build comprueba que todos los idiomas tengan las
  mismas claves.

## Arrancar en local

```powershell
python build.py --serve        # genera dist/ y lo sirve en http://127.0.0.1:8000
python build.py --release      # modo estricto (el de CI): cualquier aviso hace fallar el build
```

El build avisa de enlaces internos rotos, fórmulas que no compilan, demos sin script o sin registrar y
cadenas que usan las demos pero faltan en `i18n`.

## Estructura

```text
content/
├── site.json                  URL base, idiomas y orden de los capítulos
├── i18n/es.json               textos de la interfaz y de las figuras interactivas
└── es/
    ├── home.html              portada (<!--chain--> se sustituye por el índice)
    ├── timeline.json          eras y eventos de la línea temporal
    └── chapters/<id>.html     un capítulo: bloque <!--meta {json} --> + HTML con $TeX$
src/
├── template.html, favicon.svg
├── css/main.css               estilo editorial (tipo Distill), tema claro y oscuro
└── js/
    ├── theme.js               tema sin parpadeo (síncrono en <head>)
    ├── core.js                registro de demos y utilidades (controles, canvas, ejes, softmax…)
    ├── data/corpus-es.js      capítulo I del Quijote (dominio público) para los n-gramas
    └── demos/<grupo>.js       figuras interactivas de cada capítulo
texmath.py                     conversor TeX → MathML
build.py                       generador → dist/
```

## Escribir un capítulo

- Fórmulas: `$...$` en línea y `$$...$$` en bloque. `\class{k1}{...}` colorea un término (k1–k4), igual que
  `<span class="k1">` en el texto.
- Enlaces internos: `href="@ch:<id>#ancla"`, `href="@timeline"` y `href="@home"`.
- Cajas: `<div class="theorem">`, `definition` o `idea`, con `<span class="th-title">`; las demostraciones van en
  `<details class="proof"><summary>…</summary><div>…</div></details>`.
- Notas al margen: `<aside class="note">`.
- Figuras interactivas: `<figure class="demo" data-demo="grupo/nombre"><figcaption>…</figcaption></figure>`; el
  script `src/js/demos/grupo.js` la registra con `MOA.register("grupo/nombre", init)`.

## Añadir un idioma

1. Añade el código a `langs` en `content/site.json`.
2. Copia `content/i18n/es.json` y `content/es/` y tradúcelos; el `slug` de cada capítulo puede cambiar.
3. `python build.py --release` señala cualquier clave que falte.
