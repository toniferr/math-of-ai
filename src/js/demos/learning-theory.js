// Chapter 07 — under/overfitting with polynomials, and shattering points with lines (VC dimension).
(function () {
  "use strict";
  var M = window.MOA, h = M.h, s = M.s, t = M.t;

  // ------------------------------------------------------------------ polynomial fit

  function truth(x) { return 0.8 * Math.sin(Math.PI * x) + 0.3 * x; }

  // Legendre polynomials P_0..P_deg at x: a well-conditioned basis on [-1, 1].
  function legendre(x, deg) {
    var out = [1];
    if (deg >= 1) out.push(x);
    for (var k = 1; k < deg; k++) out.push(((2 * k + 1) * x * out[k] - k * out[k - 1]) / (k + 1));
    return out;
  }

  // Least squares in the Legendre basis with a tiny ridge term, solved by Gaussian elimination.
  function polyfit(xs, ys, deg) {
    var n = deg + 1, A = [], bvec = [];
    for (var i = 0; i < n; i++) { A.push(new Array(n).fill(0)); bvec.push(0); }
    xs.forEach(function (x, k) {
      var pw = legendre(x, deg);
      for (var r = 0; r < n; r++) {
        bvec[r] += pw[r] * ys[k];
        for (var c = 0; c < n; c++) A[r][c] += pw[r] * pw[c];
      }
    });
    for (var d = 0; d < n; d++) A[d][d] += 1e-7;
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r2 = col + 1; r2 < n; r2++) if (Math.abs(A[r2][col]) > Math.abs(A[piv][col])) piv = r2;
      var tmp = A[col]; A[col] = A[piv]; A[piv] = tmp;
      var tb = bvec[col]; bvec[col] = bvec[piv]; bvec[piv] = tb;
      for (var r3 = col + 1; r3 < n; r3++) {
        var f = A[r3][col] / A[col][col];
        for (var c2 = col; c2 < n; c2++) A[r3][c2] -= f * A[col][c2];
        bvec[r3] -= f * bvec[col];
      }
    }
    var coef = new Array(n).fill(0);
    for (var r4 = n - 1; r4 >= 0; r4--) {
      var sum = bvec[r4];
      for (var c3 = r4 + 1; c3 < n; c3++) sum -= A[r4][c3] * coef[c3];
      coef[r4] = sum / A[r4][r4];
    }
    return function (x) { var b = legendre(x, deg), y = 0; for (var i = 0; i < coef.length; i++) y += coef[i] * b[i]; return y; };
  }

  M.register("learning-theory/overfitting", function (stage) {
    var rand = M.rng(11);
    var n = 12, deg = 3, noise = 0.25, MAXD = 15;
    var train, test, curves;

    var left = M.svgBox(h("div"), 340, 250, t("ov.fit"));
    var right = M.svgBox(h("div"), 340, 250, t("ov.errors"));
    var stTr = M.stat(t("ov.train")), stTe = M.stat(t("ov.test"), "accent"), stP = M.stat(t("ov.params"));

    stage.appendChild(M.controls(
      M.slider({ label: t("ov.degree") + " d", min: 0, max: MAXD, step: 1, value: deg, format: function (v) { return M.fmt(v, 0); },
        onInput: function (v) { deg = v; draw(); } }).el,
      M.slider({ label: t("ov.points") + " n", min: 6, max: 60, step: 1, value: n, format: function (v) { return M.fmt(v, 0); },
        onInput: function (v) { n = v; sample(); } }).el,
      M.button(t("ov.resample"), function () { sample(); }, "primary")));
    stage.appendChild(h("div", { class: "panel-grid" },
      h("div", {}, h("p", { class: "panel-label" }, t("ov.fit")), left.parentNode),
      h("div", {}, h("p", { class: "panel-label" }, t("ov.errors")), right.parentNode)));
    stage.appendChild(h("div", { class: "stats" }, stTr.el, stTe.el, stP.el));

    function mse(fn, pts) { return pts.reduce(function (a, p) { var e = fn(p[0]) - p[1]; return a + e * e; }, 0) / pts.length; }

    function sample() {
      train = []; test = [];
      for (var i = 0; i < n; i++) { var x = -1 + 2 * rand(); train.push([x, truth(x) + noise * M.gauss(rand)]); }
      for (var j = 0; j < 300; j++) { var x2 = -1 + 2 * rand(); test.push([x2, truth(x2) + noise * M.gauss(rand)]); }
      curves = [];
      for (var d = 0; d <= MAXD; d++) {
        var fn = polyfit(train.map(function (p) { return p[0]; }), train.map(function (p) { return p[1]; }), d);
        curves.push({ fn: fn, tr: mse(fn, train), te: mse(fn, test) });
      }
      draw();
    }

    function draw() {
      var cur = curves[deg];
      M.clear(left);
      var X = M.linear(-1, 1, 30, 330), Y = M.linear(-1.8, 1.8, 230, 10);
      left.appendChild(M.axes({ x: X, y: Y, x0: 30, x1: 330, y0: 230, y1: 10, xTicks: [-1, 0, 1], yTicks: [-1, 0, 1],
        yFmt: function (v) { return M.fmt(v, 0); } }));
      test.slice(0, 80).forEach(function (p) { left.appendChild(s("circle", { cx: X(p[0]), cy: Y(p[1]), r: 2, class: "pt-test" })); });
      var tp = [], fp = [];
      for (var i = 0; i <= 200; i++) {
        var x = -1 + 2 * i / 200;
        tp.push([X(x), Y(truth(x))]);
        fp.push([X(x), M.clamp(Y(cur.fn(x)), -20, 270)]);
      }
      var clip = s("clipPath", { id: "ovclip" }, s("rect", { x: 30, y: 10, width: 300, height: 220 }));
      left.appendChild(clip);
      left.appendChild(s("path", { d: M.path(tp), class: "curve-muted" }));
      left.appendChild(s("path", { d: M.path(fp), class: "curve", "clip-path": "url(#ovclip)" }));
      train.forEach(function (p) { left.appendChild(s("circle", { cx: X(p[0]), cy: Y(p[1]), r: 4.5, class: "pt-a" })); });

      M.clear(right);
      var DX = M.linear(0, MAXD, 40, 330), DY = M.linear(-3, 1, 220, 10); // log10 of MSE
      right.appendChild(M.axes({ x: DX, y: DY, x0: 40, x1: 330, y0: 220, y1: 10, xTicks: [0, 3, 6, 9, 12, 15],
        yTicks: [-3, -2, -1, 0, 1], yFmt: function (v) { return v === 0 ? "1" : "10" + (v < 0 ? "⁻" + "¹²³"[-v - 1] : "¹"); },
        xLabel: t("ov.degree") }));
      function lg(v) { return M.clamp(Math.log10(Math.max(v, 1e-3)), -3, 1); }
      right.appendChild(s("path", { d: M.path(curves.map(function (c, d) { return [DX(d), DY(lg(c.tr))]; })), class: "curve-2" }));
      right.appendChild(s("path", { d: M.path(curves.map(function (c, d) { return [DX(d), DY(lg(c.te))]; })), class: "curve" }));
      right.appendChild(s("line", { x1: DX(deg), x2: DX(deg), y1: 10, y2: 220, class: "curve-muted" }));
      right.appendChild(s("line", { x1: DX(n - 1), x2: DX(n - 1), y1: 10, y2: 220, class: "interp-line" }));
      if (n - 1 <= MAXD) right.appendChild(s("text", { x: DX(n - 1) + 4, y: 22 }, t("ov.interp")));
      right.appendChild(s("text", { x: 46, y: 236 - 30, class: "legend-2" }, "— " + t("ov.train")));
      right.appendChild(s("text", { x: 46, y: 236 - 16, class: "legend-1" }, "— " + t("ov.test")));

      stTr.set(M.fmt(cur.tr, 4));
      stTe.set(M.fmt(cur.te, 4));
      stP.set(M.fmt(deg + 1, 0));
    }

    sample();
  });

  // ------------------------------------------------------------------ shattering

  // Is this labelling linearly separable? A perceptron with bias converges iff it is (we cap the epochs).
  function separate(pts, labels) {
    var w = [0, 0], b = 0;
    for (var ep = 0; ep < 3000; ep++) {
      var errors = 0;
      for (var i = 0; i < pts.length; i++) {
        var y = labels[i];
        if (y * (w[0] * pts[i][0] + w[1] * pts[i][1] + b) <= 0) {
          w[0] += y * pts[i][0]; w[1] += y * pts[i][1]; b += y;
          errors++;
        }
      }
      if (!errors) return { w: w, b: b };
    }
    return null;
  }

  M.register("learning-theory/shatter", function (stage) {
    var all = [[-0.55, -0.45], [0.6, -0.35], [0.05, 0.6], [0.55, 0.55]];
    var n = 3;
    var S = 220;
    var X = M.linear(-1, 1, 10, S - 10), Y = M.linear(-1, 1, S - 10, 10);
    var main = M.svgBox(h("div", { class: "shatter-main" }), S, S, t("vc.title"));
    var grid = h("div", { class: "shatter-grid" });
    var verdict = h("p", { class: "demo-title", "aria-live": "polite" });
    var dragging = -1;

    stage.appendChild(M.controls(M.segmented({ label: t("vc.points"), value: "3",
      options: [{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }],
      onChange: function (v) { n = +v; draw(); } }).el, h("span", { class: "demo-hint" }, t("vc.hint"))));
    stage.appendChild(h("div", { class: "shatter-layout" }, main.parentNode, h("div", {}, verdict, grid)));

    function fromEvent(ev) {
      var r = main.getBoundingClientRect();
      return [X.invert((ev.clientX - r.left) * S / r.width), Y.invert((ev.clientY - r.top) * S / r.height)];
    }
    main.addEventListener("pointerdown", function (ev) {
      var p = fromEvent(ev), best = -1, bd = 0.15;
      for (var i = 0; i < n; i++) { var d = Math.hypot(all[i][0] - p[0], all[i][1] - p[1]); if (d < bd) { bd = d; best = i; } }
      if (best >= 0) { dragging = best; main.setPointerCapture(ev.pointerId); ev.preventDefault(); }
    });
    main.addEventListener("pointermove", function (ev) {
      if (dragging < 0) return;
      var p = fromEvent(ev);
      all[dragging] = [M.clamp(p[0], -0.95, 0.95), M.clamp(p[1], -0.95, 0.95)];
      draw();
    });
    main.addEventListener("pointerup", function () { dragging = -1; });

    function lineSeg(sep, x, y) {
      // Clip w·p + b = 0 to the square [-1, 1]^2.
      var w = sep.w, b = sep.b, pts = [];
      if (Math.abs(w[1]) > 1e-9) {
        [-1, 1].forEach(function (xx) { var yy = -(w[0] * xx + b) / w[1]; if (yy >= -1 && yy <= 1) pts.push([xx, yy]); });
      }
      if (Math.abs(w[0]) > 1e-9) {
        [-1, 1].forEach(function (yy) { var xx = -(w[1] * yy + b) / w[0]; if (xx >= -1 && xx <= 1) pts.push([xx, yy]); });
      }
      if (pts.length < 2) return null;
      return s("line", { x1: x(pts[0][0]), y1: y(pts[0][1]), x2: x(pts[1][0]), y2: y(pts[1][1]), class: "sep-line" });
    }

    function draw() {
      var pts = all.slice(0, n);
      M.clear(main);
      main.appendChild(s("rect", { x: 10, y: 10, width: S - 20, height: S - 20, class: "frame" }));
      pts.forEach(function (p, i) {
        main.appendChild(s("circle", { cx: X(p[0]), cy: Y(p[1]), r: 9, class: "drag-pt" }));
        main.appendChild(s("text", { x: X(p[0]), y: Y(p[1]) + 4, "text-anchor": "middle", class: "drag-lbl" }, String(i + 1)));
      });

      M.clear(grid);
      var total = Math.pow(2, n), ok = 0;
      var m = 70, mx = M.linear(-1, 1, 4, m - 4), my = M.linear(-1, 1, m - 4, 4);
      for (var mask = 0; mask < total; mask++) {
        var labels = pts.map(function (_, i) { return (mask >> i) & 1 ? 1 : -1; });
        var sep = separate(pts, labels);
        if (sep) ok++;
        var mini = s("svg", { viewBox: "0 0 " + m + " " + m, class: "demo-svg mini" + (sep ? "" : " fail"), role: "img",
          "aria-label": sep ? t("vc.yes") : t("vc.no") });
        mini.appendChild(s("rect", { x: 1, y: 1, width: m - 2, height: m - 2, rx: 6, class: "frame" }));
        if (sep) { var ln = lineSeg(sep, mx, my); if (ln) mini.appendChild(ln); }
        pts.forEach(function (p, i) { mini.appendChild(s("circle", { cx: mx(p[0]), cy: my(p[1]), r: 5, class: labels[i] > 0 ? "pt-a" : "pt-b" })); });
        if (!sep) mini.appendChild(s("text", { x: m - 8, y: 14, "text-anchor": "end", class: "fail-mark" }, "✗"));
        grid.appendChild(mini);
      }
      verdict.textContent = t(ok === total ? "vc.shattered" : "vc.notShattered", { ok: ok, total: total, n: n });
    }

    draw();
  });
})();
