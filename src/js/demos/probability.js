// Chapter 01 — a biased coin: law of large numbers (left) and Bayesian updating (right).
(function () {
  "use strict";
  var M = window.MOA, h = M.h, s = M.s, t = M.t;

  var PRIORS = { uniform: [1, 1], fair: [20, 20], heads: [8, 2] };
  var W = 360, H = 230, L = 42, R = 12, T = 18, B = 40;

  M.register("probability/coin", function (stage) {
    var rand = M.rng(Date.now() % 100000);
    var p, flips, heads, revealed, prior = "uniform";

    var left = M.svgBox(h("div"), W, H, t("coin.freqTitle"));
    var right = M.svgBox(h("div"), W, H, t("coin.postTitle"));
    var strip = h("div", { class: "coin-strip", "aria-hidden": "true" });

    var stN = M.stat(t("coin.flips")), stK = M.stat(t("coin.heads")), stF = M.stat(t("coin.freq"), "accent");
    var stB = M.stat(t("coin.bayes")), stI = M.stat(t("coin.interval")), stP = M.stat(t("coin.truth"));

    var revealBtn = M.button(t("coin.reveal"), function () { revealed = !revealed; draw(); });
    var priorSel = M.select({
      label: t("coin.prior"), value: prior,
      options: ["uniform", "fair", "heads"].map(function (k) { return { value: k, label: t("coin.priors." + k) }; }),
      onChange: function (v) { prior = v; draw(); },
    });

    stage.appendChild(M.controls(
      h("div", { class: "btn-row" },
        M.button(t("coin.flip1"), function () { flip(1); }, "primary"),
        M.button("×10", function () { flip(10); }),
        M.button("×100", function () { flip(100); }),
        M.button("×1000", function () { flip(1000); })),
      priorSel.el,
      h("div", { class: "btn-row" }, revealBtn, M.button(t("coin.newCoin"), function () { reset(); draw(); }))));
    stage.appendChild(strip);
    stage.appendChild(h("div", { class: "panel-grid" },
      h("div", {}, h("p", { class: "panel-label" }, t("coin.freqTitle")), left.parentNode),
      h("div", {}, h("p", { class: "panel-label" }, t("coin.postTitle")), right.parentNode)));
    stage.appendChild(h("div", { class: "stats" }, stN.el, stK.el, stF.el, stB.el, stI.el, stP.el));

    function reset() {
      p = 0.15 + 0.7 * rand();
      if (Math.abs(p - 0.5) < 0.08) p += p < 0.5 ? -0.1 : 0.1; // make the bias noticeable
      flips = [];
      heads = 0;
      revealed = false;
    }

    function flip(n) {
      for (var i = 0; i < n; i++) {
        var hd = rand() < p ? 1 : 0;
        heads += hd;
        flips.push(hd);
      }
      draw();
    }

    function posterior() {
      var ab = PRIORS[prior], a = ab[0] + heads, b = ab[1] + flips.length - heads;
      var xs = [], ys = [], N = 400, maxLog = -Infinity;
      for (var i = 0; i <= N; i++) {
        var x = Math.min(Math.max(i / N, 1e-6), 1 - 1e-6);
        var lg = (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x);
        xs.push(x);
        ys.push(lg);
        if (lg > maxLog) maxLog = lg;
      }
      var sum = 0;
      ys = ys.map(function (v) { var e = Math.exp(v - maxLog); sum += e; return e; });
      ys = ys.map(function (v) { return v / (sum / N); }); // density: integrates to ~1 over [0, 1]
      var cdf = 0, lo = 0, hi = 1;
      for (var j = 0; j <= N; j++) {
        var prev = cdf;
        cdf += ys[j] / N;
        if (prev < 0.025 && cdf >= 0.025) lo = xs[j];
        if (prev < 0.975 && cdf >= 0.975) hi = xs[j];
      }
      return { xs: xs, ys: ys, mean: a / (a + b), lo: lo, hi: hi };
    }

    function drawLeft() {
      M.clear(left);
      var n = flips.length;
      var maxN = Math.max(10, Math.pow(10, Math.ceil(Math.log10(Math.max(n, 1)))));
      var x = M.linear(0, Math.log10(maxN), L, W - R);
      var y = M.linear(0, 1, H - B, T);
      var ticks = [];
      for (var e = 0; Math.pow(10, e) <= maxN; e++) ticks.push(e);
      left.appendChild(M.axes({
        x: x, y: y, x0: L, x1: W - R, y0: H - B, y1: T,
        xTicks: ticks, yTicks: [0, 0.25, 0.5, 0.75, 1],
        xFmt: function (v) { return M.fmt(Math.pow(10, v), 0); },
        yFmt: function (v) { return M.fmt(v, 2); },
        xLabel: t("coin.xLabel"),
      }));
      if (revealed) {
        left.appendChild(s("line", { class: "curve-muted", x1: L, x2: W - R, y1: y(p), y2: y(p) }));
        left.appendChild(s("text", { x: W - R, y: y(p) - 5, "text-anchor": "end", class: "label-strong" }, "p = " + M.fmt(p, 3)));
      }
      if (!n) {
        left.appendChild(s("text", { x: (L + W - R) / 2, y: (T + H - B) / 2, "text-anchor": "middle" }, t("coin.empty")));
        return;
      }
      var pts = [], k = 0, next = 1;
      for (var i = 0; i < n; i++) {
        k += flips[i];
        if (i + 1 >= next || i === n - 1) {
          pts.push([x(Math.log10(i + 1)), y(k / (i + 1))]);
          next = Math.max(i + 2, Math.floor((i + 1) * 1.02));
        }
      }
      left.appendChild(s("path", { class: "curve", d: M.path(pts) }));
      var lastPt = pts[pts.length - 1];
      left.appendChild(s("circle", { cx: lastPt[0], cy: lastPt[1], r: 4, class: "bar" }));
    }

    function drawRight(post) {
      M.clear(right);
      var x = M.linear(0, 1, L, W - R);
      var ymax = Math.max.apply(null, post.ys) * 1.12;
      var y = M.linear(0, ymax, H - B, T);
      right.appendChild(M.axes({
        x: x, y: y, x0: L, x1: W - R, y0: H - B, y1: T,
        xTicks: [0, 0.25, 0.5, 0.75, 1], yTicks: [],
        xFmt: function (v) { return M.fmt(v, 2); },
        xLabel: t("coin.pLabel"),
      }));
      var lo = x(post.lo), hi = x(post.hi);
      right.appendChild(s("rect", { x: lo, y: T, width: Math.max(1, hi - lo), height: H - B - T, class: "area" }));
      var pts = post.xs.map(function (v, i) { return [x(v), y(post.ys[i])]; });
      var area = M.path(pts) + "L" + x(1) + "," + y(0) + "L" + x(0) + "," + y(0) + "Z";
      right.appendChild(s("path", { d: area, class: "bar-soft", opacity: 0.35 }));
      right.appendChild(s("path", { d: M.path(pts), class: "curve" }));
      if (revealed) {
        right.appendChild(s("line", { class: "curve-muted", x1: x(p), x2: x(p), y1: T, y2: H - B }));
        right.appendChild(s("text", { x: x(p) + 4, y: T + 10, class: "label-strong" }, "p"));
      }
    }

    function draw() {
      var n = flips.length;
      var post = posterior();
      drawLeft();
      drawRight(post);
      stN.set(M.fmt(n, 0));
      stK.set(M.fmt(heads, 0));
      stF.set(n ? M.fmt(heads / n, 3) : "—");
      stB.set(M.fmt(post.mean, 3));
      stI.set("[" + M.fmt(post.lo, 2) + ", " + M.fmt(post.hi, 2) + "]");
      stP.set(revealed ? M.fmt(p, 3) : "?");
      revealBtn.textContent = revealed ? t("coin.hide") : t("coin.reveal");
      M.clear(strip);
      flips.slice(-40).forEach(function (f) {
        strip.appendChild(h("span", { class: f ? "c-head" : "c-tail", title: f ? t("coin.head") : t("coin.tail") }, f ? "C" : "X"));
      });
    }

    reset();
    draw();
  });
})();
