// Chapter 04 — secant to tangent, and backpropagation through a one-neuron computational graph.
(function () {
  "use strict";
  var M = window.MOA, h = M.h, s = M.s, t = M.t;

  // ------------------------------------------------------------------ derivative

  var FUNCS = {
    cubic: { f: function (x) { return x * x * x / 3 - x; }, df: function (x) { return x * x - 1; }, tex: "x³/3 − x" },
    sin: { f: function (x) { return Math.sin(1.4 * x); }, df: function (x) { return 1.4 * Math.cos(1.4 * x); }, tex: "sin(1,4x)" },
    square: { f: function (x) { return 0.5 * x * x - 1; }, df: function (x) { return x; }, tex: "x²/2 − 1" },
  };

  M.register("calculus/derivative", function (stage) {
    var fn = "cubic", x0 = 0.4, hh = 1.2;
    var W = 560, H = 300;
    var X = M.linear(-2.6, 2.6, 30, W - 10), Y = M.linear(-2.2, 2.2, H - 20, 10);
    var svg = M.svgBox(h("div"), W, H, t("deriv.title"));
    var stSec = M.stat(t("deriv.secant")), stTan = M.stat(t("deriv.tangent"), "accent"), stErr = M.stat(t("deriv.error"));

    stage.appendChild(M.controls(
      M.select({ label: t("deriv.fn"), value: fn, options: Object.keys(FUNCS).map(function (k) { return { value: k, label: "f(x) = " + FUNCS[k].tex }; }),
        onChange: function (v) { fn = v; draw(); } }).el,
      M.slider({ label: "x", min: -2.2, max: 2.2, step: 0.01, value: x0, onInput: function (v) { x0 = v; draw(); } }).el,
      M.slider({ label: "h", min: 0.001, max: 2, log: true, value: hh, format: function (v) { return M.fmt(v, 3); },
        onInput: function (v) { hh = v; draw(); } }).el));
    stage.appendChild(svg.parentNode);
    stage.appendChild(h("div", { class: "stats" }, stSec.el, stTan.el, stErr.el));

    function line(x1, y1, slope, cls) {
      var xa = -2.6, xb = 2.6;
      return s("line", { x1: X(xa), y1: Y(y1 + slope * (xa - x1)), x2: X(xb), y2: Y(y1 + slope * (xb - x1)), class: cls });
    }

    function draw() {
      var F = FUNCS[fn];
      M.clear(svg);
      svg.appendChild(s("line", { class: "gridline", x1: X(-2.6), x2: X(2.6), y1: Y(0), y2: Y(0) }));
      svg.appendChild(s("line", { class: "gridline", x1: X(0), x2: X(0), y1: Y(-2.2), y2: Y(2.2) }));
      var pts = [];
      for (var i = 0; i <= 200; i++) { var xx = -2.6 + 5.2 * i / 200; pts.push([X(xx), Y(F.f(xx))]); }
      var clip = s("clipPath", { id: "dclip" }, s("rect", { x: 0, y: 0, width: W, height: H }));
      svg.appendChild(clip);
      svg.appendChild(s("path", { d: M.path(pts), class: "curve-fn" }));
      var y0 = F.f(x0), y1 = F.f(x0 + hh);
      var secant = (y1 - y0) / hh, tangent = F.df(x0);
      var g = s("g", { "clip-path": "url(#dclip)" });
      g.appendChild(line(x0, y0, tangent, "curve"));
      g.appendChild(line(x0, y0, secant, "curve-2 dashed"));
      svg.appendChild(g);
      svg.appendChild(s("line", { x1: X(x0 + hh), x2: X(x0 + hh), y1: Y(0), y2: Y(y1), class: "curve-muted" }));
      svg.appendChild(s("circle", { cx: X(x0), cy: Y(y0), r: 5, class: "pt-dot" }));
      svg.appendChild(s("circle", { cx: X(x0 + hh), cy: Y(y1), r: 4, class: "pt-dot-2" }));
      svg.appendChild(s("text", { x: X(x0 + hh) + 5, y: Y(0) + 14 }, "x + h"));
      stSec.set(M.fmt(secant, 4));
      stTan.set(M.fmt(tangent, 4));
      stErr.set(M.fmt(Math.abs(secant - tangent), 4));
    }

    draw();
  });

  // ------------------------------------------------------------------ backprop

  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

  M.register("calculus/backprop", function (stage) {
    var P = { x: 1.5, w: -0.8, b: 0.3, y: 1 };
    var lr = 0.5;
    var W = 720, H = 280;
    var NODES = {
      x: { x: 60, y: 60, label: "x", input: true },
      w: { x: 60, y: 150, label: "w", input: true, param: true },
      b: { x: 200, y: 230, label: "b", input: true, param: true },
      u: { x: 200, y: 105, label: "×" },
      z: { x: 330, y: 150, label: "+" },
      a: { x: 450, y: 150, label: "σ" },
      y: { x: 450, y: 245, label: "y", input: true, target: true },
      d: { x: 570, y: 150, label: "−" },
      L: { x: 670, y: 150, label: "( )²" },
    };
    var EDGES = [["x", "u"], ["w", "u"], ["u", "z"], ["b", "z"], ["z", "a"], ["a", "d"], ["y", "d"], ["d", "L"]];
    var NAMES = { x: "x", w: "w", b: "b", u: "u = w·x", z: "z = u + b", a: "ŷ = σ(z)", y: "y", d: "δ = ŷ − y", L: "𝓛 = δ²" };
    // Backward pass, one stage at a time (reverse topological order).
    var STAGES = [["L"], ["d"], ["a"], ["z"], ["u", "b"], ["x", "w"]];

    var vals = {}, grads = {}, stageIdx = -1, forwardDone = false;
    var svg = M.svgBox(h("div"), W, H, t("bp.title"));
    var explain = h("p", { class: "bp-explain", "aria-live": "polite" });
    var stL = M.stat(t("bp.loss"), "accent"), stGw = M.stat("∂𝓛/∂w"), stNum = M.stat(t("bp.numeric"));

    var sliders = ["x", "w", "b", "y"].map(function (k) {
      return M.slider({ label: k, min: k === "y" ? 0 : -3, max: k === "y" ? 1 : 3, step: 0.05, value: P[k],
        onInput: function (v) { P[k] = v; resetPass(); } });
    });
    var fwdBtn = M.button(t("bp.forward"), function () { forward(); draw(); }, "primary");
    var backBtn = M.button(t("bp.back"), function () { backStep(); draw(); });
    var allBtn = M.button(t("bp.all"), function () { forward(); while (stageIdx < STAGES.length - 1) backStep(); draw(); });
    var learnBtn = M.button(t("bp.learn"), function () { learn(); });

    stage.appendChild(M.controls(sliders[0].el, sliders[1].el, sliders[2].el, sliders[3].el));
    stage.appendChild(svg.parentNode);
    stage.appendChild(explain);
    stage.appendChild(M.controls(h("div", { class: "btn-row" }, fwdBtn, backBtn, allBtn, learnBtn)));
    stage.appendChild(h("div", { class: "stats" }, stL.el, stGw.el, stNum.el));

    function compute(p) {
      var v = {};
      v.x = p.x; v.w = p.w; v.b = p.b; v.y = p.y;
      v.u = p.w * p.x;
      v.z = v.u + p.b;
      v.a = sigmoid(v.z);
      v.d = v.a - p.y;
      v.L = v.d * v.d;
      return v;
    }

    function resetPass() { vals = {}; grads = {}; stageIdx = -1; forwardDone = false; draw(); }

    function forward() {
      if (!forwardDone) { vals = compute(P); forwardDone = true; grads = {}; stageIdx = -1; }
    }

    function backStep() {
      if (!forwardDone) forward();
      if (stageIdx >= STAGES.length - 1) return;
      stageIdx++;
      var v = vals, g = grads;
      switch (stageIdx) {
        case 0: g.L = 1; break;
        case 1: g.d = g.L * 2 * v.d; break;
        case 2: g.a = g.d * 1; break;
        case 3: g.z = g.a * v.a * (1 - v.a); break;
        case 4: g.u = g.z; g.b = g.z; break;
        case 5: g.w = g.u * v.x; g.x = g.u * v.w; break;
      }
    }

    function explanation() {
      var f = function (n) { return M.fmt(n, 3); };
      var v = vals, g = grads;
      if (!forwardDone) return t("bp.start");
      switch (stageIdx) {
        case -1: return t("bp.fwdDone", { L: f(v.L) });
        case 0: return "∂𝓛/∂𝓛 = 1";
        case 1: return "∂𝓛/∂δ = 2δ = 2 · " + f(v.d) + " = " + f(g.d);
        case 2: return "∂𝓛/∂ŷ = ∂𝓛/∂δ · ∂δ/∂ŷ = " + f(g.d) + " · 1 = " + f(g.a);
        case 3: return "∂𝓛/∂z = ∂𝓛/∂ŷ · σ(z)(1 − σ(z)) = " + f(g.a) + " · " + f(v.a * (1 - v.a)) + " = " + f(g.z);
        case 4: return "∂𝓛/∂u = ∂𝓛/∂z · 1 = " + f(g.u) + "   ·   ∂𝓛/∂b = ∂𝓛/∂z · 1 = " + f(g.b);
        default: return "∂𝓛/∂w = ∂𝓛/∂u · x = " + f(g.u) + " · " + f(v.x) + " = " + f(g.w) + "   ·   ∂𝓛/∂x = ∂𝓛/∂u · w = " + f(g.x);
      }
    }

    function learn() {
      forward();
      while (stageIdx < STAGES.length - 1) backStep();
      P.w -= lr * grads.w;
      P.b -= lr * grads.b;
      P.w = M.clamp(P.w, -3, 3);
      P.b = M.clamp(P.b, -3, 3);
      sliders[1].set(P.w, true);
      sliders[2].set(P.b, true);
      forwardDone = false;
      forward();
      while (stageIdx < STAGES.length - 1) backStep();
      draw();
    }

    function draw() {
      M.clear(svg);
      var active = stageIdx >= 0 ? STAGES[stageIdx] : [];
      EDGES.forEach(function (e) {
        var a = NODES[e[0]], b = NODES[e[1]];
        var flowing = grads[e[1]] !== undefined && grads[e[0]] !== undefined;
        svg.appendChild(s("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "edge" + (flowing ? " edge-back" : "") }));
      });
      Object.keys(NODES).forEach(function (k) {
        var n = NODES[k];
        var cls = "node" + (n.input ? " node-input" : "") + (n.param ? " node-param" : "") + (n.target ? " node-target" : "") +
          (active.indexOf(k) >= 0 ? " node-active" : "");
        var g = s("g", { class: cls });
        g.appendChild(s("circle", { cx: n.x, cy: n.y, r: 23 }));
        g.appendChild(s("text", { x: n.x, y: n.y + 5, "text-anchor": "middle", class: "node-label" }, n.label));
        if (vals[k] !== undefined) {
          g.appendChild(s("text", { x: n.x, y: n.y + 41, "text-anchor": "middle", class: "node-val mono" },
            (n.input ? "" : NAMES[k].split(" =")[0] + " = ") + M.fmt(vals[k], 3)));
        }
        if (grads[k] !== undefined) {
          g.appendChild(s("text", { x: n.x, y: n.y - 31, "text-anchor": "middle", class: "node-grad mono" }, "∂ " + M.fmt(grads[k], 3)));
        }
        svg.appendChild(g);
      });
      explain.textContent = explanation();

      var v = compute(P);
      stL.set(M.fmt(v.L, 4));
      var eps = 1e-5;
      var num = (compute({ x: P.x, w: P.w + eps, b: P.b, y: P.y }).L - compute({ x: P.x, w: P.w - eps, b: P.b, y: P.y }).L) / (2 * eps);
      stGw.set(grads.w !== undefined ? M.fmt(grads.w, 4) : "?");
      stNum.set(M.fmt(num, 4));
      backBtn.disabled = stageIdx >= STAGES.length - 1;
    }

    draw();
  });
})();
