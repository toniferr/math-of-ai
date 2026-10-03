// Chapter 06 — perceptron vs. one-hidden-layer network playground, and universal approximation in 1D.
(function () {
  "use strict";
  var M = window.MOA, h = M.h, s = M.s, t = M.t;

  // ------------------------------------------------------------------ datasets

  function makeData(kind, rand) {
    var pts = [];
    function blob(cx, cy, sd, label, n) {
      for (var i = 0; i < n; i++) pts.push([cx + sd * M.gauss(rand), cy + sd * M.gauss(rand), label]);
    }
    if (kind === "separable") {
      blob(-0.5, 0.35, 0.22, 1, 22);
      blob(0.5, -0.35, 0.22, -1, 22);
    } else if (kind === "xor") {
      blob(-0.55, 0.5, 0.15, 1, 11); blob(0.55, -0.5, 0.15, 1, 11);
      blob(0.55, 0.5, 0.15, -1, 11); blob(-0.55, -0.5, 0.15, -1, 11);
    } else if (kind === "circle") {
      for (var i = 0; i < 50; i++) {
        var a = 2 * Math.PI * rand(), inner = i % 2 === 0;
        var r = inner ? 0.35 * Math.sqrt(rand()) : 0.65 + 0.25 * rand();
        pts.push([r * Math.cos(a) * 1.2, r * Math.sin(a), inner ? 1 : -1]);
      }
    }
    return pts;
  }

  // ------------------------------------------------------------------ models

  function Perceptron() {
    this.w = [0, 0]; this.b = 0; this.mistakes = 0;
  }
  Perceptron.prototype.raw = function (x, y) { return this.w[0] * x + this.w[1] * y + this.b; };
  Perceptron.prototype.prob = function (x, y) { return 1 / (1 + Math.exp(-4 * this.raw(x, y))); };
  Perceptron.prototype.epoch = function (data, rand) {
    var order = data.map(function (_, i) { return i; }).sort(function () { return rand() - 0.5; });
    var m = 0, self = this;
    order.forEach(function (i) {
      var d = data[i];
      if (d[2] * self.raw(d[0], d[1]) <= 0) {
        self.w[0] += 0.1 * d[2] * d[0]; self.w[1] += 0.1 * d[2] * d[1]; self.b += 0.1 * d[2];
        m++;
      }
    });
    this.mistakes = m;
    return m;
  };

  function MLP(hidden, rand) {
    this.H = hidden;
    this.p = [];
    // Layout: W1 (H x 2), b1 (H), W2 (H), b2 (1).
    for (var i = 0; i < hidden * 4 + 1; i++) this.p.push(M.gauss(rand) * (i < hidden * 2 ? 1.2 : 0.4));
    this.m = this.p.map(function () { return 0; });
    this.v = this.p.map(function () { return 0; });
    this.t = 0;
  }
  MLP.prototype.forward = function (x, y) {
    var H = this.H, p = this.p, hs = [], z = p[4 * H];
    for (var j = 0; j < H; j++) {
      var a = Math.tanh(p[2 * j] * x + p[2 * j + 1] * y + p[2 * H + j]);
      hs.push(a);
      z += p[3 * H + j] * a;
    }
    return { h: hs, out: 1 / (1 + Math.exp(-z)) };
  };
  MLP.prototype.prob = function (x, y) { return this.forward(x, y).out; };
  MLP.prototype.step = function (data) {
    var H = this.H, p = this.p, g = p.map(function () { return 0; }), loss = 0;
    data.forEach(function (d) {
      var f = this.forward(d[0], d[1]);
      var target = d[2] > 0 ? 1 : 0;
      loss -= target ? Math.log(f.out + 1e-9) : Math.log(1 - f.out + 1e-9);
      var dz = f.out - target; // d(BCE)/dz for a sigmoid output
      g[4 * H] += dz;
      for (var j = 0; j < H; j++) {
        g[3 * H + j] += dz * f.h[j];
        var dh = dz * p[3 * H + j] * (1 - f.h[j] * f.h[j]);
        g[2 * j] += dh * d[0];
        g[2 * j + 1] += dh * d[1];
        g[2 * H + j] += dh;
      }
    }, this);
    var n = data.length || 1, lr = 0.04, b1 = 0.9, b2 = 0.999;
    this.t++;
    for (var k = 0; k < p.length; k++) {
      var gk = g[k] / n;
      this.m[k] = b1 * this.m[k] + (1 - b1) * gk;
      this.v[k] = b2 * this.v[k] + (1 - b2) * gk * gk;
      var mh = this.m[k] / (1 - Math.pow(b1, this.t)), vh = this.v[k] / (1 - Math.pow(b2, this.t));
      p[k] -= lr * mh / (Math.sqrt(vh) + 1e-8);
    }
    return loss / n;
  };

  // ------------------------------------------------------------------ playground

  M.register("neural-networks/playground", function (stage) {
    var rand = M.rng(3);
    var dataset = "separable", modelKind = "perceptron", hidden = 4, addClass = 1;
    var data = makeData(dataset, rand), model, epoch = 0, lastLoss = NaN, converged = false;

    var stEp = M.stat(t("nn.epoch")), stAcc = M.stat(t("nn.acc"), "accent"), stLoss = M.stat(t("nn.loss")), stSt = M.stat(t("nn.state"));
    var dataSel = M.select({ label: t("nn.data"), value: dataset,
      options: ["separable", "xor", "circle", "empty"].map(function (k) { return { value: k, label: t("nn.datasets." + k) }; }),
      onChange: function (v) { dataset = v; data = v === "empty" ? [] : makeData(v, rand); resetModel(); } });
    var modelSeg = M.segmented({ label: t("nn.model"), value: modelKind,
      options: [{ value: "perceptron", label: t("nn.perceptron") }, { value: "mlp", label: t("nn.mlp") }],
      onChange: function (v) { modelKind = v; hiddenSl.el.hidden = v !== "mlp"; resetModel(); } });
    var hiddenSl = M.slider({ label: t("nn.hidden"), min: 2, max: 12, step: 1, value: hidden,
      format: function (v) { return M.fmt(v, 0); }, onInput: function (v) { hidden = v; resetModel(); } });
    hiddenSl.el.hidden = true;
    var classSeg = M.segmented({ label: t("nn.add"), value: "1",
      options: [{ value: "1", label: "● " + t("nn.blue") }, { value: "-1", label: "● " + t("nn.orange") }],
      onChange: function (v) { addClass = +v; } });
    var runBtn = M.button(t("gd.run"), function () { anim.toggle(); }, "primary");

    stage.appendChild(M.controls(dataSel.el, modelSeg.el, hiddenSl.el));
    var holder = h("div", { class: "canvas-holder" });
    stage.appendChild(holder);
    stage.appendChild(M.controls(h("div", { class: "btn-row" }, runBtn,
      M.button(t("nn.reinit"), function () { resetModel(); }),
      M.button(t("nn.clear"), function () { data = []; resetModel(); })), classSeg.el));
    stage.appendChild(h("div", { class: "stats" }, stEp.el, stAcc.el, stLoss.el, stSt.el));

    var cv = M.canvas(holder, { aspect: 1.4, label: t("nn.title"), draw: draw });
    var X, Y;
    var anim = M.animator(holder, function () {
      if (!data.length) return false;
      if (modelKind === "perceptron") {
        var m = model.epoch(data, rand);
        epoch++;
        lastLoss = m;
        if (m === 0) converged = true;
      } else {
        for (var k = 0; k < 6; k++) { lastLoss = model.step(data); epoch++; }
      }
      cv.redraw();
      stats();
      return !converged && epoch < 4000;
    });
    anim.onchange = function (on) { runBtn.textContent = on ? t("gd.pause") : t("gd.run"); };

    cv.canvas.addEventListener("click", function (ev) {
      var p = cv.toLocal(ev);
      var c = ev.shiftKey ? -addClass : addClass;
      data.push([X.invert(p.x), Y.invert(p.y), c]);
      converged = false;
      cv.redraw();
      stats();
    });

    function resetModel() {
      anim.stop();
      model = modelKind === "perceptron" ? new Perceptron() : new MLP(hidden, rand);
      epoch = 0; lastLoss = NaN; converged = false;
      cv.redraw();
      stats();
    }

    function accuracy() {
      if (!data.length) return NaN;
      var ok = data.filter(function (d) { return (model.prob(d[0], d[1]) > 0.5 ? 1 : -1) === d[2]; }).length;
      return ok / data.length;
    }

    function stats() {
      stEp.set(M.fmt(epoch, 0));
      var acc = accuracy();
      stAcc.set(isNaN(acc) ? "—" : M.pct(acc, 0));
      stLoss.set(isNaN(lastLoss) ? "—" : modelKind === "perceptron" ? t("nn.mistakes", { n: lastLoss }) : M.fmt(lastLoss, 3));
      stSt.set(converged ? t("nn.converged", { n: epoch }) :
        modelKind === "perceptron" && epoch > 60 ? t("nn.noConverge") : anim.running ? t("nn.training") : "—");
    }

    function draw(ctx, w, hgt) {
      var ax = 1.4;
      X = M.linear(-ax, ax, 0, w);
      Y = M.linear(-1, 1, hgt, 0);
      ctx.fillStyle = M.color("--bg-figure");
      ctx.fillRect(0, 0, w, hgt);
      var c1 = M.color("--k1"), c2 = M.color("--k2");
      var cell = 8;
      for (var py = 0; py < hgt; py += cell) {
        for (var px = 0; px < w; px += cell) {
          var pr = model.prob(X.invert(px + cell / 2), Y.invert(py + cell / 2));
          ctx.fillStyle = pr > 0.5 ? c1 : c2;
          ctx.globalAlpha = 0.06 + 0.32 * Math.abs(pr - 0.5) * 2;
          ctx.fillRect(px, py, cell, cell);
        }
      }
      ctx.globalAlpha = 1;
      if (modelKind === "perceptron" && (model.w[0] || model.w[1])) {
        // Decision line w·x + b = 0.
        ctx.strokeStyle = M.color("--fg");
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (Math.abs(model.w[1]) > Math.abs(model.w[0])) {
          ctx.moveTo(X(-ax), Y(-(model.w[0] * -ax + model.b) / model.w[1]));
          ctx.lineTo(X(ax), Y(-(model.w[0] * ax + model.b) / model.w[1]));
        } else {
          ctx.moveTo(X(-(model.w[1] * -1 + model.b) / model.w[0]), Y(-1));
          ctx.lineTo(X(-(model.w[1] * 1 + model.b) / model.w[0]), Y(1));
        }
        ctx.stroke();
      }
      data.forEach(function (d) {
        ctx.beginPath();
        ctx.arc(X(d[0]), Y(d[1]), 5, 0, 2 * Math.PI);
        ctx.fillStyle = d[2] > 0 ? c1 : c2;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = M.color("--bg");
        ctx.stroke();
      });
    }

    model = new Perceptron();
    stats();
  });

  // ------------------------------------------------------------------ universal approximation

  var TARGETS = {
    wave: function (x) { return 0.5 + 0.28 * Math.sin(2 * Math.PI * 1.5 * x) + 0.1 * Math.sin(11 * x); },
    bump: function (x) { return 0.15 + 0.7 * Math.exp(-Math.pow((x - 0.4) / 0.12, 2)) + 0.25 * x; },
    zigzag: function (x) { var f = (x * 3) % 1; return 0.2 + 0.6 * (f < 0.5 ? 2 * f : 2 - 2 * f); },
  };

  M.register("neural-networks/universal", function (stage) {
    var target = "wave", N = 8, k = 60;
    var W = 600, H = 280, L = 36, R = 10, T = 12, B = 28;
    var X = M.linear(0, 1, L, W - R), Y = M.linear(-0.05, 1.05, H - B, T);
    var svg = M.svgBox(h("div"), W, H, t("ua.title"));
    var stN = M.stat(t("ua.neurons")), stErr = M.stat(t("ua.maxErr"), "accent"), stP = M.stat(t("ua.params"));

    stage.appendChild(M.controls(
      M.select({ label: t("ua.target"), value: target, options: Object.keys(TARGETS).map(function (key) { return { value: key, label: t("ua.targets." + key) }; }),
        onChange: function (v) { target = v; draw(); } }).el,
      M.slider({ label: "N", min: 1, max: 60, step: 1, value: N, format: function (v) { return M.fmt(v, 0); },
        onInput: function (v) { N = v; draw(); } }).el,
      M.slider({ label: t("ua.steep") + " k", min: 3, max: 800, log: true, value: k, format: function (v) { return M.fmt(v, 0); },
        onInput: function (v) { k = v; draw(); } }).el));
    stage.appendChild(svg.parentNode);
    stage.appendChild(h("div", { class: "stats" }, stN.el, stErr.el, stP.el));

    function sig(z) { return 1 / (1 + Math.exp(-z)); }

    function draw() {
      var f = TARGETS[target];
      var vals = [];
      for (var i = 0; i < N; i++) vals.push(f((i + 0.5) / N));
      function g(x) {
        var y = vals[0];
        for (var i = 1; i < N; i++) y += (vals[i] - vals[i - 1]) * sig(k * (x - i / N));
        return y;
      }
      M.clear(svg);
      svg.appendChild(M.axes({ x: X, y: Y, x0: L, x1: W - R, y0: H - B, y1: T, xTicks: [0, 0.25, 0.5, 0.75, 1],
        yTicks: [0, 0.5, 1], xFmt: function (v) { return M.fmt(v, 2); } }));
      // Individual neurons (each a scaled sigmoid step), drawn faintly from the baseline.
      if (N <= 30) {
        for (var j = 1; j < N; j++) {
          var pts = [];
          for (var q = 0; q <= 120; q++) {
            var xx = q / 120;
            pts.push([X(xx), Y(0.02 + Math.abs(vals[j] - vals[j - 1]) * sig(k * (xx - j / N)))]);
          }
          svg.appendChild(s("path", { d: M.path(pts), class: "neuron-curve" }));
        }
      }
      var tp = [], ap = [], err = 0;
      for (var p = 0; p <= 400; p++) {
        var x = p / 400, fx = f(x), gx = g(x);
        err = Math.max(err, Math.abs(fx - gx));
        tp.push([X(x), Y(fx)]);
        ap.push([X(x), Y(gx)]);
      }
      svg.appendChild(s("path", { d: M.path(tp), class: "target-curve" }));
      svg.appendChild(s("path", { d: M.path(ap), class: "curve" }));
      stN.set(M.fmt(N, 0));
      stErr.set(M.fmt(err, 3));
      stP.set(M.fmt(3 * N + 1, 0));
    }

    draw();
  });
})();
