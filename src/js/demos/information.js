// Chapter 02 — entropy and Huffman codes, cross-entropy and KL, Shannon's n-gram approximations.
(function () {
  "use strict";
  var M = window.MOA, h = M.h, s = M.s, t = M.t;

  // ------------------------------------------------------------------ draggable probability bars

  // Bars whose heights are probabilities. Dragging bar i sets p_i under the pointer and rescales the rest
  // so the total stays 1. o = {labels, values, ghost?, onChange, label}
  function barEditor(parent, o) {
    var W = o.width || 560, H = 230, L = 34, R = 8, T = 22, B = 34;
    var svg = M.svgBox(parent, W, H, o.label);
    svg.classList.add("bar-editor");
    var n = o.labels.length;
    var slot = (W - L - R) / n;
    var y = M.linear(0, 1, H - B, T);
    var values = o.values.slice();
    var dragging = -1;

    function setValue(i, v) {
      v = M.clamp(v, 0, 1);
      var rest = values.reduce(function (a, b, j) { return j === i ? a : a + b; }, 0);
      values = values.map(function (x, j) {
        if (j === i) return v;
        return rest > 1e-9 ? x * (1 - v) / rest : (1 - v) / (n - 1);
      });
      draw();
      o.onChange(values.slice());
    }

    function fromEvent(ev) {
      var r = svg.getBoundingClientRect();
      var sx = W / r.width, sy = H / r.height;
      var pt = ev.touches ? ev.touches[0] : ev;
      return { x: (pt.clientX - r.left) * sx, y: (pt.clientY - r.top) * sy };
    }

    svg.addEventListener("pointerdown", function (ev) {
      var p = fromEvent(ev);
      var i = Math.floor((p.x - L) / slot);
      if (i < 0 || i >= n) return;
      dragging = i;
      svg.setPointerCapture(ev.pointerId);
      setValue(i, y.invert(p.y));
      ev.preventDefault();
    });
    svg.addEventListener("pointermove", function (ev) {
      if (dragging < 0) return;
      setValue(dragging, y.invert(fromEvent(ev).y));
    });
    function end() { dragging = -1; }
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);

    function draw() {
      M.clear(svg);
      svg.appendChild(M.axes({ x: function (v) { return v; }, y: y, x0: L, x1: W - R, y0: H - B, y1: T,
        yTicks: [0, 0.25, 0.5, 0.75, 1], yFmt: function (v) { return M.fmt(v, 2); } }));
      for (var i = 0; i < n; i++) {
        var cx = L + slot * (i + 0.5), bw = Math.min(54, slot * 0.62);
        svg.appendChild(s("rect", { x: L + slot * i, y: T, width: slot, height: H - B - T, fill: "transparent", class: "hit" }));
        svg.appendChild(s("rect", { x: cx - bw / 2, y: y(values[i]), width: bw, height: Math.max(0, y(0) - y(values[i])), rx: 3, class: "bar" }));
        if (o.ghost) {
          svg.appendChild(s("rect", { x: cx - bw / 2 - 3, y: y(o.ghost[i]), width: bw + 6, height: Math.max(0, y(0) - y(o.ghost[i])),
            rx: 3, fill: "none", class: "ghost-bar" }));
        }
        svg.appendChild(s("text", { x: cx, y: y(values[i]) - 6, "text-anchor": "middle", class: "mono label-strong" }, M.fmt(values[i], 2)));
        svg.appendChild(s("text", { x: cx, y: H - B + 18, "text-anchor": "middle", class: "label-strong" }, o.labels[i]));
      }
    }

    draw();
    return {
      set: function (v) { values = v.slice(); draw(); o.onChange(values.slice()); },
      get: function () { return values.slice(); },
    };
  }

  // ------------------------------------------------------------------ Huffman

  function huffman(ps) {
    var nodes = [];
    ps.forEach(function (p, i) { if (p > 1e-12) nodes.push({ p: p, sym: i, id: i }); });
    var codes = ps.map(function () { return null; });
    if (nodes.length === 1) { codes[nodes[0].sym] = ""; return codes; }
    var nextId = ps.length;
    while (nodes.length > 1) {
      nodes.sort(function (a, b) { return a.p - b.p || a.id - b.id; });
      var a = nodes.shift(), b = nodes.shift();
      nodes.push({ p: a.p + b.p, left: a, right: b, id: nextId++ });
    }
    (function walk(node, prefix) {
      if (node.sym !== undefined) { codes[node.sym] = prefix; return; }
      walk(node.left, prefix + "0");
      walk(node.right, prefix + "1");
    })(nodes[0], "");
    return codes;
  }

  // ------------------------------------------------------------------ entropy + Huffman demo

  M.register("information/entropy", function (stage) {
    var labels = ["A", "B", "C", "D", "E", "F"];
    var PRESETS = {
      skewed: [0.4, 0.2, 0.15, 0.1, 0.1, 0.05],
      uniform: [1, 1, 1, 1, 1, 1].map(function () { return 1 / 6; }),
      two: [0.5, 0.5, 0, 0, 0, 0],
      certain: [1, 0, 0, 0, 0, 0],
    };
    var stH = M.stat(t("entropy.H"), "accent"), stMax = M.stat(t("entropy.max")),
      stL = M.stat(t("entropy.L")), stEff = M.stat(t("entropy.eff"));
    var gauge = h("div");
    var table = h("table", { class: "mini-table" });
    var chartBox = h("div");

    stage.appendChild(M.controls(M.segmented({
      label: t("entropy.presets"), value: "skewed",
      options: ["skewed", "uniform", "two", "certain"].map(function (k) { return { value: k, label: t("entropy.preset." + k) }; }),
      onChange: function (v) { editor.set(PRESETS[v]); },
    }).el));
    stage.appendChild(h("div", { class: "panel-grid" },
      h("div", {}, h("p", { class: "panel-label" }, t("entropy.dist")), chartBox, h("p", { class: "demo-hint" }, t("entropy.hint"))),
      h("div", {}, h("p", { class: "panel-label" }, t("entropy.code")), table, gauge)));
    stage.appendChild(h("div", { class: "stats" }, stH.el, stMax.el, stL.el, stEff.el));

    var gaugeSvg = M.svgBox(gauge, 320, 92, t("entropy.gauge"));

    function update(ps) {
      var H = M.entropy(ps);
      var codes = huffman(ps);
      var L = ps.reduce(function (acc, p, i) { return acc + (codes[i] === null ? 0 : p * codes[i].length); }, 0);
      var maxH = Math.log2(ps.length);
      stH.set(M.fmt(H, 3) + " bits");
      stMax.set(M.fmt(maxH, 3) + " bits");
      stL.set(M.fmt(L, 3) + " bits");
      stEff.set(L > 0 ? M.pct(H / L) : "—");

      M.clear(table);
      table.appendChild(h("thead", {}, h("tr", {},
        h("th", {}, t("entropy.sym")), h("th", { class: "num" }, "p"), h("th", { class: "num" }, t("entropy.surprise")),
        h("th", {}, t("entropy.codeword")))));
      var body = h("tbody");
      ps.forEach(function (p, i) {
        body.appendChild(h("tr", {},
          h("td", {}, labels[i]),
          h("td", { class: "num" }, M.fmt(p, 2)),
          h("td", { class: "num" }, p > 0 ? M.fmt(-Math.log2(p), 2) : "∞"),
          h("td", {}, codes[i] === null ? "—" : h("code", {}, codes[i] || "∅"))));
      });
      table.appendChild(body);

      M.clear(gaugeSvg);
      var x = M.linear(0, maxH, 104, 310);
      [[t("entropy.H"), H, "bar"], [t("entropy.L"), L, "bar-soft"], [t("entropy.max"), maxH, "bar-2"]].forEach(function (row, k) {
        var yy = 8 + k * 28;
        gaugeSvg.appendChild(s("text", { x: 98, y: yy + 13, "text-anchor": "end" }, row[0]));
        gaugeSvg.appendChild(s("rect", { x: 104, y: yy, width: Math.max(1, x(Math.min(row[1], maxH)) - 104), height: 18, rx: 3, class: row[2] }));
        gaugeSvg.appendChild(s("text", { x: Math.min(x(Math.min(row[1], maxH)) + 4, 270), y: yy + 13, class: "mono label-strong" }, M.fmt(row[1], 2)));
      });
    }

    var editor = barEditor(chartBox, { labels: labels, values: PRESETS.skewed, onChange: update, label: t("entropy.dist") });
    update(PRESETS.skewed);
  });

  // ------------------------------------------------------------------ cross-entropy demo

  M.register("information/cross-entropy", function (stage) {
    var words = t("xent.words").split("|");
    var P = [0.32, 0.24, 0.18, 0.12, 0.09, 0.05];
    var uniform = P.map(function () { return 1 / P.length; });
    var stHp = M.stat(t("xent.Hp")), stHpq = M.stat(t("xent.Hpq"), "accent"), stKL = M.stat(t("xent.KL"), "bad");
    var chartBox = h("div");
    var stackBox = h("div");

    stage.appendChild(h("p", { class: "demo-title" }, t("xent.prompt")));
    stage.appendChild(chartBox);
    stage.appendChild(M.controls(h("div", { class: "btn-row" },
      M.button(t("xent.uniform"), function () { editor.set(uniform); }),
      M.button(t("xent.perfect"), function () { editor.set(P); }),
      M.button(t("xent.overconfident"), function () { editor.set([0.9, 0.04, 0.03, 0.02, 0.01, 0]); }))));
    stage.appendChild(stackBox);
    stage.appendChild(h("div", { class: "stats" }, stHp.el, stHpq.el, stKL.el));
    var stack = M.svgBox(stackBox, 1000, 64, t("xent.stack"));

    function update(q) {
      var Hp = M.entropy(P);
      var Hpq = P.reduce(function (acc, p, i) { return p > 0 ? acc - p * Math.log2(q[i]) : acc; }, 0);
      var KL = Hpq - Hp;
      stHp.set(M.fmt(Hp, 3) + " bits");
      stHpq.set(M.fmt(Hpq, 3) + " bits");
      stKL.set(M.fmt(Math.max(0, KL), 3) + " bits");

      M.clear(stack);
      var max = 6;
      var x = M.linear(0, max, 10, 990);
      var hpW = x(Hp) - 10, klW = Math.max(0, Math.min(x(Math.min(Hpq, max)) - x(Hp), 980 - hpW));
      stack.appendChild(s("rect", { x: 10, y: 10, width: hpW, height: 24, rx: 3, class: "bar-soft" }));
      stack.appendChild(s("rect", { x: 10 + hpW, y: 10, width: klW, height: 24, rx: 3, class: "bar-2" }));
      stack.appendChild(s("text", { x: 16, y: 26, class: "label-strong" }, "H(p)"));
      if (klW > 34) stack.appendChild(s("text", { x: 16 + hpW, y: 26, class: "label-strong" }, "KL"));
      stack.appendChild(s("text", { x: 10, y: 54 }, t("xent.stackLabel", { v: M.fmt(Hpq, 2) })));
    }

    var editor = barEditor(chartBox, { labels: words, values: uniform, ghost: P, onChange: update, label: t("xent.stack"), width: 1000 });
    update(uniform);
  });

  // ------------------------------------------------------------------ n-gram demo

  function tokenize(text, unit) {
    if (unit === "chars") return Array.from(text.toLowerCase());
    return text.toLowerCase().match(/[a-záéíóúüñ]+|[.,;:]/g) || [];
  }

  function buildModel(tokens, order) {
    // counts[context][next] with context = previous (order - 1) tokens joined by \u0001.
    var counts = new Map();
    var k = order - 1;
    for (var i = k; i < tokens.length; i++) {
      var ctx = tokens.slice(i - k, i).join("\u0001");
      var m = counts.get(ctx);
      if (!m) { m = new Map(); counts.set(ctx, m); }
      m.set(tokens[i], (m.get(tokens[i]) || 0) + 1);
    }
    return counts;
  }

  function condEntropy(model) {
    var total = 0, acc = 0;
    model.forEach(function (next) {
      var n = 0;
      next.forEach(function (c) { n += c; });
      var hCtx = 0;
      next.forEach(function (c) { var p = c / n; hCtx -= p * Math.log2(p); });
      acc += n * hCtx;
      total += n;
    });
    return acc / total;
  }

  function join(tokens, unit) {
    if (unit === "chars") return tokens.join("");
    return tokens.reduce(function (out, w) {
      return out + (/^[.,;:]$/.test(w) || !out ? w : " " + w);
    }, "");
  }

  M.register("information/ngrams", function (stage) {
    var corpus = (window.MOA_CORPUS && window.MOA_CORPUS[M.lang()]) || "";
    var unit = "chars", order = 3;
    var cache = {};
    var out = h("div", { class: "gen-text", "aria-live": "polite" });
    var stBits = M.stat(t("ngram.bits"), "accent"), stCtx = M.stat(t("ngram.contexts")), stCopy = M.stat(t("ngram.copied"));
    var rand = M.rng(42);

    var orderSlider = M.slider({ label: t("ngram.order"), min: 0, max: 7, step: 1, value: order,
      format: function (v) { return "n = " + v; }, onInput: function (v) { order = v; generate(); } });
    var unitSeg = M.segmented({
      label: t("ngram.unit"), value: unit,
      options: [{ value: "chars", label: t("ngram.chars") }, { value: "words", label: t("ngram.words") }],
      onChange: function (v) {
        unit = v;
        var max = v === "chars" ? 7 : 3;
        orderSlider.input.max = max;
        orderSlider.input.min = v === "chars" ? 0 : 1;
        if (order > max) order = max;
        if (v === "words" && order < 1) order = 1;
        orderSlider.set(order, true);
        generate();
      },
    });

    stage.appendChild(M.controls(unitSeg.el, orderSlider.el, M.button(t("ngram.again"), function () { generate(); }, "primary")));
    stage.appendChild(out);
    stage.appendChild(h("div", { class: "stats" }, stBits.el, stCtx.el, stCopy.el));
    var levelNote = h("p", { class: "demo-hint" });
    stage.appendChild(levelNote);

    function tokens() {
      var key = "tok-" + unit;
      if (!cache[key]) cache[key] = tokenize(corpus, unit);
      return cache[key];
    }

    function model(k) {
      var key = unit + k;
      if (!cache[key]) cache[key] = buildModel(tokens(), k);
      return cache[key];
    }

    function pick(map) {
      var total = 0;
      map.forEach(function (c) { total += c; });
      var r = rand() * total;
      var chosen = null;
      map.forEach(function (c, tok) { if (chosen === null) { r -= c; if (r < 0) chosen = tok; } });
      return chosen;
    }

    function generate() {
      var toks = tokens();
      var len = unit === "chars" ? 360 : 70;
      var gen = [];
      if (order === 0) {
        var alphabet = Array.from(new Set(toks));
        for (var i = 0; i < len; i++) gen.push(alphabet[Math.floor(rand() * alphabet.length)]);
        stBits.set(M.fmt(Math.log2(alphabet.length), 2) + " " + t("ngram.perSymbol"));
        stCtx.set("1");
      } else {
        var k = order - 1;
        var start = Math.floor(rand() * (toks.length - k - 1));
        gen = toks.slice(start, start + k);
        while (gen.length < len) {
          var next = null;
          for (var back = k; back >= 0 && next === null; back--) {
            var m = model(back + 1);
            var ctx = gen.slice(gen.length - back).join("\u0001");
            if (back === 0) ctx = "";
            var dist = m.get(ctx);
            if (dist) next = pick(dist);
          }
          gen.push(next);
        }
        var mod = model(order);
        stBits.set(M.fmt(condEntropy(mod), 2) + " " + t("ngram.perSymbol"));
        stCtx.set(M.fmt(mod.size, 0));
      }
      var text = join(gen, unit);
      out.textContent = text;

      // Longest stretch copied verbatim from the corpus: memorisation made visible.
      var lower = corpus.toLowerCase(), best = 0, i0 = 0;
      while (i0 + best < text.length) {
        if (lower.indexOf(text.slice(i0, i0 + best + 1)) >= 0) best++;
        else i0++;
      }
      stCopy.set(t("ngram.chars_n", { n: best }));
      levelNote.textContent = t("ngram.levels." + (order === 0 ? "zero" : order === 1 ? "one" : order <= 3 ? "low" : "high"));
    }

    generate();
  });
})();
