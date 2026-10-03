// Chapter 09 — temperature / top-k / top-p sampling, and Chinchilla-style scaling laws.
(function () {
  "use strict";
  var M = window.MOA, h = M.h, s = M.s, t = M.t;

  // ------------------------------------------------------------------ sampling

  var SCORES = [2.6, 2.3, 2.0, 1.5, 1.2, 0.5, 0.3, -0.2, -0.9, -2.0];

  M.register("llms/sampling", function (stage) {
    var LOGITS = t("samp.words").split("|").map(function (w, i) { return [w, SCORES[i]]; });
    var T = 1, topK = 10, topP = 1;
    var counts = LOGITS.map(function () { return 0; }), total = 0, picked = -1;
    var rand = M.rng(Date.now() % 1e6);

    var prompt = h("div", { class: "tok-prompt", "aria-live": "polite" });
    var list = h("ul", { class: "tok-list tok-list-counts" });
    var stH = M.stat(t("samp.entropy"), "accent"), stKeep = M.stat(t("samp.kept")), stN = M.stat(t("samp.samples"));

    stage.appendChild(M.controls(
      M.slider({ label: t("samp.temp") + " T", min: 0.05, max: 3, log: true, value: T, format: function (v) { return M.fmt(v, 2); },
        onInput: function (v) { T = v; draw(); } }).el,
      M.slider({ label: "top-k", min: 1, max: LOGITS.length, step: 1, value: topK, format: function (v) { return M.fmt(v, 0); },
        onInput: function (v) { topK = v; draw(); } }).el,
      M.slider({ label: "top-p", min: 0.05, max: 1, step: 0.01, value: topP, format: function (v) { return M.fmt(v, 2); },
        onInput: function (v) { topP = v; draw(); } }).el));
    stage.appendChild(prompt);
    stage.appendChild(list);
    stage.appendChild(M.controls(h("div", { class: "btn-row" },
      M.button(t("samp.one"), function () { sampleN(1); }, "primary"),
      M.button(t("samp.hundred"), function () { sampleN(100); }),
      M.button(t("samp.clear"), function () { counts = counts.map(function () { return 0; }); total = 0; picked = -1; draw(); }))));
    stage.appendChild(h("div", { class: "stats" }, stH.el, stKeep.el, stN.el));

    function dist() {
      var p = M.softmax(LOGITS.map(function (l) { return l[1]; }), T);
      var order = p.map(function (_, i) { return i; }).sort(function (a, b) { return p[b] - p[a]; });
      var keep = {}, acc = 0;
      for (var r = 0; r < order.length; r++) {
        if (r >= topK) break;
        keep[order[r]] = true;
        acc += p[order[r]];
        if (acc >= topP - 1e-9) break;
      }
      var z = 0;
      p.forEach(function (v, i) { if (keep[i]) z += v; });
      return p.map(function (v, i) { return keep[i] ? v / z : 0; });
    }

    function sampleN(n) {
      var p = dist();
      for (var k = 0; k < n; k++) { picked = M.sample(p, rand); counts[picked]++; total++; }
      draw();
    }

    function draw() {
      var p = dist();
      M.clear(prompt);
      prompt.appendChild(document.createTextNode(t("samp.prompt") + " "));
      if (picked >= 0) prompt.appendChild(h("span", { class: "added" }, LOGITS[picked][0]));
      prompt.appendChild(h("span", { class: "caret", "aria-hidden": "true" }));
      M.clear(list);
      LOGITS.forEach(function (l, i) {
        var fill = h("span", { class: "tok-fill" });
        fill.style.width = (100 * p[i]).toFixed(1) + "%";
        var freq = h("span", { class: "tok-freq" });
        freq.style.width = (total ? 100 * counts[i] / total : 0).toFixed(1) + "%";
        list.appendChild(h("li", {}, h("div", { class: "tok-row" + (p[i] === 0 ? " cut" : "") + (i === picked ? " picked" : "") },
          h("span", { class: "tok-word" }, l[0]),
          h("span", { class: "tok-track" }, fill, freq),
          h("span", { class: "tok-p" }, p[i] ? M.pct(p[i], 1) : "—"),
          h("span", { class: "tok-p tok-count" }, total ? M.fmt(counts[i], 0) : ""))));
      });
      stH.set(M.fmt(M.entropy(p), 2) + " bits");
      stKeep.set(p.filter(function (v) { return v > 0; }).length + " / " + LOGITS.length);
      stN.set(M.fmt(total, 0));
    }

    draw();
  });

  // ------------------------------------------------------------------ scaling laws

  // L(N, D) = E + A / N^a + B / D^b — parameters from Besiroglu et al. (2024), a replication of Hoffmann et al. (2022).
  var E = 1.82, A = 482.01, B = 2085.43, ALPHA = 0.3478, BETA = 0.3658;
  function loss(N, D) { return E + A / Math.pow(N, ALPHA) + B / Math.pow(D, BETA); }
  var MODELS = [
    { name: "GPT-3", N: 175e9, D: 300e9, dx: -8, dy: -12, anchor: "end" },
    { name: "Chinchilla", N: 70e9, D: 1.4e12, dx: -8, dy: 16, anchor: "end" },
    { name: "Gopher", N: 280e9, D: 300e9, dx: 8, dy: 4, anchor: "start" },
  ];

  function human(x) {
    var units = [[1e12, t("scale.units.T")], [1e9, t("scale.units.B")], [1e6, t("scale.units.M")]];
    for (var i = 0; i < units.length; i++) if (x >= units[i][0]) return M.fmt(x / units[i][0], x / units[i][0] < 10 ? 1 : 0) + " " + units[i][1];
    return M.fmt(x, 0);
  }
  function sci(x) {
    var e = Math.floor(Math.log10(x)), m = x / Math.pow(10, e);
    var sup = String(e).split("").map(function (c) { return "⁰¹²³⁴⁵⁶⁷⁸⁹"[+c]; }).join("");
    return M.fmt(m, 1) + "·10" + sup;
  }

  M.register("llms/scaling", function (stage) {
    var logC = 23.77; // ≈ GPT-3 / Chinchilla budget
    var W = 640, H = 340, L = 46, R = 14, T = 30, Bm = 40;
    var X = M.linear(7, 13, L, W - R), Y = M.linear(1.85, 3.4, H - Bm, T);
    var svg = M.svgBox(h("div"), W, H, t("scale.title"));
    var stN = M.stat(t("scale.nOpt"), "accent"), stD = M.stat(t("scale.dOpt")), stR = M.stat(t("scale.ratio")), stL = M.stat(t("scale.lOpt"));

    stage.appendChild(M.controls(M.slider({ label: t("scale.compute") + " C", min: 18, max: 26, step: 0.01, value: logC, wide: true,
      format: function (v) { return sci(Math.pow(10, v)) + " FLOP"; }, onInput: function (v) { logC = v; draw(); } }).el));
    stage.appendChild(svg.parentNode);
    stage.appendChild(h("div", { class: "stats" }, stN.el, stD.el, stR.el, stL.el));

    function curve(C) {
      var pts = [], best = null;
      for (var lx = 7; lx <= 13.0001; lx += 0.02) {
        var N = Math.pow(10, lx), D = C / (6 * N);
        if (D < 1e6) break;
        var l = loss(N, D);
        if (!best || l < best.l) best = { N: N, D: D, l: l };
        pts.push([X(lx), Y(Math.min(l, 3.45))]);
      }
      return { pts: pts, best: best };
    }

    function draw() {
      M.clear(svg);
      svg.appendChild(M.axes({ x: X, y: Y, x0: L, x1: W - R, y0: H - Bm, y1: T, xTicks: [7, 8, 9, 10, 11, 12, 13],
        yTicks: [2, 2.5, 3], xFmt: function (v) { return "10" + String(v).split("").map(function (c) { return "⁰¹²³⁴⁵⁶⁷⁸⁹"[+c]; }).join(""); },
        yFmt: function (v) { return M.fmt(v, 1); }, xLabel: t("scale.xLabel"), yLabel: t("scale.yLabel") }));
      svg.appendChild(s("line", { x1: L, x2: W - R, y1: Y(E), y2: Y(E), class: "curve-muted" }));
      svg.appendChild(s("text", { x: W - R, y: Y(E) - 5, "text-anchor": "end" }, t("scale.irreducible", { e: M.fmt(E, 2) })));
      var opt = [];
      for (var c = 18; c <= 26; c++) {
        var cv = curve(Math.pow(10, c));
        svg.appendChild(s("path", { d: M.path(cv.pts), class: "iso-curve" }));
        if (cv.best) opt.push([X(Math.log10(cv.best.N)), Y(cv.best.l)]);
        if (cv.pts.length) svg.appendChild(s("text", { x: cv.pts[0][0] + 2, y: cv.pts[0][1] - 4, class: "iso-label" }, "10" + "⁰¹²³⁴⁵⁶⁷⁸⁹"[Math.floor(c / 10)] + "⁰¹²³⁴⁵⁶⁷⁸⁹"[c % 10]));
      }
      svg.appendChild(s("path", { d: M.path(opt), class: "opt-line" }));
      var cur = curve(Math.pow(10, logC));
      svg.appendChild(s("path", { d: M.path(cur.pts), class: "curve" }));
      if (cur.best) {
        svg.appendChild(s("circle", { cx: X(Math.log10(cur.best.N)), cy: Y(cur.best.l), r: 6, class: "pt-star" }));
        stN.set(human(cur.best.N));
        stD.set(human(cur.best.D) + " " + t("scale.tokens"));
        stR.set(M.fmt(cur.best.D / cur.best.N, 1));
        stL.set(M.fmt(cur.best.l, 3));
      }
      MODELS.forEach(function (m) {
        var l = loss(m.N, m.D), x = X(Math.log10(m.N)), y = Y(l);
        svg.appendChild(s("circle", { cx: x, cy: y, r: 4.5, class: "pt-b" }));
        svg.appendChild(s("text", { x: x + m.dx, y: y + m.dy, "text-anchor": m.anchor, class: "label-strong" },
          m.name + " · " + M.fmt(l, 2)));
      });
    }

    draw();
  });
})();
