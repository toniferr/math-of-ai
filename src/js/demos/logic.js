// Chapter "logic" — unification step by step, the SLD tree of a query, and a Prolog playground.
// The playground runs js/prolog.js (window.Prolog); the other two figures use its parser and their own small
// engines, so every intermediate step can be shown.
(function () {
  "use strict";
  var M = window.MOA, h = M.h, t = M.t;
  var P = window.Prolog;
  var SUB = "₀₁₂₃₄₅₆₇₈₉";

  // ------------------------------------------------------------------ terms

  // Own immutable terms: {k: "v", name, id} | {k: "a", n} | {k: "n", v (string)} | {k: "c", n, args}.
  var nextId = 0;
  function mkVar(name) { return { k: "v", name: name, id: ++nextId }; }

  // Convert a term from prolog.js; vars maps prolog.js variables to ours (shared within one call).
  function fromProlog(x, vars) {
    x = P.deref(x);
    if (x.t === "v") {
      if (!vars.has(x)) vars.set(x, mkVar(x.n === "_" ? "_" + (vars.size + 1) : x.n));
      return vars.get(x);
    }
    if (x.t === "a") return { k: "a", n: x.n };
    if (x.t === "i" || x.t === "f") return { k: "n", v: String(x.v) };
    return { k: "c", n: x.n, args: x.args.map(function (a) { return fromProlog(a, vars); }) };
  }

  function show(x) {
    if (x.k === "v") return x.name;
    if (x.k === "n") return x.v;
    if (x.k === "a") return x.n === "[]" ? "[]" : /^[a-z][A-Za-z0-9_]*$|^[^A-Za-z0-9_\s(),'|]+$/.test(x.n) ? x.n : "'" + x.n + "'";
    if (x.n === "." && x.args.length === 2) {
      var items = [], cur = x;
      while (cur.k === "c" && cur.n === "." && cur.args.length === 2) { items.push(show(cur.args[0])); cur = cur.args[1]; }
      return "[" + items.join(", ") + (cur.k === "a" && cur.n === "[]" ? "" : " | " + show(cur)) + "]";
    }
    if (x.args.length === 2 && /^[^A-Za-z0-9_\s]+$/.test(x.n)) return show(x.args[0]) + " " + x.n + " " + show(x.args[1]);
    return show({ k: "a", n: x.n }) + "(" + x.args.map(show).join(", ") + ")";
  }

  function occurs(v, x) {
    if (x === v) return true;
    return x.k === "c" && x.args.some(function (a) { return occurs(v, a); });
  }
  function subst(x, v, by) {
    if (x === v) return by;
    if (x.k !== "c") return x;
    var changed = false, args = x.args.map(function (a) { var b = subst(a, v, by); if (b !== a) changed = true; return b; });
    return changed ? { k: "c", n: x.n, args: args } : x;
  }
  // Apply a substitution given as a Map var -> term, fully (following chains).
  function apply(x, s) {
    if (x.k === "v") return s.has(x) ? apply(s.get(x), s) : x;
    if (x.k !== "c") return x;
    return { k: "c", n: x.n, args: x.args.map(function (a) { return apply(a, s); }) };
  }
  function sameConst(a, b) { return a.k === b.k && (a.k === "n" ? a.v === b.v : a.n === b.n); }

  // Most general unifier as a Map, or null. When both sides are variables the newer one (a renamed clause
  // variable) is bound to the older one, so the query's variables keep their names.
  function mgu(a, b, s) {
    s = s || new Map();
    var stack = [[a, b]];
    while (stack.length) {
      var p = stack.pop(), x = apply(p[0], s), y = apply(p[1], s);
      if (x === y) continue;
      if (x.k === "v" && y.k === "v") { if (x.id > y.id) s.set(x, y); else s.set(y, x); continue; }
      if (x.k === "v") { if (occurs(x, y)) return null; s.set(x, y); continue; }
      if (y.k === "v") { if (occurs(y, x)) return null; s.set(y, x); continue; }
      if (x.k !== "c" || y.k !== "c") { if (!sameConst(x, y)) return null; continue; }
      if (x.n !== y.n || x.args.length !== y.args.length) return null;
      for (var i = 0; i < x.args.length; i++) stack.push([x.args[i], y.args[i]]);
    }
    return s;
  }

  function sub(n) { return String(n).split("").map(function (d) { return SUB[+d]; }).join(""); }

  // ------------------------------------------------------------------ figure 1: unification

  var UNIFY_EXAMPLES = [
    ["parent(tom, X)", "parent(Y, bob)"],
    ["[H | T]", "[1, 2, 3]"],
    ["f(X, g(Y, a))", "f(h(Z), g(Z, W))"],
    ["p(X, X, Y)", "p(f(Y), f(Z), a)"],
    ["f(a, X)", "g(a, b)"],
    ["X", "f(X)"],
  ];

  M.register("logic/unify", function (stage) {
    var inS = h("input", { type: "text", class: "pl-term", spellcheck: "false", autocomplete: "off", "aria-label": t("uni.left") });
    var inT = h("input", { type: "text", class: "pl-term", spellcheck: "false", autocomplete: "off", "aria-label": t("uni.right") });
    var exSel = M.select({
      label: t("uni.example"), value: "0",
      options: UNIFY_EXAMPLES.map(function (e, i) { return { value: String(i), label: e[0] + " = " + e[1] }; }),
      onChange: function (v) { load(UNIFY_EXAMPLES[+v]); },
    });
    var stepBtn = M.button(t("uni.step"), function () { step(); render(); }, "primary");
    var allBtn = M.button(t("uni.all"), function () { while (step()) { /* until done */ } render(); });
    var resetBtn = M.button(t("uni.reset"), function () { start(); render(); });
    var eqList = h("ol", { class: "uni-eqs", "aria-live": "polite" });
    var log = h("ol", { class: "uni-log" });
    var result = h("p", { class: "uni-result", role: "status" });

    stage.appendChild(M.controls(exSel.el));
    stage.appendChild(h("div", { class: "uni-inputs" }, inS, h("span", { class: "uni-eq-sign" }, "="), inT));
    stage.appendChild(h("div", { class: "btn-row" }, stepBtn, allBtn, resetBtn));
    stage.appendChild(h("div", { class: "panel-grid uni-panels" },
      h("div", {}, h("p", { class: "panel-label" }, t("uni.system")), eqList),
      h("div", {}, h("p", { class: "panel-label" }, t("uni.steps")), log)));
    stage.appendChild(result);

    var eqs, steps, state, s0, t0, error, active;
    [inS, inT].forEach(function (inp) { inp.addEventListener("input", function () { start(); render(); }); });

    function load(ex) { inS.value = ex[0]; inT.value = ex[1]; start(); render(); }

    function start() {
      steps = []; state = "run"; error = null; active = -1;
      try {
        var parsed = P.parse("(" + (inS.value.trim() || "_") + ") = (" + (inT.value.trim() || "_") + ")");
        var vars = new Map(), eq = fromProlog(parsed.term, vars);
        s0 = eq.args[0]; t0 = eq.args[1];
        eqs = [[s0, t0]];
      } catch (e) {
        eqs = []; state = "error"; error = e.message;
      }
    }

    // One Martelli–Montanari step on the first equation where a rule applies. Returns false when finished.
    function step() {
      if (state !== "run") return false;
      for (var i = 0; i < eqs.length; i++) {
        var l = eqs[i][0], r = eqs[i][1], txt = show(l) + " = " + show(r);
        if (l.k !== "v" && r.k !== "v") {
          if (l.k === "c" && r.k === "c" && l.n === r.n && l.args.length === r.args.length) {
            var parts = l.args.map(function (a, j) { return [a, r.args[j]]; });
            eqs.splice.apply(eqs, [i, 1].concat(parts));
            return record("decompose", txt, i);
          }
          if (l.k !== "c" && r.k !== "c" && sameConst(l, r)) { eqs.splice(i, 1); return record("delete", txt, -1); }
          state = "clash"; record("clash", txt, i); return false;
        }
        if (l === r) { eqs.splice(i, 1); return record("delete", txt, -1); }
        if (l.k !== "v") { eqs[i] = [r, l]; return record("swap", txt, i); }
        if (occurs(l, r)) { state = "occurs"; record("occurs", txt, i); return false; }
        var elsewhere = eqs.some(function (e, j) { return j !== i && (occurs(l, e[0]) || occurs(l, e[1])); });
        if (elsewhere) {
          for (var j = 0; j < eqs.length; j++) if (j !== i) eqs[j] = [subst(eqs[j][0], l, r), subst(eqs[j][1], l, r)];
          return record("eliminate", txt, i);
        }
      }
      state = "solved";
      active = -1;
      return false;
    }
    function record(rule, txt, i) {
      steps.push({ rule: rule, text: txt });
      active = i;
      return true;
    }

    function render() {
      M.clear(eqList);
      if (state === "error") eqList.appendChild(h("li", { class: "uni-bad" }, error));
      eqs.forEach(function (e, i) {
        var solved = e[0].k === "v" && !occurs(e[0], e[1]);
        eqList.appendChild(h("li", { class: (i === active ? "active" : "") + (solved ? " solved" : "") },
          show(e[0]) + " = " + show(e[1])));
      });
      if (!eqs.length && state !== "error") eqList.appendChild(h("li", { class: "uni-empty" }, "∅"));
      M.clear(log);
      steps.forEach(function (st) {
        log.appendChild(h("li", { class: st.rule === "clash" || st.rule === "occurs" ? "uni-bad" : "" },
          h("strong", {}, t("uni.rules." + st.rule)), " ", h("code", {}, st.text)));
      });
      log.scrollTop = log.scrollHeight;
      result.className = "uni-result";
      if (state === "solved") {
        var theta = new Map();
        eqs.forEach(function (e) { theta.set(e[0], e[1]); });
        var parts = eqs.map(function (e) { return show(e[0]) + " ↦ " + show(e[1]); });
        result.classList.add("good");
        result.textContent = t("uni.mgu", { theta: "{ " + parts.join(", ") + " }", common: show(apply(s0, theta)) });
      } else if (state === "clash" || state === "occurs") {
        result.classList.add("bad");
        result.textContent = t("uni.fail." + state);
      } else if (state === "error") {
        result.classList.add("bad");
        result.textContent = t("uni.syntax");
      } else {
        result.textContent = steps.length ? t("uni.running", { n: steps.length }) : t("uni.hint");
      }
      stepBtn.disabled = allBtn.disabled = state !== "run";
    }

    load(UNIFY_EXAMPLES[0]);
  });

  // ------------------------------------------------------------------ figure 2: the SLD tree

  var SLD_PROGRAMS = {
    en: {
      family: {
        program: ["parent(tom, bob).", "parent(bob, ann).", "parent(bob, pat).",
          "anc(X, Y) :- parent(X, Y).", "anc(X, Y) :- parent(X, Z), anc(Z, Y)."],
        query: "anc(tom, Who)",
      },
      append: {
        program: ["app([], L, L).", "app([H|T], L, [H|R]) :- app(T, L, R)."],
        query: "app(X, Y, [1, 2])",
      },
      left: {
        program: ["parent(tom, bob).", "parent(bob, ann).", "parent(bob, pat).",
          "anc(X, Y) :- anc(Z, Y), parent(X, Z).", "anc(X, Y) :- parent(X, Y)."],
        query: "anc(tom, Who)",
      },
    },
    es: {
      family: {
        program: ["progenitor(tomas, bea).", "progenitor(bea, ana).", "progenitor(bea, pablo).",
          "antepasado(X, Y) :- progenitor(X, Y).", "antepasado(X, Y) :- progenitor(X, Z), antepasado(Z, Y)."],
        query: "antepasado(tomas, Quien)",
      },
      append: {
        program: ["concat([], L, L).", "concat([H|T], L, [H|R]) :- concat(T, L, R)."],
        query: "concat(X, Y, [1, 2])",
      },
      left: {
        program: ["progenitor(tomas, bea).", "progenitor(bea, ana).", "progenitor(bea, pablo).",
          "antepasado(X, Y) :- antepasado(Z, Y), progenitor(X, Z).", "antepasado(X, Y) :- progenitor(X, Y)."],
        query: "antepasado(tomas, Quien)",
      },
    },
  };

  var MAX_DEPTH = 7, MAX_NODES = 70;

  function conj(x) { // body term -> list of goals
    if (x.k === "c" && x.n === "," && x.args.length === 2) return conj(x.args[0]).concat(conj(x.args[1]));
    if (x.k === "a" && x.n === "true") return [];
    return [x];
  }
  function renameClause(c, level) {
    var map = new Map();
    function r(x) {
      if (x.k === "v") { if (!map.has(x)) map.set(x, mkVar(x.name + sub(level))); return map.get(x); }
      if (x.k === "c") return { k: "c", n: x.n, args: x.args.map(r) };
      return x;
    }
    return { head: r(c.head), body: c.body.map(r) };
  }
  function varsOf(x, acc) {
    acc = acc || [];
    if (x.k === "v") { if (acc.indexOf(x) < 0) acc.push(x); }
    else if (x.k === "c") x.args.forEach(function (a) { varsOf(a, acc); });
    return acc;
  }

  // Build the SLD tree with Prolog's computation rule (leftmost goal) and clause order, cut at MAX_DEPTH.
  function buildTree(clauses, goals, qvars) {
    var count = 0;
    function node(goals, answer, depth, label) {
      var n = { goals: goals, answer: answer, depth: depth, label: label, children: [], status: "inner" };
      count++;
      if (!goals.length) { n.status = "success"; return n; }
      if (depth >= MAX_DEPTH || count >= MAX_NODES) { n.status = "cut"; return n; }
      var g = goals[0], rest = goals.slice(1);
      clauses.forEach(function (c, ci) {
        var rc = renameClause(c, depth + 1);
        var s = mgu(g, rc.head);
        if (!s) return;
        if (count >= MAX_NODES) { n.truncated = true; return; }
        var newGoals = rc.body.concat(rest).map(function (x) { return apply(x, s); });
        var shown = varsOf({ k: "c", n: ",", args: goals }).filter(function (v) { return s.has(v); })
          .map(function (v) { return v.name + " = " + show(apply(v, s)); });
        n.children.push(node(newGoals, answer.map(function (x) { return apply(x, s); }), depth + 1,
          { clause: ci + 1, bindings: shown }));
      });
      if (!n.children.length && !n.truncated) n.status = "fail";
      return n;
    }
    return node(goals, qvars, 0, null);
  }

  M.register("logic/sld", function (stage) {
    var lang = M.lang() === "es" ? "es" : "en";
    var preset = "family";
    var seg = M.segmented({
      label: t("sld.program"), value: preset,
      options: ["family", "append", "left"].map(function (k) { return { value: k, label: t("sld.presets." + k) }; }),
      onChange: function (v) { preset = v; build(); render(); },
    });
    var allShown = false;
    var progEl = h("ol", { class: "sld-program" });
    var queryEl = h("p", { class: "sld-query" });
    var rowsEl = h("ol", { class: "sld-rows", "aria-live": "polite" });
    var answersEl = h("p", { class: "sld-answers", role: "status" });
    var stepBtn = M.button(t("sld.step"), function () { if (shown < rows.length) shown++; render(); }, "primary");
    var allBtn = M.button(t("sld.all"), function () { shown = limitRow(); allShown = true; render(); });
    var resetBtn = M.button(t("sld.reset"), function () { shown = 1; allShown = false; render(); });

    stage.appendChild(M.controls(seg.el));
    stage.appendChild(h("div", { class: "sld-head" }, h("div", {}, h("p", { class: "panel-label" }, t("sld.clauses")), progEl),
      h("div", {}, h("p", { class: "panel-label" }, t("sld.query")), queryEl)));
    stage.appendChild(h("div", { class: "btn-row" }, stepBtn, allBtn, resetBtn));
    stage.appendChild(rowsEl);
    stage.appendChild(answersEl);

    var rows, shown, qnames;

    function build() {
      var def = SLD_PROGRAMS[lang][preset];
      var clauses = P.parseProgram(def.program.join("\n")).map(function (c) {
        var vars = new Map(), term = fromProlog(c.term, vars);
        if (term.k === "c" && term.n === ":-" && term.args.length === 2) return { head: term.args[0], body: conj(term.args[1]) };
        return { head: term, body: [] };
      });
      var q = P.parse(def.query), qv = new Map(), goal = fromProlog(q.term, qv);
      var qvars = q.varList.filter(function (n) { return n[0] !== "_"; }).map(function (n) { return qv.get(q.vars[n]); });
      qnames = qvars.map(function (v) { return v.name; });
      var tree = buildTree(clauses, conj(goal), qvars);

      // Flatten in depth-first order: the order in which Prolog visits the nodes.
      rows = [];
      (function walk(n) { rows.push(n); n.children.forEach(walk); })(tree);
      var cutAt = -1;
      rows.forEach(function (r, i) { if (cutAt < 0 && r.status === "cut") cutAt = i; r.unreached = cutAt >= 0 && i > cutAt; });
      shown = 1;
      allShown = false;

      M.clear(progEl);
      def.program.forEach(function (line, i) { progEl.appendChild(h("li", {}, h("span", { class: "sld-cn" }, "C" + (i + 1)), h("code", {}, line))); });
      queryEl.textContent = "?- " + def.query + ".";
    }

    function limitRow() { // "show all" stops where Prolog would loop forever
      for (var i = 0; i < rows.length; i++) if (rows[i].status === "cut") return i + 1;
      return rows.length;
    }

    function render() {
      M.clear(rowsEl);
      var answers = [];
      rows.forEach(function (r, i) {
        // Rows appear in Prolog's order; after "show all", the ones Prolog never reaches appear greyed out.
        if (i >= shown && !(r.unreached && allShown)) return;
        var body = [];
        if (r.label) {
          body.push(h("span", { class: "sld-edge" }, "C" + r.label.clause + (r.label.bindings.length ? " · " + r.label.bindings.join(", ") : "")));
        }
        if (r.status === "success") {
          var ans = qnames.map(function (n, k) { return n + " = " + show(r.answer[k]); }).join(", ") || t("sld.true");
          body.push(h("span", { class: "sld-goal sld-ok" }, "□ " + ans));
          if (!r.unreached) answers.push(ans);
        } else {
          body.push(h("span", { class: "sld-goal" }, r.goals.map(show).join(", ")));
          if (r.status === "fail") body.push(h("span", { class: "sld-mark sld-bad" }, "✗"));
          if (r.status === "cut") body.push(h("span", { class: "sld-mark sld-loop" }, t("sld.forever")));
          if (r.truncated) body.push(h("span", { class: "sld-mark" }, "…"));
        }
        var li = h("li", { class: "sld-row" + (i === shown - 1 && !allShown ? " active" : "") + (r.unreached ? " unreached" : "") }, body);
        li.style.setProperty("--d", r.depth);
        rowsEl.appendChild(li);
      });
      var done = shown >= limitRow(), list = answers.join(" ; ") || "—";
      var loops = rows.some(function (r) { return r.status === "cut"; });
      answersEl.className = "sld-answers" + (done ? (loops ? " bad" : " good") : "");
      answersEl.textContent = t(!done ? "sld.found" : loops ? "sld.loops" : "sld.done", { list: list });
      stepBtn.disabled = done;
      allBtn.disabled = done && allShown;
    }

    build();
    render();
  });

  // ------------------------------------------------------------------ figure 3: the playground

  function lines() { return [].slice.call(arguments).join("\n"); }

  var EXAMPLES = {
    en: [
      { id: "family", code: lines(
        "% Facts: who is a parent of whom.",
        "parent(tom, bob).",
        "parent(tom, liz).",
        "parent(bob, ann).",
        "parent(bob, pat).",
        "parent(pat, jim).",
        "",
        "% Rules. Read \":-\" as \"if\" and \",\" as \"and\".",
        "anc(X, Y) :- parent(X, Y).",
        "anc(X, Y) :- parent(X, Z), anc(Z, Y).",
        "",
        "sibling(X, Y) :- parent(P, X), parent(P, Y), X \\= Y."),
        queries: ["anc(tom, Who)", "sibling(ann, S)", "anc(A, jim)", "findall(D, anc(tom, D), L), length(L, N)"] },
      { id: "lists", code: lines(
        "% Lists are [Head | Tail]. One definition, many directions.",
        "app([], L, L).",
        "app([H|T], L, [H|R]) :- app(T, L, R).",
        "",
        "len([], 0).",
        "len([_|T], N) :- len(T, N0), N is N0 + 1.",
        "",
        "rev(L, R) :- rev(L, [], R).",
        "rev([], Acc, Acc).",
        "rev([H|T], Acc, R) :- rev(T, [H|Acc], R).",
        "",
        "last_of(L, X) :- app(_, [X], L)."),
        queries: ["app(X, Y, [1, 2, 3])", "app([a, b], [c], L)", "rev([1, 2, 3, 4], R)", "len([a, b, c], N)", "last_of([x, y, z], X)"] },
      { id: "peano", code: lines(
        "% Natural numbers built from 0 and the successor s(N), as in Peano's axioms.",
        "nat(0).",
        "nat(s(N)) :- nat(N).",
        "",
        "add(0, Y, Y).",
        "add(s(X), Y, s(Z)) :- add(X, Y, Z).",
        "",
        "mul(0, _, 0).",
        "mul(s(X), Y, Z) :- mul(X, Y, W), add(W, Y, Z).",
        "",
        "leq(X, Y) :- add(X, _, Y)."),
        queries: ["add(s(0), s(s(0)), Z)", "add(X, Y, s(s(s(0))))", "mul(s(s(0)), s(s(s(0))), Z)", "nat(N)"] },
      { id: "numbers", code: lines(
        "% Arithmetic with \"is\". Integers have no size limit.",
        "fact(0, 1) :- !.",
        "fact(N, F) :- N > 0, N1 is N - 1, fact(N1, F1), F is N * F1.",
        "",
        "fib(N, F) :- fib(N, 0, 1, F).",
        "fib(0, A, _, A) :- !.",
        "fib(N, A, B, F) :- N1 is N - 1, C is A + B, fib(N1, B, C, F).",
        "",
        "gcd(A, 0, A) :- !.",
        "gcd(A, B, G) :- R is A mod B, gcd(B, R, G).",
        "",
        "prime(N) :- N > 1, \\+ has_factor(N, 2).",
        "has_factor(N, F) :- F * F =< N, ( N mod F =:= 0 -> true ; F1 is F + 1, has_factor(N, F1) )."),
        queries: ["fact(50, F)", "fib(100, F)", "gcd(1071, 462, G)", "findall(P, (between(1, 60, P), prime(P)), Ps)"] },
      { id: "sorting", code: lines(
        "% Quicksort: partition around a pivot, sort both halves, join them.",
        "qsort([], []).",
        "qsort([P|Xs], S) :-",
        "    partition(Xs, P, Small, Big),",
        "    qsort(Small, S1), qsort(Big, S2),",
        "    append(S1, [P|S2], S).",
        "",
        "partition([], _, [], []).",
        "partition([X|Xs], P, [X|S], B) :- X =< P, !, partition(Xs, P, S, B).",
        "partition([X|Xs], P, S, [X|B]) :- partition(Xs, P, S, B).",
        "",
        "% A sorted permutation, by brute force: correct, and hopelessly slow.",
        "slow_sort(L, S) :- permutation(L, S), sorted(S), !.",
        "sorted([]).",
        "sorted([_]).",
        "sorted([A, B|T]) :- A =< B, sorted([B|T])."),
        queries: ["qsort([3, 1, 4, 1, 5, 9, 2, 6, 5, 3], S)", "slow_sort([5, 2, 4, 1, 3], S)", "msort([pear, apple, fig], S)"] },
      { id: "queens", code: lines(
        "% N queens: one queen per column; Qs lists the row of each one.",
        "queens(N, Qs) :- numlist(1, N, Rows), place(Rows, [], Qs).",
        "",
        "place([], Qs, Qs).",
        "place(Rows, Placed, Qs) :-",
        "    select(Q, Rows, Rest),",
        "    safe(Q, Placed, 1),",
        "    place(Rest, [Q|Placed], Qs).",
        "",
        "% No queen already placed on a diagonal at distance D.",
        "safe(_, [], _).",
        "safe(Q, [Q1|Qs], D) :- Q =\\= Q1 + D, Q =\\= Q1 - D, D1 is D + 1, safe(Q, Qs, D1)."),
        queries: ["queens(8, Qs)", "findall(Q, queens(6, Q), L), length(L, N)", "aggregate_all(count, queens(8, _), N)"] },
      { id: "grammar", code: lines(
        "% A definite clause grammar: \"-->\" rules that consume a list of words.",
        "% The argument builds the parse tree.",
        "sentence(s(NP, VP)) --> noun_phrase(NP), verb_phrase(VP).",
        "noun_phrase(np(D, N)) --> det(D), noun(N).",
        "verb_phrase(vp(V, NP)) --> verb(V), noun_phrase(NP).",
        "verb_phrase(vp(V)) --> verb(V).",
        "",
        "det(d(the)) --> [the].",
        "det(d(a)) --> [a].",
        "noun(n(cat)) --> [cat].",
        "noun(n(mouse)) --> [mouse].",
        "verb(v(chases)) --> [chases].",
        "verb(v(sleeps)) --> [sleeps]."),
        queries: ["phrase(sentence(T), [the, cat, chases, a, mouse])", "phrase(sentence(_), [a, mouse, sleeps])", "phrase(sentence(_), S)"] },
      { id: "hanoi", code: lines(
        "% The towers of Hanoi, printing each move.",
        "hanoi(N) :- move(N, left, right, centre).",
        "",
        "move(0, _, _, _) :- !.",
        "move(N, From, To, Via) :-",
        "    M is N - 1,",
        "    move(M, From, Via, To),",
        "    format(\"Move a disc from ~w to ~w~n\", [From, To]),",
        "    move(M, Via, To, From)."),
        queries: ["hanoi(3)", "hanoi(4)"] },
    ],
    es: [
      { id: "family", code: lines(
        "% Hechos: quién es progenitor de quién.",
        "progenitor(tomas, bea).",
        "progenitor(tomas, luis).",
        "progenitor(bea, ana).",
        "progenitor(bea, pablo).",
        "progenitor(pablo, jaime).",
        "",
        "% Reglas. Lee \":-\" como \"si\" y \",\" como \"y\".",
        "antepasado(X, Y) :- progenitor(X, Y).",
        "antepasado(X, Y) :- progenitor(X, Z), antepasado(Z, Y).",
        "",
        "hermano(X, Y) :- progenitor(P, X), progenitor(P, Y), X \\= Y."),
        queries: ["antepasado(tomas, Quien)", "hermano(ana, H)", "antepasado(A, jaime)", "findall(D, antepasado(tomas, D), L), length(L, N)"] },
      { id: "lists", code: lines(
        "% Las listas son [Cabeza | Resto]. Una sola definición, muchos sentidos.",
        "concat([], L, L).",
        "concat([H|T], L, [H|R]) :- concat(T, L, R).",
        "",
        "longitud([], 0).",
        "longitud([_|T], N) :- longitud(T, N0), N is N0 + 1.",
        "",
        "invertir(L, R) :- invertir(L, [], R).",
        "invertir([], Acc, Acc).",
        "invertir([H|T], Acc, R) :- invertir(T, [H|Acc], R).",
        "",
        "ultimo(L, X) :- concat(_, [X], L)."),
        queries: ["concat(X, Y, [1, 2, 3])", "concat([a, b], [c], L)", "invertir([1, 2, 3, 4], R)", "longitud([a, b, c], N)", "ultimo([x, y, z], X)"] },
      { id: "peano", code: lines(
        "% Los naturales construidos con 0 y el sucesor s(N), como en los axiomas de Peano.",
        "nat(0).",
        "nat(s(N)) :- nat(N).",
        "",
        "suma(0, Y, Y).",
        "suma(s(X), Y, s(Z)) :- suma(X, Y, Z).",
        "",
        "producto(0, _, 0).",
        "producto(s(X), Y, Z) :- producto(X, Y, W), suma(W, Y, Z).",
        "",
        "menor_igual(X, Y) :- suma(X, _, Y)."),
        queries: ["suma(s(0), s(s(0)), Z)", "suma(X, Y, s(s(s(0))))", "producto(s(s(0)), s(s(s(0))), Z)", "nat(N)"] },
      { id: "numbers", code: lines(
        "% Aritmética con \"is\". Los enteros no tienen límite de tamaño.",
        "fact(0, 1) :- !.",
        "fact(N, F) :- N > 0, N1 is N - 1, fact(N1, F1), F is N * F1.",
        "",
        "fib(N, F) :- fib(N, 0, 1, F).",
        "fib(0, A, _, A) :- !.",
        "fib(N, A, B, F) :- N1 is N - 1, C is A + B, fib(N1, B, C, F).",
        "",
        "mcd(A, 0, A) :- !.",
        "mcd(A, B, G) :- R is A mod B, mcd(B, R, G).",
        "",
        "primo(N) :- N > 1, \\+ tiene_divisor(N, 2).",
        "tiene_divisor(N, F) :- F * F =< N, ( N mod F =:= 0 -> true ; F1 is F + 1, tiene_divisor(N, F1) )."),
        queries: ["fact(50, F)", "fib(100, F)", "mcd(1071, 462, G)", "findall(P, (between(1, 60, P), primo(P)), Ps)"] },
      { id: "sorting", code: lines(
        "% Quicksort: partir en torno a un pivote, ordenar las dos mitades y unirlas.",
        "qsort([], []).",
        "qsort([P|Xs], S) :-",
        "    partir(Xs, P, Menores, Mayores),",
        "    qsort(Menores, S1), qsort(Mayores, S2),",
        "    append(S1, [P|S2], S).",
        "",
        "partir([], _, [], []).",
        "partir([X|Xs], P, [X|Me], Ma) :- X =< P, !, partir(Xs, P, Me, Ma).",
        "partir([X|Xs], P, Me, [X|Ma]) :- partir(Xs, P, Me, Ma).",
        "",
        "% Una permutación ordenada, por fuerza bruta: correcta y desesperadamente lenta.",
        "ordenar_lento(L, S) :- permutation(L, S), ordenada(S), !.",
        "ordenada([]).",
        "ordenada([_]).",
        "ordenada([A, B|T]) :- A =< B, ordenada([B|T])."),
        queries: ["qsort([3, 1, 4, 1, 5, 9, 2, 6, 5, 3], S)", "ordenar_lento([5, 2, 4, 1, 3], S)", "msort([pera, manzana, higo], S)"] },
      { id: "queens", code: lines(
        "% N reinas: una reina por columna; Qs da la fila de cada una.",
        "reinas(N, Qs) :- numlist(1, N, Filas), colocar(Filas, [], Qs).",
        "",
        "colocar([], Qs, Qs).",
        "colocar(Filas, Puestas, Qs) :-",
        "    select(Q, Filas, Resto),",
        "    segura(Q, Puestas, 1),",
        "    colocar(Resto, [Q|Puestas], Qs).",
        "",
        "% Ninguna reina ya colocada en diagonal a distancia D.",
        "segura(_, [], _).",
        "segura(Q, [Q1|Qs], D) :- Q =\\= Q1 + D, Q =\\= Q1 - D, D1 is D + 1, segura(Q, Qs, D1)."),
        queries: ["reinas(8, Qs)", "findall(Q, reinas(6, Q), L), length(L, N)", "aggregate_all(count, reinas(8, _), N)"] },
      { id: "grammar", code: lines(
        "% Una gramática de cláusulas definidas: reglas \"-->\" que consumen una lista de palabras.",
        "% El argumento construye el árbol sintáctico.",
        "oracion(o(SN, SV)) --> sintagma_nominal(SN), sintagma_verbal(SV).",
        "sintagma_nominal(sn(D, N)) --> det(D), nombre(N).",
        "sintagma_verbal(sv(V, SN)) --> verbo(V), sintagma_nominal(SN).",
        "sintagma_verbal(sv(V)) --> verbo(V).",
        "",
        "det(d(el)) --> [el].",
        "det(d(un)) --> [un].",
        "nombre(n(gato)) --> [gato].",
        "nombre(n(raton)) --> [raton].",
        "verbo(v(persigue)) --> [persigue].",
        "verbo(v(duerme)) --> [duerme]."),
        queries: ["phrase(oracion(T), [el, gato, persigue, un, raton])", "phrase(oracion(_), [un, raton, duerme])", "phrase(oracion(_), S)"] },
      { id: "hanoi", code: lines(
        "% Las torres de Hanói, escribiendo cada movimiento.",
        "hanoi(N) :- mover(N, izquierda, derecha, centro).",
        "",
        "mover(0, _, _, _) :- !.",
        "mover(N, Desde, Hasta, Via) :-",
        "    M is N - 1,",
        "    mover(M, Desde, Via, Hasta),",
        "    format(\"Mueve un disco de ~w a ~w~n\", [Desde, Hasta]),",
        "    mover(M, Via, Hasta, Desde)."),
        queries: ["hanoi(3)", "hanoi(4)"] },
    ],
  };

  M.register("logic/playground", function (stage) {
    var examples = EXAMPLES[M.lang() === "es" ? "es" : "en"];
    var pl = P.create();
    var dirty = true, current = null, busy = false;

    var exSel = M.select({
      label: t("pl.example"), value: examples[0].id,
      options: examples.map(function (e) { return { value: e.id, label: t("pl.examples." + e.id) }; }),
      onChange: function (v) { loadExample(v); },
    });
    var traceCtl = M.toggle({ label: t("pl.trace"), checked: false });
    var editor = h("textarea", { class: "pl-editor", spellcheck: "false", autocomplete: "off", autocapitalize: "off",
      rows: "14", "aria-label": t("pl.program") });
    var consultBtn = M.button(t("pl.consult"), function () { consult(true); });
    var status = h("p", { class: "pl-status", role: "status" });
    var chips = h("div", { class: "pl-chips" });
    var queryIn = h("input", { type: "text", class: "pl-query", spellcheck: "false", autocomplete: "off", autocapitalize: "off",
      "aria-label": t("pl.query"), placeholder: t("pl.placeholder") });
    var runBtn = M.button(t("pl.run"), function () { runQuery(); }, "primary");
    var nextBtn = M.button(t("pl.next"), function () { nextAnswer(); });
    var stopBtn = M.button(t("pl.stop"), function () { finish("."); });
    var clearBtn = M.button(t("pl.clear"), function () { M.clear(consoleEl); });
    var consoleEl = h("div", { class: "pl-console", "aria-live": "polite", tabindex: "0", role: "log", "aria-label": t("pl.console") });

    stage.appendChild(M.controls(exSel.el, traceCtl.el));
    stage.appendChild(editor);
    stage.appendChild(h("div", { class: "pl-bar" }, consultBtn, status));
    stage.appendChild(h("div", { class: "pl-ask" }, h("span", { class: "pl-prompt", "aria-hidden": "true" }, "?-"), queryIn, runBtn, nextBtn, stopBtn));
    stage.appendChild(chips);
    stage.appendChild(consoleEl);
    stage.appendChild(h("div", { class: "btn-row pl-foot" }, clearBtn, h("p", { class: "demo-hint" }, t("pl.hint"))));

    editor.addEventListener("input", function () { dirty = true; status.textContent = t("pl.changed"); status.className = "pl-status"; });
    editor.addEventListener("keydown", function (e) { // Tab inserts spaces instead of leaving the editor
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        var a = editor.selectionStart, b = editor.selectionEnd;
        editor.value = editor.value.slice(0, a) + "    " + editor.value.slice(b);
        editor.selectionStart = editor.selectionEnd = a + 4;
        dirty = true;
      }
    });
    queryIn.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); if (current && !current.done && !queryIn.value.trim()) nextAnswer(); else runQuery(); }
    });

    function print(text, cls) {
      consoleEl.appendChild(h("div", { class: "pl-line" + (cls ? " " + cls : "") }, text));
      while (consoleEl.childNodes.length > 600) consoleEl.removeChild(consoleEl.firstChild);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    function consult(verbose) {
      var r = pl.consult(editor.value);
      dirty = false;
      var n = 0;
      try { n = P.parseProgram(editor.value).length; } catch (e) { n = 0; }
      if (r.output) print(r.output.replace(/\n$/, ""), "pl-out");
      if (r.errors.length) {
        status.className = "pl-status bad";
        status.textContent = t("pl.errors", { n: r.errors.length });
        r.errors.forEach(function (e) { print(e, "pl-err"); });
      } else {
        status.className = "pl-status good";
        status.textContent = t("pl.loaded", { n: n });
        if (verbose) print(t("pl.loaded", { n: n }), "pl-info");
      }
    }

    function loadExample(id) {
      var ex = examples.filter(function (e) { return e.id === id; })[0];
      editor.value = ex.code;
      finish(null);
      consult(false);
      M.clear(chips);
      ex.queries.forEach(function (q) {
        chips.appendChild(h("button", { type: "button", class: "chip", onclick: function () { queryIn.value = q; runQuery(); } }, q));
      });
      queryIn.value = ex.queries[0];
    }

    function runQuery() {
      if (busy) return;
      var q = queryIn.value.trim().replace(/^\?-\s*/, "").replace(/\.\s*$/, "");
      if (!q) return;
      if (dirty) consult(false);
      finish(null);
      print("?- " + q + ".", "pl-ask-line");
      try {
        current = { solver: pl.solve(q, { maxSteps: 3000000, deadline: Date.now() + 5000, trace: traceCtl.get(), traceMax: 300 }), done: false, count: 0 };
      } catch (e) {
        print(e.message, "pl-err");
        current = null;
        update();
        return;
      }
      nextAnswer();
    }

    function nextAnswer() {
      if (!current || current.done) return;
      busy = true;
      var r;
      try {
        r = current.solver.next();
      } catch (e) {
        busy = false;
        print(t("pl.error") + " " + e.message, "pl-err");
        current.done = true;
        update();
        return;
      }
      busy = false;
      if (r.trace && r.trace.length) {
        r.trace.forEach(function (e) {
          print("  ".repeat(Math.min(e.depth, 12)) + e.port + ": " + e.text, "pl-trace pl-" + e.port.toLowerCase());
        });
        if (r.trace.length >= 300) print("  " + t("pl.traceCut"), "pl-trace");
      }
      if (r.output) print(r.output.replace(/\n$/, ""), "pl-out");
      if (!r.ok) { print(current.count ? "false." : "false.", "pl-no"); current.done = true; update(); return; }
      current.count++;
      var ans = r.bindings.length ? r.bindings.map(function (b) { return b[0] + " = " + b[1]; }).join(",\n") : "true";
      if (r.more && !r.halted) { print(ans + " ;", "pl-yes"); }
      else { print(ans + ".", "pl-yes"); current.done = true; }
      update();
    }

    function finish(mark) {
      if (current && !current.done && mark) print(mark, "pl-yes");
      if (current) current.done = true;
      update();
    }

    function update() {
      var open = !!(current && !current.done);
      nextBtn.disabled = !open;
      stopBtn.disabled = !open;
    }

    loadExample(examples[0].id);
    update();
  });
})();
