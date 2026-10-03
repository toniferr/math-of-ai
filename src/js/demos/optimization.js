// Chapter 05 — gradient descent on 2D landscapes, and SGD fitting a line.
(function () {
  "use strict";
  var M = window.MOA, h = M.h, s = M.s, t = M.t;

  function well(x, y, A, cx, cy, sc) {
    var e = A * Math.exp(-((x - cx) * (x - cx) + (y - cy) * (y - cy)) / sc);
    return { f: e, gx: e * (-2 * (x - cx) / sc), gy: e * (-2 * (y - cy) / sc) };
  }

  var LANDSCAPES = {
    bowl: {
      x: [-3, 3], y: [-2, 2], start: [-2.6, 1.3], eta: 0.15, gamma: 0.45,
      f: function (x, y) { return 0.5 * (x * x + 10 * y * y); },
      g: function (x, y) { return [x, 10 * y]; },
    },
    banana: {
      x: [-2.4, 2.4], y: [-1.2, 2.0], start: [-1.7, 1.7], eta: 0.015, gamma: 0.35,
      f: function (x, y) { return (1 - x) * (1 - x) + 10 * (y - x * x) * (y - x * x); },
      g: function (x, y) { return [-2 * (1 - x) - 40 * x * (y - x * x), 20 * (y - x * x)]; },
    },
    wells: {
      x: [-3, 3], y: [-2, 2], start: [0.1, -1.8], eta: 0.25, gamma: 1,
      f: function (x, y) { return this.parts(x, y).f; },
      g: function (x, y) { var p = this.parts(x, y); return [p.gx, p.gy]; },
      parts: function (x, y) {
        var ws = [well(x, y, -1.6, 1.2, 0.4, 0.8), well(x, y, -1.1, -1.4, -0.7, 0.5), well(x, y, -0.8, -0.7, 1.2, 0.35)];
        var r = { f: 0.05 * (x * x + y * y), gx: 0.1 * x, gy: 0.1 * y };
        ws.forEach(function (w) { r.f += w.f; r.gx += w.gx; r.gy += w.gy; });
        return r;
      },
    },
  };

  M.register("optimization/descent", function (stage) {
    var name = "bowl", land = LANDSCAPES[name];
    var eta = land.eta, beta = 0;
    var path, vel, iter, status;
    var bg = null, bgKey = "";

    var stIt = M.stat(t("gd.iter")), stF = M.stat("f(θ)", "accent"), stG = M.stat("‖∇f‖"), stS = M.stat(t("gd.status"));
    var etaSl = M.slider({ label: "η", min: 0.001, max: 0.5, log: true, value: eta, format: function (v) { return M.fmt(v, 3); },
      onInput: function (v) { eta = v; restart(); } });
    var betaSl = M.slider({ label: t("gd.momentum") + " β", min: 0, max: 0.95, step: 0.05, value: beta,
      onInput: function (v) { beta = v; restart(); } });
    var landSel = M.select({ label: t("gd.landscape"), value: name,
      options: Object.keys(LANDSCAPES).map(function (k) { return { value: k, label: t("gd.lands." + k) }; }),
      onChange: function (v) { name = v; land = LANDSCAPES[v]; eta = land.eta; etaSl.set(eta, true); reset(land.start); cv.redraw(); } });
    var runBtn = M.button(t("gd.run"), function () { anim.toggle(); }, "primary");

    stage.appendChild(M.controls(landSel.el, etaSl.el, betaSl.el));
    var holder = h("div", { class: "canvas-holder" });
    stage.appendChild(holder);
    stage.appendChild(M.controls(h("div", { class: "btn-row" }, runBtn,
      M.button(t("gd.step"), function () { stepOnce(); cv.redraw(); }),
      M.button(t("gd.reset"), function () { anim.stop(); reset(path[0]); cv.redraw(); })),
      h("span", { class: "demo-hint" }, t("gd.hint"))));
    stage.appendChild(h("div", { class: "stats" }, stIt.el, stF.el, stG.el, stS.el));

    var cv = M.canvas(holder, { aspect: 1.5, label: t("gd.title"), draw: draw });
    var anim = M.animator(holder, function () { stepOnce(); stepOnce(); cv.redraw(); return status === "running"; });
    anim.onchange = function (on) { runBtn.textContent = on ? t("gd.pause") : t("gd.run"); };

    cv.canvas.addEventListener("click", function (ev) {
      var p = cv.toLocal(ev);
      var X = M.linear(0, cv.width, land.x[0], land.x[1]), Y = M.linear(0, cv.height, land.y[1], land.y[0]);
      reset([X(p.x), Y(p.y)]);
      cv.redraw();
      anim.start();
    });

    function reset(start) {
      path = [start.slice()];
      vel = [0, 0];
      iter = 0;
      status = "running";
      updateStats();
    }

    function restart() { anim.stop(); reset(path[0]); cv.redraw(); }

    function stepOnce() {
      if (status !== "running") return;
      var p = path[path.length - 1];
      var g = land.g(p[0], p[1]);
      vel = [beta * vel[0] - eta * g[0], beta * vel[1] - eta * g[1]];
      var q = [p[0] + vel[0], p[1] + vel[1]];
      path.push(q);
      iter++;
      var gn = Math.hypot(g[0], g[1]);
      if (!isFinite(q[0]) || Math.abs(q[0]) > 1e3 || Math.abs(q[1]) > 1e3) status = "diverged";
      else if (gn < 1e-4 && Math.hypot(vel[0], vel[1]) < 1e-5) status = "converged";
      else if (iter >= 1500) status = "stopped";
      updateStats();
    }

    function updateStats() {
      var p = path[path.length - 1];
      var g = land.g(p[0], p[1]);
      stIt.set(M.fmt(iter, 0));
      stF.set(isFinite(p[0]) && Math.abs(p[0]) < 1e3 ? M.fmt(land.f(p[0], p[1]), 4) : "∞");
      stG.set(isFinite(g[0]) && Math.abs(p[0]) < 1e3 ? M.fmt(Math.hypot(g[0], g[1]), 4) : "∞");
      stS.set(t("gd.states." + status));
    }

    function background(w, hgt) {
      var key = name + w + "x" + hgt + document.documentElement.getAttribute("data-theme");
      if (bg && bgKey === key) return bg;
      bgKey = key;
      bg = document.createElement("canvas");
      var dpr = window.devicePixelRatio || 1;
      bg.width = Math.round(w * dpr);
      bg.height = Math.round(hgt * dpr);
      var c = bg.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      var cell = 3, vals = [], lo = Infinity, hi = -Infinity;
      for (var py = 0; py < hgt; py += cell) {
        for (var px = 0; px < w; px += cell) {
          var x = land.x[0] + (px + cell / 2) / w * (land.x[1] - land.x[0]);
          var y = land.y[1] - (py + cell / 2) / hgt * (land.y[1] - land.y[0]);
          var v = land.f(x, y);
          vals.push(v);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      c.fillStyle = M.color("--bg-figure");
      c.fillRect(0, 0, w, hgt);
      c.fillStyle = M.color("--accent");
      var k = 0;
      for (var qy = 0; qy < hgt; qy += cell) {
        for (var qx = 0; qx < w; qx += cell) {
          var n = Math.pow((vals[k++] - lo) / (hi - lo), land.gamma);
          var band = Math.floor(n * 14) / 14;
          c.globalAlpha = 0.04 + band * 0.62;
          c.fillRect(qx, qy, cell, cell);
        }
      }
      c.globalAlpha = 1;
      return bg;
    }

    function draw(ctx, w, hgt) {
      ctx.drawImage(background(w, hgt), 0, 0, w, hgt);
      var X = M.linear(land.x[0], land.x[1], 0, w), Y = M.linear(land.y[0], land.y[1], hgt, 0);
      var fg = M.color("--fg");
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = fg;
      ctx.fillStyle = fg;
      ctx.beginPath();
      path.forEach(function (p, i) {
        var px = M.clamp(X(p[0]), -50, w + 50), py = M.clamp(Y(p[1]), -50, hgt + 50);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.stroke();
      var step = Math.max(1, Math.floor(path.length / 120));
      path.forEach(function (p, i) {
        if (i % step) return;
        ctx.beginPath();
        ctx.arc(X(p[0]), Y(p[1]), 2.2, 0, 2 * Math.PI);
        ctx.fill();
      });
      var a = path[0], b = path[path.length - 1];
      ctx.strokeStyle = fg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(a[0]), Y(a[1]), 6, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = M.color("--k2");
      ctx.beginPath();
      ctx.arc(M.clamp(X(b[0]), 0, w), M.clamp(Y(b[1]), 0, hgt), 5.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    reset(land.start);
  });

  // ------------------------------------------------------------------ SGD on a line fit

  M.register("optimization/sgd", function (stage) {
    var rand = M.rng(7);
    var N = 40, data = [];
    for (var i = 0; i < N; i++) {
      var xi = -1 + 2 * rand();
      data.push([xi, 1.8 * xi - 0.5 + 0.35 * M.gauss(rand)]);
    }
    var sx = 0, sxx = 0, sy = 0, sxy = 0;
    data.forEach(function (d) { sx += d[0] / N; sxx += d[0] * d[0] / N; sy += d[1] / N; sxy += d[0] * d[1] / N; });
    var det = sxx - sx * sx;
    var wStar = (sxy - sx * sy) / det, bStar = (sxx * sy - sx * sxy) / det;
    function loss(w, b) { return data.reduce(function (a, d) { var e = w * d[0] + b - d[1]; return a + e * e; }, 0) / N; }
    var lStar = loss(wStar, bStar);

    var START = [-1.2, 1.6];
    var theta, trail, batch = 1, eta = 0.08, steps, current = [];
    var stStep = M.stat(t("sgd.steps")), stLoss = M.stat(t("sgd.loss"), "accent"), stW = M.stat("w"), stB = M.stat("b");
    var batchSeg = M.segmented({ label: t("sgd.batch"), value: "1",
      options: [{ value: "1", label: "1" }, { value: "5", label: "5" }, { value: "40", label: t("sgd.full") }],
      onChange: function (v) { batch = +v; reset(); } });
    var etaSl = M.slider({ label: "η", min: 0.01, max: 0.6, log: true, value: eta, format: function (v) { return M.fmt(v, 3); },
      onInput: function (v) { eta = v; reset(); } });
    var runBtn = M.button(t("gd.run"), function () { anim.toggle(); }, "primary");

    var left = M.svgBox(h("div"), 340, 260, t("sgd.data"));
    var right = M.svgBox(h("div"), 340, 260, t("sgd.params"));
    stage.appendChild(M.controls(batchSeg.el, etaSl.el, h("div", { class: "btn-row" }, runBtn,
      M.button(t("gd.reset"), function () { anim.stop(); reset(); }))));
    stage.appendChild(h("div", { class: "panel-grid" },
      h("div", {}, h("p", { class: "panel-label" }, t("sgd.data")), left.parentNode),
      h("div", {}, h("p", { class: "panel-label" }, t("sgd.params")), right.parentNode)));
    stage.appendChild(h("div", { class: "stats" }, stStep.el, stLoss.el, stW.el, stB.el));

    var last = 0;
    var anim = M.animator(stage, function () {
      var now = performance.now();
      if (now - last < 45) return true;
      last = now;
      step();
      draw();
      return steps < 300;
    });
    anim.onchange = function (on) { runBtn.textContent = on ? t("gd.pause") : t("gd.run"); };

    function reset() { theta = START.slice(); trail = [START.slice()]; steps = 0; current = []; draw(); }

    function step() {
      var idx = [];
      if (batch >= N) { for (var k = 0; k < N; k++) idx.push(k); }
      else { for (var j = 0; j < batch; j++) idx.push(Math.floor(rand() * N)); }
      var gw = 0, gb = 0;
      idx.forEach(function (k) { var e = theta[0] * data[k][0] + theta[1] - data[k][1]; gw += 2 * e * data[k][0]; gb += 2 * e; });
      theta = [theta[0] - eta * gw / idx.length, theta[1] - eta * gb / idx.length];
      trail.push(theta.slice());
      current = idx;
      steps++;
    }

    // Level sets of the quadratic loss: (θ − θ*)ᵀ S (θ − θ*) = c, with S = [[E x², E x], [E x, 1]].
    function ellipse(c, X, Y) {
      var a = sxx, b = sx, d = 1;
      var tr = a + d, dt = a * d - b * b, disc = Math.sqrt(tr * tr / 4 - dt);
      var l1 = tr / 2 + disc, l2 = tr / 2 - disc;
      var v1 = Math.abs(b) > 1e-9 ? [l1 - d, b] : [1, 0];
      var n1 = Math.hypot(v1[0], v1[1]);
      v1 = [v1[0] / n1, v1[1] / n1];
      var v2 = [-v1[1], v1[0]];
      var pts = [];
      for (var k = 0; k <= 64; k++) {
        var phi = 2 * Math.PI * k / 64;
        var r1 = Math.sqrt(c / l1) * Math.cos(phi), r2 = Math.sqrt(c / l2) * Math.sin(phi);
        pts.push([X(wStar + r1 * v1[0] + r2 * v2[0]), Y(bStar + r1 * v1[1] + r2 * v2[1])]);
      }
      return M.path(pts) + "Z";
    }

    function draw() {
      // Data and current line.
      M.clear(left);
      var X = M.linear(-1.1, 1.1, 30, 330), Y = M.linear(-3, 2, 240, 10);
      left.appendChild(M.axes({ x: X, y: Y, x0: 30, x1: 330, y0: 240, y1: 10, xTicks: [-1, 0, 1], yTicks: [-2, -1, 0, 1, 2],
        yFmt: function (v) { return M.fmt(v, 0); } }));
      data.forEach(function (d, k) {
        left.appendChild(s("circle", { cx: X(d[0]), cy: Y(d[1]), r: current.indexOf(k) >= 0 ? 6 : 3.5,
          class: current.indexOf(k) >= 0 ? "pt-b" : "pt-a", "fill-opacity": current.indexOf(k) >= 0 ? 1 : 0.7 }));
      });
      left.appendChild(s("line", { x1: X(-1.1), y1: Y(theta[0] * -1.1 + theta[1]), x2: X(1.1), y2: Y(theta[0] * 1.1 + theta[1]), class: "curve" }));

      // Parameter space.
      M.clear(right);
      var PX = M.linear(-2, 3.5, 30, 330), PY = M.linear(-2, 2, 240, 10);
      right.appendChild(M.axes({ x: PX, y: PY, x0: 30, x1: 330, y0: 240, y1: 10, xTicks: [-2, -1, 0, 1, 2, 3], yTicks: [-2, -1, 0, 1, 2],
        yFmt: function (v) { return M.fmt(v, 0); }, xLabel: "w", yLabel: "b" }));
      [0.05, 0.2, 0.5, 1, 2, 3.5, 5.5].forEach(function (c) {
        right.appendChild(s("path", { d: ellipse(c, PX, PY), class: "contour" }));
      });
      right.appendChild(s("path", { d: M.path(trail.map(function (p) { return [PX(p[0]), PY(p[1])]; })), class: "trail" }));
      right.appendChild(s("circle", { cx: PX(wStar), cy: PY(bStar), r: 4, class: "pt-star" }));
      right.appendChild(s("circle", { cx: PX(theta[0]), cy: PY(theta[1]), r: 5, class: "pt-b" }));

      stStep.set(M.fmt(steps, 0));
      stLoss.set(t("sgd.lossVal", { v: M.fmt(loss(theta[0], theta[1]), 4), min: M.fmt(lStar, 3) }));
      stW.set(M.fmt(theta[0], 3));
      stB.set(M.fmt(theta[1], 3));
    }

    reset();
  });
})();
