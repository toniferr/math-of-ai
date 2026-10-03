// Chapter 00 — a Turing machine you can step through.
(function () {
  "use strict";
  var M = window.MOA, h = M.h, t = M.t;
  var BLANK = "_";
  var NAMED = { right: 1, carry: 1, halt: 1 };
  function stateName(q) { return NAMED[q] ? t("tm.states." + q) : q; }

  // rules[state][symbol] = [write, move, next]
  var PROGRAMS = {
    increment: {
      start: "right",
      input: "1011",
      rules: {
        right: { "0": ["0", "R", "right"], "1": ["1", "R", "right"], _: ["_", "L", "carry"] },
        carry: { "1": ["0", "L", "carry"], "0": ["1", "L", "halt"], _: ["1", "L", "halt"] },
      },
    },
    beaver: {
      start: "A",
      input: "",
      rules: {
        A: { _: ["1", "R", "B"], "1": ["1", "L", "B"] },
        B: { _: ["1", "L", "A"], "1": ["1", "R", "halt"] },
      },
    },
    loop: {
      start: "A",
      input: "",
      rules: {
        A: { _: ["1", "R", "B"], "1": ["1", "R", "B"] },
        B: { _: ["_", "L", "A"], "1": ["1", "L", "A"] },
      },
    },
  };

  M.register("computation/turing-machine", function (stage) {
    var program = "increment";
    var tape, head, state, steps;
    var VISIBLE = 15;

    var tapeEl = h("div", { class: "tape", "aria-hidden": "true" });
    var markerEl = h("div", { class: "head-marker", "aria-hidden": "true" }, "▲");
    var status = h("p", { class: "tm-status", role: "status", "aria-live": "polite" });
    var table = h("table", { class: "rules" });
    var inputBox = h("input", { type: "text", value: PROGRAMS.increment.input, inputmode: "numeric",
      pattern: "[01]*", maxlength: "10", size: "8", "aria-label": t("tm.input"), class: "tm-input" });
    var inputCtl = h("div", { class: "ctl" }, h("label", {}, t("tm.input")), inputBox);

    var runBtn = M.button(t("tm.run"), function () { anim.toggle(); }, "primary");
    var stepBtn = M.button(t("tm.step"), function () { step(); render(); });
    var resetBtn = M.button(t("tm.reset"), function () { anim.stop(); reset(); render(); });
    var programSel = M.select({
      label: t("tm.program"), value: program,
      options: ["increment", "beaver", "loop"].map(function (p) { return { value: p, label: t("tm.programs." + p) }; }),
      onChange: function (v) { program = v; anim.stop(); inputCtl.hidden = v !== "increment"; reset(); render(); },
    });

    var last = 0;
    var anim = M.animator(stage, function () {
      var now = performance.now();
      if (now - last < 280) return true;
      last = now;
      var ok = step();
      render();
      return ok;
    });
    anim.onchange = function (on) { runBtn.textContent = on ? t("tm.pause") : t("tm.run"); };

    inputBox.addEventListener("input", function () {
      inputBox.value = inputBox.value.replace(/[^01]/g, "");
      anim.stop();
      reset();
      render();
    });

    stage.appendChild(M.controls(programSel.el, inputCtl));
    stage.appendChild(markerEl);
    stage.appendChild(tapeEl);
    stage.appendChild(status);
    stage.appendChild(h("div", { class: "btn-row" }, stepBtn, runBtn, resetBtn));
    stage.appendChild(table);

    function reset() {
      var p = PROGRAMS[program];
      tape = {};
      var input = program === "increment" ? (inputBox.value || "0") : p.input;
      for (var i = 0; i < input.length; i++) tape[i] = input[i];
      head = 0;
      state = p.start;
      steps = 0;
    }

    function read(i) { return tape[i] || BLANK; }

    function step() {
      if (state === "halt") return false;
      var sym = read(head);
      var rule = PROGRAMS[program].rules[state][sym];
      if (!rule) { state = "halt"; return false; }
      if (rule[0] === BLANK) delete tape[head]; else tape[head] = rule[0];
      head += rule[1] === "R" ? 1 : -1;
      state = rule[2];
      steps++;
      if (steps > 5000) { anim.stop(); return false; }
      return state !== "halt";
    }

    function render() {
      M.clear(tapeEl);
      var from = head - Math.floor(VISIBLE / 2);
      for (var i = from; i < from + VISIBLE; i++) {
        var sym = read(i);
        tapeEl.appendChild(h("div", { class: "cell" + (sym === BLANK ? " blank" : "") + (i === head ? " head" : "") },
          sym === BLANK ? "·" : sym));
      }
      var ones = Object.keys(tape).filter(function (k) { return tape[k] === "1"; }).length;
      if (state === "halt") {
        status.className = "tm-status halted";
        status.textContent = t("tm.halted", { steps: steps, ones: ones });
      } else {
        status.className = "tm-status";
        status.textContent = t("tm.status", { state: stateName(state), steps: steps }) +
          (program === "loop" && steps > 12 ? " · " + t("tm.never") : "");
      }

      M.clear(table);
      table.appendChild(h("thead", {}, h("tr", {},
        ["state", "read", "write", "move", "next"].map(function (k) { return h("th", {}, t("tm.cols." + k)); }))));
      var body = h("tbody");
      var rules = PROGRAMS[program].rules;
      var pending = state !== "halt" ? state + "|" + read(head) : null;
      Object.keys(rules).forEach(function (q) {
        Object.keys(rules[q]).forEach(function (sym) {
          var r = rules[q][sym];
          var key = q + "|" + sym;
          body.appendChild(h("tr", { class: key === pending ? "active" : "" },
            h("td", {}, stateName(q)), h("td", {}, sym === BLANK ? "·" : sym), h("td", {}, r[0] === BLANK ? "·" : r[0]),
            h("td", {}, r[1] === "R" ? "→" : "←"), h("td", {}, stateName(r[2]))));
        });
      });
      table.appendChild(body);
      stepBtn.disabled = state === "halt";
      runBtn.disabled = state === "halt";
      if (state === "halt") runBtn.textContent = t("tm.run");
    }

    reset();
    render();
  });
})();
