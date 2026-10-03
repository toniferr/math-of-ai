// Home — build a sentence one token at a time and watch probability, surprise and entropy add up.
(function () {
  "use strict";
  var M = window.MOA, h = M.h, t = M.t;

  // Next-token distributions keyed by the last choice; "*" is the fallback once the sentence is underway.
  var TREE = {
    "": [["sofá", 0.3], ["suelo", 0.22], ["jardín", 0.17], ["tejado", 0.1], ["sillón", 0.08], ["alféizar", 0.05], ["regazo", 0.04], ["teclado", 0.04]],
    "sofá": [["del salón", 0.38], [".", 0.2], [",", 0.2], ["nuevo", 0.12], ["de la abuela", 0.1]],
    "suelo": [["de la cocina", 0.4], [".", 0.3], [",", 0.2], ["frío", 0.1]],
    "jardín": [["de casa", 0.3], [".", 0.3], [",", 0.2], ["bajo el sol", 0.2]],
    "tejado": [["de enfrente", 0.35], [".", 0.3], ["mirando la luna", 0.2], [",", 0.15]],
    "sillón": [["de mimbre", 0.35], [".", 0.35], [",", 0.3]],
    "alféizar": [["de la ventana", 0.7], [".", 0.3]],
    "regazo": [["de su dueña", 0.6], [".", 0.4]],
    "teclado": [["del portátil", 0.5], [", escribiendo", 0.3], [".", 0.2]],
    "*": [[".", 0.45], ["sin moverse", 0.2], [", ronroneando", 0.2], ["mientras llueve", 0.15]],
  };

  M.register("home/next-token", function (stage) {
    var chosen = [], bits = 0, prob = 1, rand = M.rng(Date.now() % 1e6);

    var prompt = h("div", { class: "tok-prompt", "aria-live": "polite" });
    var list = h("ul", { class: "tok-list" });
    var stH = M.stat(t("home.entropy"), "accent"), stS = M.stat(t("home.surprise")), stP = M.stat(t("home.prob")), stB = M.stat(t("home.bits"));
    var sampleBtn = M.button(t("home.sample"), function () {
      var d = options();
      if (d) pick(d[M.sample(d.map(function (o) { return o[1]; }), rand)]);
    }, "primary");

    stage.appendChild(prompt);
    stage.appendChild(h("p", { class: "demo-hint" }, t("home.hint")));
    stage.appendChild(list);
    stage.appendChild(M.controls(h("div", { class: "btn-row" }, sampleBtn,
      M.button(t("home.restart"), function () { chosen = []; bits = 0; prob = 1; stS.set("—"); draw(); }))));
    stage.appendChild(h("div", { class: "stats" }, stH.el, stS.el, stP.el, stB.el));

    function options() {
      var last = chosen.length ? chosen[chosen.length - 1][0] : "";
      if (last === ".") return null;
      if (chosen.length >= 3) return [[".", 1]];
      return TREE[last] || TREE["*"];
    }

    function pick(o) {
      chosen.push(o);
      bits += -Math.log2(o[1]);
      prob *= o[1];
      stS.set(M.fmt(-Math.log2(o[1]), 2) + " bits");
      draw();
    }

    function draw() {
      M.clear(prompt);
      prompt.appendChild(document.createTextNode(t("home.prompt")));
      chosen.forEach(function (o) {
        prompt.appendChild(document.createTextNode(/^[.,]/.test(o[0]) ? "" : " "));
        prompt.appendChild(h("span", { class: "added" }, o[0]));
      });
      prompt.appendChild(h("span", { class: "caret", "aria-hidden": "true" }));

      var d = options();
      M.clear(list);
      if (d) {
        d.forEach(function (o) {
          var fill = h("span", { class: "tok-fill" });
          fill.style.width = (100 * o[1] / d[0][1]).toFixed(1) + "%";
          list.appendChild(h("li", {}, h("button", { type: "button", class: "tok-row", onclick: function () { pick(o); } },
            h("span", { class: "tok-word" }, o[0]), h("span", { class: "tok-track" }, fill), h("span", { class: "tok-p" }, M.pct(o[1], 0)))));
        });
        stH.set(M.fmt(M.entropy(d.map(function (o) { return o[1]; })), 2) + " bits");
      } else {
        list.appendChild(h("li", { class: "demo-hint" }, t("home.done")));
        stH.set("—");
      }
      sampleBtn.disabled = !d;
      stP.set(chosen.length ? (prob < 0.001 ? prob.toExponential(1).replace("e", "·10^") : M.pct(prob, 2)) : "100 %");
      stB.set(M.fmt(bits, 2) + " bits");
    }

    stS.set("—");
    draw();
  });
})();
