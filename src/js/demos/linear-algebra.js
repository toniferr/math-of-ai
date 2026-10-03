// Chapter 03 — toy word embeddings with analogies, and a 2x2 matrix transforming the plane.
(function () {
  "use strict";
  var M = window.MOA, h = M.h, s = M.s, t = M.t;

  // ------------------------------------------------------------------ embeddings

  // Hand-placed 2D vectors: x ~ "masculine <-> feminine", y ~ "status / age"; animals in their own region.
  var WORDS = {
    man: [-1.5, 0.5], woman: [1.45, 0.55],
    king: [-1.45, 2.55], queen: [1.5, 2.45],
    prince: [-1.65, 1.6], princess: [1.35, 1.65],
    boy: [-1.3, -0.65], girl: [1.7, -0.55],
    cat: [-2.3, -2.3], kitten: [-1.5, -3.05],
    dog: [0.55, -2.25], puppy: [1.4, -3.0],
  };
  function word(id) { return t("emb.words." + id); }

  M.register("linear-algebra/embeddings", function (stage) {
    var names = Object.keys(WORDS);
    var W = 560, H = 380, pad = 30;
    var x = M.linear(-3.2, 3.2, pad, W - pad), y = M.linear(-3.6, 3.2, H - pad, pad);
    var a = "king", b = "man", c = "woman";

    function sel(label, value, set) {
      return M.select({ label: label, value: value, options: names.map(function (n) { return { value: n, label: word(n) }; }),
        onChange: function (v) { set(v); draw(); } });
    }
    var selA = sel("A", a, function (v) { a = v; }), selB = sel("− B", b, function (v) { b = v; }), selC = sel("+ C", c, function (v) { c = v; });
    var result = h("p", { class: "demo-title", "aria-live": "polite" });
    var svg = M.svgBox(h("div"), W, H, t("emb.title"));

    stage.appendChild(M.controls(selA.el, selB.el, selC.el, h("div", { class: "btn-row" },
      M.button(t("emb.ex1"), function () { setABC("king", "man", "woman"); }),
      M.button(t("emb.ex2"), function () { setABC("kitten", "cat", "dog"); }),
      M.button(t("emb.ex3"), function () { setABC("girl", "woman", "man"); }))));
    stage.appendChild(result);
    stage.appendChild(svg.parentNode);

    function setABC(na, nb, nc) { a = na; b = nb; c = nc; selA.set(a); selB.set(b); selC.set(c); draw(); }

    function arrow(x1, y1, x2, y2, cls, dashed) {
      var g = s("g", { class: cls });
      g.appendChild(s("line", { x1: x1, y1: y1, x2: x2, y2: y2, "stroke-dasharray": dashed ? "5 4" : null }));
      var ang = Math.atan2(y2 - y1, x2 - x1), L = 9;
      g.appendChild(s("path", { d: "M" + x2 + "," + y2 + "L" + (x2 - L * Math.cos(ang - 0.4)) + "," + (y2 - L * Math.sin(ang - 0.4)) +
        "L" + (x2 - L * Math.cos(ang + 0.4)) + "," + (y2 - L * Math.sin(ang + 0.4)) + "Z" }));
      return g;
    }

    function draw() {
      M.clear(svg);
      svg.appendChild(s("line", { class: "gridline", x1: x(-3.2), x2: x(3.2), y1: y(0), y2: y(0) }));
      svg.appendChild(s("line", { class: "gridline", x1: x(0), x2: x(0), y1: y(-3.6), y2: y(3.2) }));
      var va = WORDS[a], vb = WORDS[b], vc = WORDS[c];
      var r = [va[0] - vb[0] + vc[0], va[1] - vb[1] + vc[1]];
      var best = null, bestD = Infinity;
      names.forEach(function (n) {
        if (n === a || n === b || n === c) return;
        var d = Math.hypot(WORDS[n][0] - r[0], WORDS[n][1] - r[1]);
        if (d < bestD) { bestD = d; best = n; }
      });

      svg.appendChild(arrow(x(vb[0]), y(vb[1]), x(va[0]), y(va[1]), "vec vec-1"));
      svg.appendChild(arrow(x(vc[0]), y(vc[1]), x(r[0]), y(r[1]), "vec vec-1", true));

      names.forEach(function (n) {
        var v = WORDS[n];
        var role = n === a ? "A" : n === b ? "B" : n === c ? "C" : n === best ? "best" : "";
        var g = s("g", { class: "word " + (role ? "word-" + role.toLowerCase() : ""), tabindex: "0", role: "button",
          "aria-label": word(n), onclick: function () { setABC(a, b, n); } });
        g.appendChild(s("circle", { cx: x(v[0]), cy: y(v[1]), r: role ? 6 : 4.5 }));
        g.appendChild(s("text", { x: x(v[0]) + 9, y: y(v[1]) + 4 }, word(n) + (role && role !== "best" ? " (" + role + ")" : "")));
        svg.appendChild(g);
      });
      svg.appendChild(s("circle", { cx: x(r[0]), cy: y(r[1]), r: 8, class: "result-ring" }));

      result.textContent = t("emb.result", { a: word(a), b: word(b), c: word(c), best: word(best), d: M.fmt(bestD, 2) });
    }

    draw();
  });

  // ------------------------------------------------------------------ 2x2 transformation

  var PRESETS = {
    identity: [1, 0, 0, 1],
    rotate: [Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6), Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)],
    scale: [1.6, 0, 0, 0.6],
    shear: [1, 1, 0, 1],
    reflect: [-1, 0, 0, 1],
    singular: [1, 2, 0.5, 1],
  };
  // An "F": asymmetric, so reflections are obvious.
  var SHAPE = [[0.2, 0.2], [0.45, 0.2], [0.45, 0.75], [0.85, 0.75], [0.85, 1], [0.45, 1], [0.45, 1.25], [0.95, 1.25],
    [0.95, 1.5], [0.2, 1.5]];

  M.register("linear-algebra/transform", function (stage) {
    var m = PRESETS.shear.slice();
    var W = 520, H = 400;
    var x = M.linear(-3.3, 3.3, 0, W), y = M.linear(-2.55, 2.55, H, 0);
    var svgWrap = h("div");
    var svg = M.svgBox(svgWrap, W, H, t("tr.title"));
    var stDet = M.stat(t("tr.det"), "accent"), stNote = M.stat(t("tr.kind"));
    var matrixEl = h("div", { class: "matrix-view", "aria-live": "polite" });

    var sliders = ["a", "b", "c", "d"].map(function (name, i) {
      return M.slider({ label: name, min: -2, max: 2, step: 0.05, value: m[i],
        format: function (v) { return M.fmt(v, 2); }, onInput: function (v) { m[i] = v; draw(); } });
    });
    var presetSeg = M.select({
      label: t("tr.preset"), value: "shear",
      options: Object.keys(PRESETS).map(function (k) { return { value: k, label: t("tr.presets." + k) }; }),
      onChange: function (v) { m = PRESETS[v].slice(); sliders.forEach(function (sl, i) { sl.set(m[i], true); }); draw(); },
    });

    stage.appendChild(h("div", { class: "panel-grid tr-grid" },
      svgWrap,
      h("div", {}, presetSeg.el, matrixEl, h("div", { class: "tr-sliders" }, sliders.map(function (sl) { return sl.el; })),
        h("div", { class: "stats" }, stDet.el, stNote.el))));

    function T(p) { return [m[0] * p[0] + m[1] * p[1], m[2] * p[0] + m[3] * p[1]]; }
    function P(p) { return x(p[0]) + "," + y(p[1]); }

    function draw() {
      M.clear(svg);
      // Original grid, faint.
      for (var k = -6; k <= 6; k++) {
        svg.appendChild(s("line", { class: "gridline", x1: x(k), x2: x(k), y1: y(-3), y2: y(3) }));
        svg.appendChild(s("line", { class: "gridline", x1: x(-4), x2: x(4), y1: y(k), y2: y(k) }));
      }
      // Transformed grid.
      var g = s("g", { class: "tgrid" });
      for (var j = -6; j <= 6; j++) {
        var p1 = T([j, -6]), p2 = T([j, 6]), q1 = T([-6, j]), q2 = T([6, j]);
        g.appendChild(s("line", { x1: x(p1[0]), y1: y(p1[1]), x2: x(p2[0]), y2: y(p2[1]), class: j === 0 ? "axis0" : "" }));
        g.appendChild(s("line", { x1: x(q1[0]), y1: y(q1[1]), x2: x(q2[0]), y2: y(q2[1]), class: j === 0 ? "axis0" : "" }));
      }
      svg.appendChild(g);
      // Image of the unit square: its area is |det|.
      var sq = [[0, 0], [1, 0], [1, 1], [0, 1]].map(T);
      svg.appendChild(s("polygon", { points: sq.map(P).join(" "), class: "unit-sq" }));
      svg.appendChild(s("polygon", { points: SHAPE.map(T).map(P).join(" "), class: "shape-f" }));
      // Basis vectors.
      [[T([1, 0]), "vec vec-1", "e₁"], [T([0, 1]), "vec vec-2", "e₂"]].forEach(function (b) {
        var gg = s("g", { class: b[1] });
        var X2 = x(b[0][0]), Y2 = y(b[0][1]), X1 = x(0), Y1 = y(0);
        gg.appendChild(s("line", { x1: X1, y1: Y1, x2: X2, y2: Y2 }));
        var ang = Math.atan2(Y2 - Y1, X2 - X1), L = 10;
        if (Math.hypot(X2 - X1, Y2 - Y1) > 4) {
          gg.appendChild(s("path", { d: "M" + X2 + "," + Y2 + "L" + (X2 - L * Math.cos(ang - 0.4)) + "," + (Y2 - L * Math.sin(ang - 0.4)) +
            "L" + (X2 - L * Math.cos(ang + 0.4)) + "," + (Y2 - L * Math.sin(ang + 0.4)) + "Z" }));
        }
        gg.appendChild(s("text", { x: X2 + 6, y: Y2 - 6 }, b[2]));
        svg.appendChild(gg);
      });

      var det = m[0] * m[3] - m[1] * m[2];
      stDet.set(M.fmt(det, 2));
      stNote.set(Math.abs(det) < 0.02 ? t("tr.collapse") : det < 0 ? t("tr.flip") : t("tr.keep"));
      M.clear(matrixEl);
      matrixEl.appendChild(h("span", { class: "mv-bracket" }, "("));
      matrixEl.appendChild(h("span", { class: "mv-grid" },
        h("span", { class: "k1" }, M.fmt(m[0], 2)), h("span", { class: "k2" }, M.fmt(m[1], 2)),
        h("span", { class: "k1" }, M.fmt(m[2], 2)), h("span", { class: "k2" }, M.fmt(m[3], 2))));
      matrixEl.appendChild(h("span", { class: "mv-bracket" }, ")"));
    }

    draw();
  });
})();
