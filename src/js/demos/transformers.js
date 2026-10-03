// Chapter 08 — three hand-designed attention heads over one sentence: scores = q·k / sqrt(d_k), then softmax.
(function () {
  "use strict";
  var M = window.MOA, h = M.h, s = M.s, t = M.t;

  // Simple features per token. In a real model these would be built by the layers below.
  // "seek" marks words that must agree with a noun; "ga"/"gb" are the two agreement classes
  // (feminine/masculine in Spanish, plural/singular in English).
  var SENTENCES = {
    es: { query: 8, tokens: [
      { w: "La", seek: 1, ga: 1 },
      { w: "gata", noun: 1, ga: 1, subj: 1 },
      { w: "que", rel: 1 },
      { w: "perseguía", verb: 1 },
      { w: "al", seek: 1, gb: 1 },
      { w: "ratón", noun: 1, gb: 1 },
      { w: "estaba", verb: 1 },
      { w: "muy", adv: 1 },
      { w: "cansada", seek: 1, ga: 1 },
    ] },
    en: { query: 6, tokens: [
      { w: "The", seek: 1 },
      { w: "cats", noun: 1, ga: 1, subj: 1 },
      { w: "that", rel: 1 },
      { w: "chased", verb: 1 },
      { w: "the", seek: 1 },
      { w: "mouse", noun: 1, gb: 1 },
      { w: "were", verb: 1, seek: 1, ga: 1 },
      { w: "very", adv: 1 },
      { w: "tired", adj: 1 },
    ] },
  };
  var TOKENS = [];
  function f(tok, k) { return tok[k] || 0; }

  // Positional code: p_i = [cos(w i), sin(w i)] for a few frequencies. Rotating by -w is linear, so
  // W_Q p_i = p_{i-1} and the query of position i matches the key of position i - 1.
  var FREQS = [0.55, 1.2, 2.1];
  function pos(i) {
    var out = [];
    FREQS.forEach(function (w) { out.push(Math.cos(w * i), Math.sin(w * i)); });
    return out;
  }

  var HEADS = {
    agreement: {
      q: function (tok) { var seek = f(tok, "seek"); return [2 * seek, 2 * seek * f(tok, "ga"), 2 * seek * f(tok, "gb")]; },
      k: function (tok) { var n = f(tok, "noun"); return [2 * n, 2 * n * f(tok, "ga"), 2 * n * f(tok, "gb")]; },
    },
    previous: {
      q: function (tok, i) { return pos(i - 1).map(function (v) { return 2.2 * v; }); },
      k: function (tok, i) { return pos(i); },
    },
    subject: {
      q: function (tok) { var v = f(tok, "verb"), r = f(tok, "rel"); return [3 * v + 2 * r, 2 * v + 2 * r]; },
      k: function (tok) { return [2 * f(tok, "subj"), f(tok, "noun")]; },
    },
  };

  M.register("transformers/attention", function (stage) {
    var sentence = SENTENCES[M.lang()] || SENTENCES.en;
    TOKENS = sentence.tokens;
    var head = "agreement", query = sentence.query, causal = false, scaled = true, sharp = 1;
    var T = TOKENS.length;

    var tokRow = h("div", { class: "attn-tokens", role: "group", "aria-label": t("attn.tokens") });
    var detail = h("p", { class: "demo-title", "aria-live": "polite" });
    var heat = M.svgBox(h("div", { class: "attn-heat" }), 470, 452, t("attn.matrix"));
    var formula = h("div", { class: "attn-scores" });

    stage.appendChild(M.controls(
      M.segmented({ label: t("attn.head"), value: head,
        options: ["agreement", "previous", "subject"].map(function (k) { return { value: k, label: t("attn.heads." + k) }; }),
        onChange: function (v) { head = v; draw(); } }).el,
      M.toggle({ label: t("attn.causal"), checked: causal, onChange: function (v) { causal = v; draw(); } }).el,
      M.toggle({ label: t("attn.scale"), checked: scaled, onChange: function (v) { scaled = v; draw(); } }).el,
      M.slider({ label: t("attn.sharp"), min: 0.1, max: 4, log: true, value: sharp, format: function (v) { return "×" + M.fmt(v, 2); },
        onInput: function (v) { sharp = v; draw(); } }).el));
    stage.appendChild(h("p", { class: "demo-hint" }, t("attn.hint")));
    stage.appendChild(tokRow);
    stage.appendChild(detail);
    stage.appendChild(h("div", { class: "panel-grid attn-grid" }, heat.parentNode, formula));

    function weights() {
      var H = HEADS[head];
      var Q = TOKENS.map(function (tok, i) { return H.q(tok, i); });
      var K = TOKENS.map(function (tok, i) { return H.k(tok, i); });
      var dk = Q[0].length;
      var scores = Q.map(function (q, i) {
        return K.map(function (k, j) {
          if (causal && j > i) return -Infinity;
          var dot = q.reduce(function (a, qv, d) { return a + qv * k[d]; }, 0);
          return sharp * (scaled ? dot / Math.sqrt(dk) : dot);
        });
      });
      var A = scores.map(function (row) {
        var finite = row.filter(isFinite);
        var m = Math.max.apply(null, finite);
        var e = row.map(function (v) { return isFinite(v) ? Math.exp(v - m) : 0; });
        var z = e.reduce(function (a, b) { return a + b; }, 0);
        return e.map(function (v) { return v / z; });
      });
      return { A: A, scores: scores, dk: dk };
    }

    function draw() {
      var r = weights();
      var row = r.A[query];

      M.clear(tokRow);
      TOKENS.forEach(function (tok, j) {
        var bar = h("span", { class: "w", "aria-hidden": "true" });
        bar.style.transform = "scaleX(" + row[j].toFixed(3) + ")";
        tokRow.appendChild(h("button", { type: "button", class: "attn-tok" + (causal && j > query ? " masked" : ""),
          "aria-pressed": j === query ? "true" : "false", onclick: function () { query = j; draw(); } }, tok.w, bar));
      });

      var best = 0;
      row.forEach(function (v, j) { if (v > row[best]) best = j; });
      detail.textContent = t("attn.detail", { q: TOKENS[query].w, k: TOKENS[best].w, p: M.pct(row[best], 0) });

      // Heatmap: rows are queries, columns keys.
      M.clear(heat);
      var x0 = 86, y0 = 70, c = 42;
      TOKENS.forEach(function (tok, j) {
        heat.appendChild(s("text", { x: x0 + j * c + c / 2, y: y0 - 8, "text-anchor": "start",
          transform: "rotate(-40 " + (x0 + j * c + c / 2) + " " + (y0 - 8) + ")", class: j === best ? "label-strong" : "" }, tok.w));
      });
      r.A.forEach(function (wrow, i) {
        heat.appendChild(s("text", { x: x0 - 8, y: y0 + i * c + c / 2 + 4, "text-anchor": "end", class: i === query ? "label-strong" : "" }, TOKENS[i].w));
        wrow.forEach(function (v, j) {
          var masked = causal && j > i;
          heat.appendChild(s("rect", { x: x0 + j * c + 1, y: y0 + i * c + 1, width: c - 2, height: c - 2, rx: 3,
            class: masked ? "heat-masked" : "heat-cell", "fill-opacity": masked ? null : (0.05 + 0.95 * v).toFixed(3),
            onclick: function () { query = i; draw(); } }));
          if (!masked && v >= 0.15) {
            heat.appendChild(s("text", { x: x0 + j * c + c / 2, y: y0 + i * c + c / 2 + 4, "text-anchor": "middle",
              class: "heat-label" + (v > 0.5 ? " on-dark" : "") }, Math.round(v * 100)));
          }
        });
      });
      heat.appendChild(s("rect", { x: x0 - 2, y: y0 + query * c - 1, width: T * c + 3, height: c + 2, rx: 4, class: "heat-row" }));

      // Scores and weights for the selected query.
      M.clear(formula);
      formula.appendChild(h("p", { class: "panel-label" }, t("attn.scoresFor", { q: TOKENS[query].w, d: r.dk })));
      var tbl = h("table", { class: "mini-table" },
        h("thead", {}, h("tr", {}, h("th", {}, t("attn.key")), h("th", { class: "num" }, scaled ? "q·k/√dₖ" : "q·k"), h("th", { class: "num" }, t("attn.weight")))));
      var body = h("tbody");
      TOKENS.forEach(function (tok, j) {
        var sc = r.scores[query][j];
        body.appendChild(h("tr", { class: j === best ? "best-row" : "" }, h("td", {}, tok.w),
          h("td", { class: "num" }, isFinite(sc) ? M.fmt(sc, 2) : "−∞"),
          h("td", { class: "num" }, M.pct(row[j], 1))));
      });
      tbl.appendChild(body);
      formula.appendChild(tbl);
    }

    draw();
  });
})();
