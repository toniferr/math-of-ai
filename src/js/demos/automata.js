// Chapter "automata" — a 4-bit ripple-carry adder, a finite automaton reading a word, and a toy stored-program CPU.
(function () {
  "use strict";
  var M = window.MOA, h = M.h, s = M.s, t = M.t;
  var SUB = "₀₁₂₃₄₅₆₇₈₉";
  function sub(n) { return String(n).split("").map(function (d) { return SUB[+d]; }).join(""); }

  // ------------------------------------------------------------------ figure 1: the adder

  // One full adder: the five gates and the wires between them, in a 540 × 220 box.
  var GATES = [
    { id: "xor1", op: "XOR", x: 140, y: 30 },
    { id: "and1", op: "AND", x: 140, y: 100 },
    { id: "xor2", op: "XOR", x: 290, y: 50 },
    { id: "and2", op: "AND", x: 290, y: 150 },
    { id: "or", op: "OR", x: 400, y: 120 },
  ];
  var GW = 56, GH = 34;
  var WIRES = { // signal -> polylines
    x: [[[46, 39], [140, 39]], [[80, 39], [80, 109], [140, 109]]],
    y: [[[46, 55], [140, 55]], [[100, 55], [100, 125], [140, 125]]],
    c: [[[46, 200], [260, 200], [260, 175], [290, 175]], [[260, 175], [260, 75], [290, 75]]],
    p: [[[196, 47], [240, 47], [240, 59], [290, 59]], [[240, 59], [240, 159], [290, 159]]],
    g: [[[196, 117], [370, 117], [370, 129], [400, 129]]],
    q: [[[346, 167], [380, 167], [380, 145], [400, 145]]],
    s: [[[346, 67], [496, 67]]],
    co: [[[456, 137], [496, 137]]],
  };
  var JUNCTIONS = { x: [80, 39], y: [100, 55], c: [260, 175], p: [240, 59] };
  var GATE_OUT = { xor1: "p", and1: "g", xor2: "s", and2: "q", or: "co" };

  M.register("automata/adder", function (stage) {
    var A = 5, B = 11, col = 0;
    var table = h("div", { class: "add-grid", role: "group", "aria-label": t("add.label") });
    var circuit = h("div", { class: "add-circuit" });
    stage.appendChild(circuit);
    var svg = M.svgBox(circuit, 540, 220, t("add.circuit"));
    var colSeg = M.segmented({
      label: t("add.column"), value: "0",
      options: [3, 2, 1, 0].map(function (i) { return { value: String(i), label: String(i) }; }),
      onChange: function (v) { col = +v; render(); },
    });
    var stats = h("div", { class: "stats" });
    var stA = M.stat("A"), stB = M.stat("B"), stS = M.stat("A + B", "accent"), stG = M.stat(t("add.gates"));
    [stA, stB, stS, stG].forEach(function (x) { stats.appendChild(x.el); });
    stage.insertBefore(table, circuit);
    stage.insertBefore(M.controls(colSeg.el), circuit);
    stage.appendChild(stats);

    function bit(n, i) { return (n >> i) & 1; }
    function adder() {
      var c = [0], sOut = [], p = [], g = [], q = [];
      for (var i = 0; i < 4; i++) {
        var x = bit(A, i), y = bit(B, i);
        p[i] = x ^ y; g[i] = x & y; q[i] = p[i] & c[i];
        sOut[i] = p[i] ^ c[i];
        c[i + 1] = g[i] | q[i];
      }
      return { c: c, s: sOut, p: p, g: g, q: q };
    }

    function bitButton(which, i, value) {
      return h("button", { type: "button", class: "add-bit" + (value ? " on" : ""), "aria-pressed": value ? "true" : "false",
        "aria-label": which + sub(i) + " = " + value,
        onclick: function () { if (which === "A") A ^= 1 << i; else B ^= 1 << i; render(); } }, String(value));
    }

    function render() {
      var r = adder();
      M.clear(table);
      // Header: column indices 4..0; the selected column is highlighted.
      var rows = [
        [h("span", { class: "add-lbl" }, "")].concat([4, 3, 2, 1, 0].map(function (i) {
          return h("span", { class: "add-idx" + (i === col ? " sel" : "") }, i < 4 ? String(i) : ""); })),
        [h("span", { class: "add-lbl" }, t("add.carry"))].concat([4, 3, 2, 1, 0].map(function (i) {
          return h("span", { class: "add-carry" + (r.c[i] ? " on" : "") + (i === col ? " sel" : "") }, i ? String(r.c[i]) : ""); })),
        [h("span", { class: "add-lbl" }, "A")].concat([h("span")], [3, 2, 1, 0].map(function (i) { return bitButton("A", i, bit(A, i)); })),
        [h("span", { class: "add-lbl" }, "B")].concat([h("span")], [3, 2, 1, 0].map(function (i) { return bitButton("B", i, bit(B, i)); })),
        [h("span", { class: "add-lbl" }, "A + B")].concat([4, 3, 2, 1, 0].map(function (i) {
          var v = i === 4 ? r.c[4] : r.s[i];
          return h("span", { class: "add-sum" + (v ? " on" : "") + (i === col ? " sel" : "") + (i === 4 && v ? " overflow" : "") }, String(v)); })),
      ];
      rows.forEach(function (cells, k) { table.appendChild(h("div", { class: "add-row" + (k === 4 ? " total" : "") }, cells)); });

      // The full adder of the selected column.
      var x = bit(A, col), y = bit(B, col);
      var val = { x: x, y: y, c: r.c[col], p: r.p[col], g: r.g[col], q: r.q[col], s: r.s[col], co: r.c[col + 1] };
      M.clear(svg);
      Object.keys(WIRES).forEach(function (sig) {
        WIRES[sig].forEach(function (line) {
          svg.appendChild(s("path", { class: "wire" + (val[sig] ? " on" : ""), d: M.path(line) }));
        });
        if (JUNCTIONS[sig]) svg.appendChild(s("circle", { class: "junction" + (val[sig] ? " on" : ""), cx: JUNCTIONS[sig][0], cy: JUNCTIONS[sig][1], r: 3 }));
      });
      GATES.forEach(function (gt) {
        var on = val[GATE_OUT[gt.id]];
        svg.appendChild(s("rect", { class: "gate" + (on ? " on" : ""), x: gt.x, y: gt.y, width: GW, height: GH, rx: 7 }));
        svg.appendChild(s("text", { class: "gate-lbl" + (on ? " on" : ""), x: gt.x + GW / 2, y: gt.y + GH / 2 + 4, "text-anchor": "middle" }, gt.op));
      });
      [["x", 39, "x" + sub(col)], ["y", 55, "y" + sub(col)], ["c", 200, "c" + sub(col)]].forEach(function (inp) {
        svg.appendChild(s("text", { class: "pin" + (val[inp[0]] ? " on" : ""), x: 40, y: inp[1] + 4, "text-anchor": "end" }, inp[2] + " = " + val[inp[0]]));
      });
      [["s", 67, "s" + sub(col)], ["co", 137, "c" + sub(col + 1)]].forEach(function (out) {
        svg.appendChild(s("text", { class: "pin" + (val[out[0]] ? " on" : ""), x: 502, y: out[1] + 4 }, out[2] + " = " + val[out[0]]));
      });

      stA.set(A + " = " + pad(A, 4));
      stB.set(B + " = " + pad(B, 4));
      stS.set((A + B) + " = " + pad(A + B, 5));
      stG.set(t("add.gateCount"));
    }
    function pad(n, w) { var b = n.toString(2); while (b.length < w) b = "0" + b; return b; }

    render();
  });

  // ------------------------------------------------------------------ figure 2: a finite automaton

  var DFAS = {
    mult3: {
      alphabet: "01", input: "1001", w: 520, hgt: 190, number: true,
      states: [{ id: "r0", label: "0", x: 110, y: 115, accept: true }, { id: "r1", label: "1", x: 260, y: 115 }, { id: "r2", label: "2", x: 410, y: 115 }],
      start: "r0",
      delta: { r0: { 0: "r0", 1: "r1" }, r1: { 0: "r2", 1: "r0" }, r2: { 0: "r1", 1: "r2" } },
      bend: { "r0>r1": 26, "r1>r0": 26, "r1>r2": 26, "r2>r1": 26 },
      loop: { r0: "left", r2: "right" }, startFrom: "top",
    },
    endsab: {
      alphabet: "ab", input: "abbab", w: 520, hgt: 220,
      states: [{ id: "q0", label: "q₀", x: 110, y: 100 }, { id: "q1", label: "q₁", x: 260, y: 100 }, { id: "q2", label: "q₂", x: 410, y: 100, accept: true }],
      start: "q0",
      delta: { q0: { a: "q1", b: "q0" }, q1: { a: "q1", b: "q2" }, q2: { a: "q1", b: "q0" } },
      bend: { "q1>q2": 24, "q2>q1": 24, "q2>q0": -88 },
      loop: { q0: "up", q1: "up" },
    },
    anbn: {
      alphabet: "ab", input: "aabb", w: 520, hgt: 280, rows: true,
      states: [{ id: "s0", label: "0", x: 70, y: 90 }, { id: "s1", label: "1", x: 185, y: 90 }, { id: "s2", label: "2", x: 300, y: 90 },
        { id: "s3", label: "3", x: 415, y: 90 }, { id: "t2", label: "2", x: 415, y: 215 }, { id: "t1", label: "1", x: 300, y: 215 },
        { id: "t0", label: "0", x: 185, y: 215, accept: true }],
      start: "s0",
      delta: { s0: { a: "s1" }, s1: { a: "s2", b: "t0" }, s2: { a: "s3", b: "t1" }, s3: { b: "t2" }, t2: { b: "t1" }, t1: { b: "t0" } },
      bend: {}, loop: {},
    },
  };
  var R = 22;

  M.register("automata/dfa", function (stage) {
    var key = "mult3", dfa, word, pos, state, dead, lastEdge;
    var seg = M.segmented({
      label: t("dfa.machine"), value: key,
      options: Object.keys(DFAS).map(function (k) { return { value: k, label: t("dfa.machines." + k) }; }),
      onChange: function (v) { key = v; anim.stop(); load(); },
    });
    var inp = h("input", { type: "text", class: "pl-term dfa-input", spellcheck: "false", autocomplete: "off", "aria-label": t("dfa.word") });
    var inCtl = h("div", { class: "ctl" }, h("label", {}, t("dfa.word")), inp);
    var svgWrap = h("div", { class: "dfa-diagram" });
    var tape = h("div", { class: "tape dfa-tape", "aria-hidden": "true" });
    var status = h("p", { class: "tm-status", role: "status", "aria-live": "polite" });
    var stepBtn = M.button(t("dfa.step"), function () { step(); render(); });
    var runBtn = M.button(t("dfa.run"), function () { if (finished()) reset(); anim.toggle(); }, "primary");
    var resetBtn = M.button(t("dfa.reset"), function () { anim.stop(); reset(); render(); });
    stage.appendChild(M.controls(seg.el, inCtl));
    stage.appendChild(svgWrap);
    stage.appendChild(tape);
    stage.appendChild(status);
    stage.appendChild(h("div", { class: "btn-row" }, stepBtn, runBtn, resetBtn));

    var last = 0;
    var anim = M.animator(stage, function () {
      var now = performance.now();
      if (now - last < 450) return true;
      last = now;
      var more = step();
      render();
      return more;
    });
    anim.onchange = function (on) { runBtn.textContent = on ? t("dfa.pause") : t("dfa.run"); };

    inp.addEventListener("input", function () {
      var allowed = dfa.alphabet;
      inp.value = inp.value.split("").filter(function (ch) { return allowed.indexOf(ch) >= 0; }).join("").slice(0, 16);
      anim.stop(); reset(); render();
    });

    function load() { dfa = DFAS[key]; inp.value = dfa.input; reset(); draw(); render(); }
    function reset() { word = inp.value; pos = 0; state = dfa.start; dead = false; lastEdge = null; }
    function finished() { return dead || pos >= word.length; }
    function step() {
      if (finished()) return false;
      var sym = word[pos], next = (dfa.delta[state] || {})[sym];
      if (!next) { dead = true; lastEdge = null; return false; }
      lastEdge = state + ">" + next;
      state = next;
      pos++;
      return !finished();
    }

    var nodes = {}, edges = {};
    function byId(id) { return dfa.states.filter(function (q) { return q.id === id; })[0]; }
    function draw() {
      M.clear(svgWrap);
      var svg = s("svg", { viewBox: "0 0 " + dfa.w + " " + dfa.hgt, class: "demo-svg dfa-svg", role: "img", "aria-label": t("dfa.diagram") });
      svgWrap.appendChild(svg);
      var defs = s("defs");
      ["", "-on"].forEach(function (suf) {
        defs.appendChild(s("marker", { id: "dfa-arrow" + suf, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
          s("path", { d: "M0,0 L10,5 L0,10 z", class: "dfa-arrowhead" + suf })));
      });
      svg.appendChild(defs);
      nodes = {}; edges = {};
      // Group transitions by (from, to) so parallel symbols share one arrow.
      var groups = {};
      Object.keys(dfa.delta).forEach(function (from) {
        Object.keys(dfa.delta[from]).forEach(function (sym) {
          var k = from + ">" + dfa.delta[from][sym];
          (groups[k] = groups[k] || []).push(sym);
        });
      });
      Object.keys(groups).forEach(function (k) {
        var ends = k.split(">"), a = byId(ends[0]), b = byId(ends[1]), d, lx, ly;
        if (a === b) { // a loop on the side given by dfa.loop: up, down, left or right
          var ang = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 }[dfa.loop[a.id] || "up"];
          var at = function (r, da) { return [a.x + r * Math.cos(ang + da), a.y + r * Math.sin(ang + da)]; };
          var p1 = at(R, -0.5), c1 = at(72, -0.42), c2 = at(72, 0.42), p2 = at(R + 2, 0.5), lp = at(66, 0);
          d = "M" + p1.join(",") + " C" + c1.join(",") + " " + c2.join(",") + " " + p2.join(",");
          lx = lp[0] + Math.cos(ang) * 8; ly = lp[1] + Math.sin(ang) * 8 + 4;
        } else {
          var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), bend = dfa.bend[k] || 0;
          var px = -dy / len, py = dx / len;
          var cx = (a.x + b.x) / 2 + px * bend * 2, cy = (a.y + b.y) / 2 + py * bend * 2;
          var ux = cx - a.x, uy = cy - a.y, ul = Math.hypot(ux, uy), vx = b.x - cx, vy = b.y - cy, vl = Math.hypot(vx, vy);
          var sx = a.x + ux / ul * R, sy = a.y + uy / ul * R, ex = b.x - vx / vl * (R + 2), ey = b.y - vy / vl * (R + 2);
          d = "M" + sx.toFixed(1) + "," + sy.toFixed(1) + " Q" + cx.toFixed(1) + "," + cy.toFixed(1) + " " + ex.toFixed(1) + "," + ey.toFixed(1);
          // Label at the curve's midpoint, nudged outwards.
          var mx = 0.25 * sx + 0.5 * cx + 0.25 * ex, my = 0.25 * sy + 0.5 * cy + 0.25 * ey;
          var side = bend === 0 ? -1 : Math.sign(bend);
          lx = mx + px * 12 * side; ly = my + py * 12 * side + 4;
          if (bend === 0 && Math.abs(dy) > Math.abs(dx)) { lx = mx + 12; ly = my + 4; }
        }
        var path = s("path", { class: "dfa-edge", d: d, "marker-end": "url(#dfa-arrow)" });
        var label = s("text", { class: "dfa-sym", x: lx.toFixed(1), y: ly.toFixed(1), "text-anchor": "middle" }, groups[k].join(", "));
        svg.appendChild(path); svg.appendChild(label);
        edges[k] = { path: path, label: label };
      });
      var st = byId(dfa.start), fromTop = dfa.startFrom === "top";
      svg.appendChild(s("path", { class: "dfa-edge", "marker-end": "url(#dfa-arrow)",
        d: fromTop ? "M" + st.x + "," + (st.y - 62) + " L" + st.x + "," + (st.y - R - 2)
          : "M" + (st.x - 56) + "," + st.y + " L" + (st.x - R - 2) + "," + st.y }));
      if (dfa.rows) {
        svg.appendChild(s("text", { class: "dfa-row", x: 30, y: 40 }, t("dfa.rowA")));
        svg.appendChild(s("text", { class: "dfa-row", x: 30, y: 270 }, t("dfa.rowB")));
      }
      dfa.states.forEach(function (q) {
        var g = s("g", { class: "dfa-state" + (q.accept ? " accept" : "") });
        g.appendChild(s("circle", { cx: q.x, cy: q.y, r: R }));
        if (q.accept) g.appendChild(s("circle", { class: "inner", cx: q.x, cy: q.y, r: R - 4 }));
        g.appendChild(s("text", { x: q.x, y: q.y + 5, "text-anchor": "middle" }, q.label));
        svg.appendChild(g);
        nodes[q.id] = g;
      });
    }

    function render() {
      Object.keys(nodes).forEach(function (id) { nodes[id].classList.toggle("active", id === state && !dead); });
      Object.keys(edges).forEach(function (k) {
        var on = k === lastEdge;
        edges[k].path.classList.toggle("on", on);
        edges[k].path.setAttribute("marker-end", on ? "url(#dfa-arrow-on)" : "url(#dfa-arrow)");
        edges[k].label.classList.toggle("on", on);
      });
      M.clear(tape);
      if (!word.length) tape.appendChild(h("div", { class: "cell blank" }, "ε"));
      word.split("").forEach(function (ch, i) {
        tape.appendChild(h("div", { class: "cell" + (i < pos ? " read" : "") + (i === pos && !dead ? " head" : "") }, ch));
      });
      var q = byId(state), accepted = q && q.accept;
      var extra = dfa.number && word ? " · " + t("dfa.value", { bin: word, dec: parseInt(word, 2) }) : "";
      if (dead) {
        status.className = "tm-status bad";
        status.textContent = t("dfa.dead", { sym: word[pos] }) + extra;
      } else if (pos >= word.length) {
        status.className = "tm-status " + (accepted ? "halted" : "bad");
        status.textContent = t(accepted ? "dfa.accept" : "dfa.reject", { state: q.label }) + extra;
      } else {
        status.className = "tm-status";
        status.textContent = t("dfa.status", { state: q.label, read: pos, total: word.length }) + extra;
      }
      stepBtn.disabled = finished();
    }

    load();
  });

  // ------------------------------------------------------------------ figure 3: a toy CPU

  var OPS = { 1: "LOAD", 2: "STORE", 3: "ADD", 4: "SUB", 5: "JMP", 6: "JZ", 7: "OUT", 9: "HALT", 0: "HALT" };
  var SIZE = 24;
  var CPU_PROGRAMS = {
    multiply: {
      code: [122, 320, 222, 121, 423, 221, 608, 500, 122, 700, 900],
      data: function (p) { return { 20: p.a, 21: p.b, 22: 0, 23: 1 }; },
      params: [{ key: "a", min: 1, max: 30, value: 6 }, { key: "b", min: 1, max: 30, value: 7 }],
    },
    fibonacci: {
      code: [120, 700, 321, 222, 121, 220, 122, 221, 123, 419, 223, 613, 500, 900],
      data: function (p) { return { 19: 1, 20: 0, 21: 1, 22: 0, 23: p.n }; },
      params: [{ key: "n", min: 1, max: 15, value: 12 }],
    },
  };

  function mnemonic(v) {
    var op = Math.floor(v / 100), addr = v % 100;
    var name = OPS[op];
    if (!name) return "?";
    return op === 7 || op === 9 || op === 0 ? name : name + " " + addr;
  }

  M.register("automata/cpu", function (stage) {
    var progKey = "multiply", params = {}, mem, pc, acc, ir, phase, halted, out, touched, said, steps;
    var progSel = M.segmented({
      label: t("cpu.program"), value: progKey,
      options: Object.keys(CPU_PROGRAMS).map(function (k) { return { value: k, label: t("cpu.programs." + k) }; }),
      onChange: function (v) { progKey = v; anim.stop(); buildParams(); reset(); render(); },
    });
    var paramBox = h("div", { class: "controls" });
    var grid = h("div", { class: "cpu-mem", role: "table", "aria-label": t("cpu.memory") });
    var regs = h("div", { class: "stats cpu-regs" });
    var rPC = M.stat("PC"), rIR = M.stat("IR"), rACC = M.stat("ACC", "accent"), rOut = M.stat(t("cpu.output"));
    [rPC, rIR, rACC, rOut].forEach(function (x) { regs.appendChild(x.el); });
    var phases = h("ol", { class: "cpu-phases" }, ["fetch", "decode", "execute"].map(function (p) { return h("li", { dataset: { phase: p } }, t("cpu.phases." + p)); }));
    var explain = h("p", { class: "cpu-explain", role: "status", "aria-live": "polite" });
    var stepBtn = M.button(t("cpu.step"), function () { step(); render(); });
    var instrBtn = M.button(t("cpu.instr"), function () { do { step(); } while (phase !== "fetch" && !halted); render(); });
    var runBtn = M.button(t("cpu.run"), function () { if (halted) reset(); anim.toggle(); }, "primary");
    var resetBtn = M.button(t("cpu.reset"), function () { anim.stop(); reset(); render(); });

    stage.appendChild(M.controls(progSel.el));
    stage.appendChild(paramBox);
    stage.appendChild(h("div", { class: "cpu-layout" }, grid, h("div", { class: "cpu-side" }, regs, phases, explain)));
    stage.appendChild(h("div", { class: "btn-row" }, stepBtn, instrBtn, runBtn, resetBtn));

    var last = 0;
    var anim = M.animator(stage, function () {
      var now = performance.now();
      if (now - last < 260) return true;
      last = now;
      step();
      render();
      return !halted;
    });
    anim.onchange = function (on) { runBtn.textContent = on ? t("cpu.pause") : t("cpu.run"); };

    function buildParams() {
      M.clear(paramBox);
      params = {};
      CPU_PROGRAMS[progKey].params.forEach(function (p) {
        params[p.key] = p.value;
        var sl = M.slider({ label: t("cpu.params." + p.key), min: p.min, max: p.max, step: 1, value: p.value,
          format: function (v) { return String(Math.round(v)); },
          onInput: function (v) { params[p.key] = Math.round(v); anim.stop(); reset(); render(); } });
        paramBox.appendChild(sl.el);
      });
    }

    function reset() {
      var prog = CPU_PROGRAMS[progKey];
      mem = [];
      for (var i = 0; i < SIZE; i++) mem.push(0);
      prog.code.forEach(function (v, i) { mem[i] = v; });
      var data = prog.data(params);
      Object.keys(data).forEach(function (k) { mem[+k] = data[k]; });
      pc = 0; acc = 0; ir = 0; phase = "fetch"; halted = false; out = []; touched = null; steps = 0;
      said = t("cpu.ready");
    }

    function step() {
      if (halted) return;
      steps++;
      if (steps > 4000) { halted = true; said = t("cpu.limit"); return; }
      var op = Math.floor(ir / 100), addr = ir % 100;
      if (phase === "fetch") {
        ir = mem[pc];
        touched = { cell: pc, kind: "read" };
        said = t("cpu.did.fetch", { pc: pc, ir: pad3(ir) });
        pc = (pc + 1) % SIZE;
        phase = "decode";
        return;
      }
      if (phase === "decode") {
        touched = null;
        said = t(op === 7 || op === 9 || op === 0 ? "cpu.did.decodeBare" : "cpu.did.decode", { ir: pad3(ir), op: OPS[op] || "?", addr: addr });
        phase = "execute";
        return;
      }
      // execute
      touched = null;
      var name = OPS[op];
      if (!name || name === "HALT") { halted = true; said = t("cpu.ops.halt"); phase = "fetch"; return; }
      if (addr >= SIZE && name !== "OUT") { halted = true; said = t("cpu.bad", { addr: addr }); return; }
      switch (name) {
        case "LOAD": acc = mem[addr]; touched = { cell: addr, kind: "read" }; break;
        case "STORE": mem[addr] = acc; touched = { cell: addr, kind: "write" }; break;
        case "ADD": acc = (acc + mem[addr]) % 1000; touched = { cell: addr, kind: "read" }; break;
        case "SUB": acc = (acc - mem[addr] + 1000) % 1000; touched = { cell: addr, kind: "read" }; break;
        case "JMP": pc = addr; break;
        case "JZ": if (acc === 0) pc = addr; break;
        case "OUT": out.push(acc); break;
      }
      var what = name === "JZ" && acc !== 0 ? "jzno" : name.toLowerCase();
      said = t("cpu.ops." + what, { addr: addr, val: mem[addr], acc: acc, pc: pc });
      phase = "fetch";
    }
    function pad3(v) { return ("00" + v).slice(-3); }

    function render() {
      var codeLen = CPU_PROGRAMS[progKey].code.length;
      M.clear(grid);
      for (var i = 0; i < SIZE; i++) {
        var cls = "cpu-cell" + (i < codeLen ? " code" : " data") + (i === pc && !halted ? " pc" : "") +
          (touched && touched.cell === i ? " " + touched.kind : "");
        grid.appendChild(h("div", { class: cls, role: "cell" },
          h("span", { class: "cpu-addr" }, String(i)),
          h("span", { class: "cpu-val" }, pad3(mem[i])),
          h("span", { class: "cpu-mn" }, i < codeLen ? mnemonic(mem[i]) : "")));
      }
      rPC.set(String(pc));
      rIR.set(pad3(ir) + (steps ? " · " + mnemonic(ir) : ""));
      rACC.set(String(acc));
      rOut.set(out.length ? out.join(" ") : "—");
      [].forEach.call(phases.children, function (li) { li.classList.toggle("next", !halted && li.dataset.phase === phase); });
      explain.textContent = said;
      explain.classList.toggle("halted", halted);
      stepBtn.disabled = instrBtn.disabled = halted;
    }

    buildParams();
    reset();
    render();
  });
})();
