// Shared runtime for every page: theme toggle, demo registry and small DOM/maths helpers.
// Demos live in js/demos/<group>.js and call MOA.register("<group>/<name>", init); every element with
// data-demo="<group>/<name>" is handed to its init function once the page has loaded.
(function () {
  "use strict";

  var registry = {};
  var themeListeners = [];
  var strings = {};

  // ------------------------------------------------------------------ strings and numbers

  function t(key, vars) {
    var v = key.split(".").reduce(function (o, k) { return o && o[k]; }, strings);
    if (typeof v !== "string") {
      console.warn("missing string", key);
      return key;
    }
    return vars ? v.replace(/\{(\w+)\}/g, function (_, k) { return k in vars ? vars[k] : "{" + k + "}"; }) : v;
  }

  var formatters = {};
  function fmt(x, digits, minDigits) {
    if (digits === undefined) digits = 2;
    if (!isFinite(x)) return x > 0 ? "∞" : x < 0 ? "−∞" : "—";
    var key = digits + ":" + (minDigits === undefined ? digits : minDigits);
    if (!formatters[key]) {
      formatters[key] = new Intl.NumberFormat(lang(), {
        maximumFractionDigits: digits,
        minimumFractionDigits: minDigits === undefined ? digits : minDigits,
      });
    }
    return formatters[key].format(x).replace("-", "−");
  }

  function pct(p, digits) {
    // Spanish style separates the sign ("30 %"); English does not ("30%").
    return fmt(100 * p, digits === undefined ? 1 : digits) + (lang() === "es" ? " %" : "%");
  }

  function lang() { return strings.lang || document.documentElement.lang || "en"; }

  // ------------------------------------------------------------------ DOM

  function setAttrs(node, attrs, svg) {
    if (!attrs) return node;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k === "class") svg ? node.setAttribute("class", v) : (node.className = v);
      else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
      else node.setAttribute(k, v === true ? "" : v);
    });
    return node;
  }

  function append(node, children) {
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) append(node, c);
      else node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  function h(tag, attrs) {
    return append(setAttrs(document.createElement(tag), attrs, false), [].slice.call(arguments, 2));
  }

  var SVGNS = "http://www.w3.org/2000/svg";
  function s(tag, attrs) {
    return append(setAttrs(document.createElementNS(SVGNS, tag), attrs, true), [].slice.call(arguments, 2));
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  // ------------------------------------------------------------------ controls

  var uid = 0;
  function slider(o) {
    var id = "ctl" + ++uid;
    var toVal = o.log ? function (p) { return Math.pow(10, p); } : function (p) { return p; };
    var toPos = o.log ? function (v) { return Math.log10(v); } : function (v) { return v; };
    var input = h("input", {
      type: "range", id: id,
      min: toPos(o.min), max: toPos(o.max), step: o.log ? (toPos(o.max) - toPos(o.min)) / 200 : (o.step || 1),
      value: toPos(o.value),
    });
    var out = h("output", { for: id });
    var format = o.format || function (v) { return fmt(v, 2); };
    function value() { return toVal(parseFloat(input.value)); }
    function show() { out.textContent = format(value()); }
    input.addEventListener("input", function () { show(); if (o.onInput) o.onInput(value()); });
    show();
    var el = h("div", { class: "ctl ctl-slider" + (o.wide ? " wide" : "") },
      h("label", { for: id }, o.label), input, out);
    return {
      el: el, input: input,
      get: value,
      set: function (v, silent) { input.value = toPos(v); show(); if (!silent && o.onInput) o.onInput(value()); },
    };
  }

  function button(label, onClick, cls) {
    return h("button", { type: "button", class: "btn" + (cls ? " " + cls : ""), onclick: onClick }, label);
  }

  function select(o) {
    var id = "ctl" + ++uid;
    var sel = h("select", { id: id }, o.options.map(function (opt) {
      return h("option", { value: opt.value, selected: opt.value === o.value }, opt.label);
    }));
    sel.addEventListener("change", function () { if (o.onChange) o.onChange(sel.value); });
    return { el: h("div", { class: "ctl ctl-select" }, h("label", { for: id }, o.label), sel), input: sel,
      get: function () { return sel.value; }, set: function (v) { sel.value = v; } };
  }

  function toggle(o) {
    var id = "ctl" + ++uid;
    var box = h("input", { type: "checkbox", id: id, checked: !!o.checked });
    box.addEventListener("change", function () { if (o.onChange) o.onChange(box.checked); });
    return { el: h("div", { class: "ctl ctl-toggle" }, box, h("label", { for: id }, o.label)), input: box,
      get: function () { return box.checked; }, set: function (v) { box.checked = !!v; } };
  }

  function segmented(o) {
    var buttons = o.options.map(function (opt) {
      return h("button", { type: "button", class: "seg", "aria-pressed": opt.value === o.value ? "true" : "false",
        dataset: { value: opt.value }, onclick: function () { set(opt.value, false); } }, opt.label);
    });
    var value = o.value;
    function set(v, silent) {
      value = v;
      buttons.forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.value === v ? "true" : "false"); });
      if (!silent && o.onChange) o.onChange(v);
    }
    var el = h("div", { class: "ctl ctl-seg", role: "group", "aria-label": o.label },
      o.showLabel === false ? null : h("span", { class: "ctl-label" }, o.label), h("div", { class: "seg-group" }, buttons));
    return { el: el, get: function () { return value; }, set: set };
  }

  function controls() {
    return h("div", { class: "controls" }, [].slice.call(arguments));
  }

  function stat(label, cls) {
    var val = h("span", { class: "stat-val" });
    var el = h("div", { class: "stat" + (cls ? " " + cls : "") }, h("span", { class: "stat-label" }, label), val);
    return { el: el, set: function (v) { val.textContent = v; } };
  }

  // ------------------------------------------------------------------ colours and theme

  function color(name, fallback) {
    var v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || fallback || "#888";
  }

  function onTheme(fn) { themeListeners.push(fn); }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch (e) { /* storage blocked */ }
    themeListeners.forEach(function (fn) { try { fn(theme); } catch (e) { console.error(e); } });
  }

  // ------------------------------------------------------------------ canvas

  // A crisp, responsive canvas. draw(ctx, width, height) is called on resize and theme change.
  function canvas(parent, o) {
    var c = h("canvas", { class: o.class || "demo-canvas" });
    if (o.label) { c.setAttribute("role", "img"); c.setAttribute("aria-label", o.label); }
    parent.appendChild(c);
    var api = { canvas: c, ctx: c.getContext("2d"), width: 0, height: 0 };
    function size() {
      var w = c.clientWidth || parent.clientWidth || 600;
      var hgt = o.height ? (typeof o.height === "function" ? o.height(w) : o.height) : Math.round(w / (o.aspect || 1.6));
      var dpr = window.devicePixelRatio || 1;
      c.style.height = hgt + "px";
      c.width = Math.round(w * dpr);
      c.height = Math.round(hgt * dpr);
      api.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      api.width = w;
      api.height = hgt;
    }
    api.redraw = function () {
      if (!api.width) size();
      api.ctx.clearRect(0, 0, api.width, api.height);
      o.draw(api.ctx, api.width, api.height);
    };
    api.resize = function () { size(); api.redraw(); };
    if (window.ResizeObserver) {
      var lastW = 0;
      new ResizeObserver(function () {
        if (c.clientWidth && c.clientWidth !== lastW) { lastW = c.clientWidth; api.resize(); }
      }).observe(c);
    }
    onTheme(function () { api.redraw(); });
    api.toLocal = function (ev) {
      var r = c.getBoundingClientRect();
      var p = ev.touches ? ev.touches[0] : ev;
      return { x: p.clientX - r.left, y: p.clientY - r.top };
    };
    requestAnimationFrame(function () { api.resize(); });
    return api;
  }

  // Responsive SVG with a fixed coordinate system.
  function svgBox(parent, w, hgt, label) {
    var el = s("svg", { viewBox: "0 0 " + w + " " + hgt, class: "demo-svg", role: "img", "aria-label": label || "" });
    parent.appendChild(el);
    return el;
  }

  // Axes, ticks and grid for an SVG chart. o = {x, y: scales, xTicks, yTicks, xFmt, yFmt, xLabel, yLabel, x0, x1, y0, y1}
  function axes(o) {
    var g = s("g", { class: "axis" });
    var xf = o.xFmt || function (v) { return fmt(v, 0); };
    var yf = o.yFmt || function (v) { return fmt(v, 1); };
    (o.yTicks || []).forEach(function (v) {
      var y = o.y(v);
      g.appendChild(s("line", { class: "gridline", x1: o.x0, x2: o.x1, y1: y, y2: y }));
      g.appendChild(s("text", { x: o.x0 - 6, y: y + 3.5, "text-anchor": "end" }, yf(v)));
    });
    (o.xTicks || []).forEach(function (v) {
      var x = o.x(v);
      g.appendChild(s("line", { x1: x, x2: x, y1: o.y0, y2: o.y0 + 4 }));
      g.appendChild(s("text", { x: x, y: o.y0 + 16, "text-anchor": "middle" }, xf(v)));
    });
    g.appendChild(s("line", { x1: o.x0, x2: o.x1, y1: o.y0, y2: o.y0 }));
    if (o.xLabel) g.appendChild(s("text", { x: (o.x0 + o.x1) / 2, y: o.y0 + 32, "text-anchor": "middle" }, o.xLabel));
    if (o.yLabel) g.appendChild(s("text", { x: o.x0 - 6, y: o.y1 - 10, "text-anchor": "start", class: "label-strong" }, o.yLabel));
    return g;
  }

  function path(points) {
    return points.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); }).join("");
  }

  // ------------------------------------------------------------------ animation

  // A requestAnimationFrame loop that only runs while started and on screen.
  function animator(el, step) {
    var running = false, visible = true, raf = 0;
    function frame() {
      raf = 0;
      if (!running || !visible) return;
      if (step() === false) { api.stop(); return; }
      raf = requestAnimationFrame(frame);
    }
    function kick() { if (running && visible && !raf) raf = requestAnimationFrame(frame); }
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        kick();
      }).observe(el);
    }
    var api = {
      start: function () { running = true; kick(); if (api.onchange) api.onchange(true); },
      stop: function () { running = false; if (api.onchange) api.onchange(false); },
      toggle: function () { running ? api.stop() : api.start(); },
      get running() { return running; },
      onchange: null,
    };
    return api;
  }

  // ------------------------------------------------------------------ maths

  function linear(d0, d1, r0, r1) {
    var f = function (x) { return r0 + (x - d0) * (r1 - r0) / (d1 - d0); };
    f.invert = function (y) { return d0 + (y - r0) * (d1 - d0) / (r1 - r0); };
    return f;
  }

  function rng(seed) { // mulberry32: small, fast, reproducible
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(rand) {
    var u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function softmax(xs, temperature) {
    var T = temperature === undefined ? 1 : temperature;
    var m = Math.max.apply(null, xs);
    var e = xs.map(function (x) { return Math.exp((x - m) / T); });
    var z = e.reduce(function (a, b) { return a + b; }, 0);
    return e.map(function (x) { return x / z; });
  }

  function entropy(ps) {
    return ps.reduce(function (acc, p) { return p > 0 ? acc - p * Math.log2(p) : acc; }, 0);
  }

  function sample(ps, rand) {
    var r = (rand || Math.random)(), acc = 0;
    for (var i = 0; i < ps.length; i++) { acc += ps[i]; if (r < acc) return i; }
    return ps.length - 1;
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // ------------------------------------------------------------------ boot

  function register(name, init) { registry[name] = init; }

  function boot() {
    try { strings = JSON.parse(document.body.getAttribute("data-strings") || "{}"); } catch (e) { strings = {}; }

    var toggleBtn = document.querySelector(".theme-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function () {
        setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
      });
    }

    // Close the chapters menu when clicking elsewhere or pressing Escape.
    var menu = document.querySelector(".chapters-menu");
    if (menu) {
      document.addEventListener("click", function (e) { if (menu.open && !menu.contains(e.target)) menu.open = false; });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") menu.open = false; });
    }

    document.querySelectorAll("[data-demo]").forEach(function (el) {
      var name = el.getAttribute("data-demo");
      var init = registry[name];
      if (!init) {
        el.setAttribute("data-error", "unregistered");
        return;
      }
      try {
        var stage = el.querySelector(".demo-stage");
        if (!stage && el.tagName === "FIGURE") {
          stage = h("div", { class: "demo-stage" });
          el.insertBefore(stage, el.querySelector("figcaption"));
        }
        init(stage || el, el);
        el.setAttribute("data-ready", "");
      } catch (err) {
        console.error(name, err);
        el.setAttribute("data-error", String(err && err.message || err));
        el.appendChild(h("p", { class: "demo-error" }, t("core.error")));
      }
    });
  }

  window.MOA = {
    register: register, t: t, fmt: fmt, pct: pct, lang: lang, h: h, s: s, clear: clear,
    slider: slider, button: button, select: select, toggle: toggle, segmented: segmented,
    controls: controls, stat: stat, color: color, onTheme: onTheme, canvas: canvas, svgBox: svgBox,
    axes: axes, path: path,
    animator: animator, linear: linear, rng: rng, gauss: gauss, softmax: softmax, entropy: entropy,
    sample: sample, clamp: clamp,
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
