// Home — the title screen: a loss landscape that slowly breathes, and balls that roll down it by gradient descent.
// Every ball is one run of an optimiser (SGD, momentum or Adam) on the same function; click to drop more, hover to
// see the gradient. The landscape is a sum of Gaussian wells and hills on a gentle bowl, so it has several minima.
(function () {
  "use strict";
  var M = window.MOA, h = M.h, t = M.t;

  var SPAN = 2.6;                 // the landscape covers [-SPAN·aspect, SPAN·aspect] × [-SPAN, SPAN]
  var OPTS = ["sgd", "momentum", "adam"];
  var COLORS = { sgd: "#5ec8f2", momentum: "#ffb347", adam: "#ff6fa5" };

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // ---------------------------------------------------------------- the landscape

  function makeTerms(seed) {
    var r = seed;
    function rnd() { r = (r * 16807) % 2147483647; return (r - 1) / 2147483646; }
    var terms = [];
    for (var i = 0; i < 7; i++) {
      var well = i < 4;
      terms.push({
        x: (rnd() * 2 - 1) * 3.2, y: (rnd() * 2 - 1) * 1.9,
        a: well ? -(0.7 + rnd() * 0.8) : 0.35 + rnd() * 0.5,
        s: well ? 0.55 + rnd() * 0.5 : 0.45 + rnd() * 0.4,
        w: 0.05 + rnd() * 0.08, p: rnd() * 6.28, d: 0.25 + rnd() * 0.25,
      });
    }
    return terms;
  }

  function Landscape(seed) { this.terms = makeTerms(seed); this.time = 0; }
  Landscape.prototype.at = function (x, y) {
    var v = 0.05 * (x * x + y * y * 1.6), gx = 0.1 * x, gy = 0.16 * y;
    for (var i = 0; i < this.terms.length; i++) {
      var k = this.terms[i];
      var cx = k.x + k.d * Math.sin(k.w * this.time + k.p), cy = k.y + k.d * Math.cos(k.w * 0.8 * this.time + k.p);
      var dx = x - cx, dy = y - cy, s2 = 2 * k.s * k.s;
      var e = k.a * Math.exp(-(dx * dx + dy * dy) / s2);
      v += e;
      gx += e * (-2 * dx / s2);
      gy += e * (-2 * dy / s2);
    }
    return { v: v, gx: gx, gy: gy };
  };

  // Colour ramps: [stop, r, g, b] from low loss to high loss.
  var RAMP_DARK = [[0, 9, 12, 32], [0.25, 34, 28, 92], [0.5, 112, 44, 140], [0.72, 214, 86, 120], [1, 255, 190, 120]];
  var RAMP_LIGHT = [[0, 140, 170, 255], [0.3, 205, 218, 255], [0.6, 252, 246, 236], [0.82, 255, 220, 190], [1, 255, 196, 160]];
  function ramp(stops, x) {
    for (var i = 1; i < stops.length; i++) {
      if (x <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], k = (x - a[0]) / (b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
      }
    }
    var l = stops[stops.length - 1];
    return [l[1], l[2], l[3]];
  }

  M.register("splash/landscape", function (root) {
    var canvas = root.querySelector(".splash-canvas");
    var copy = root.querySelector(".splash-copy");
    var ctx = canvas.getContext("2d");
    var field = document.createElement("canvas");
    var fctx = field.getContext("2d");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var land = new Landscape(20251);
    var balls = [], minima = [], opt = "momentum", paused = false, visible = true, running = false;
    var W = 0, H = 0, scale = 1, fadeTo = 0, dark = false, best = Infinity, pointer = null;
    var lo = -2, hi = 1.5;

    // ---------------------------------------------------------------- HUD

    var stats = h("p", { class: "splash-caption", "aria-live": "off" });
    var optBtns = OPTS.map(function (o) {
      return h("button", { type: "button", class: "splash-btn opt-" + o, "aria-pressed": o === opt ? "true" : "false",
        onclick: function () { setOpt(o); } }, h("span", { class: "dot", "aria-hidden": "true" }), t("splash.opt." + o));
    });
    var shakeBtn = h("button", { type: "button", class: "splash-btn", onclick: shake }, t("splash.shake"));
    var pauseBtn = h("button", { type: "button", class: "splash-btn", "aria-pressed": "false", onclick: togglePause });
    root.appendChild(h("div", { class: "splash-hud" },
      h("div", { class: "splash-opts", role: "group", "aria-label": t("splash.optLabel") }, optBtns),
      stats,
      h("div", { class: "splash-ctrls" }, shakeBtn, pauseBtn)));
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", t("splash.label"));
    if (reduce) pauseBtn.hidden = true;

    function setOpt(o) {
      opt = o;
      optBtns.forEach(function (b, i) { b.setAttribute("aria-pressed", OPTS[i] === o ? "true" : "false"); });
      spawn(14);
      if (reduce) staticFrame();
    }
    function togglePause() { paused = !paused; syncPause(); setRunning(true); }
    function syncPause() {
      pauseBtn.textContent = paused ? t("splash.play") : t("splash.pause");
      pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
    }
    syncPause();

    // ---------------------------------------------------------------- coordinates

    function toWorld(px, py) { return { x: (px - W / 2) / scale, y: (py - H / 2) / scale }; }
    function toScreen(x, y) { return { x: W / 2 + x * scale, y: H / 2 + y * scale }; }

    function layout() {
      var r = canvas.getBoundingClientRect();
      W = Math.max(280, r.width); H = Math.max(260, r.height);
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scale = H / (2 * SPAN);
      field.width = Math.ceil(W / 4); field.height = Math.ceil(H / 4);
      var cr = copy.getBoundingClientRect();
      var overlay = cr.bottom > r.top + 10 && cr.top < r.bottom;
      fadeTo = overlay ? cr.right - r.left + 60 : 0;
      dark = document.documentElement.getAttribute("data-theme") === "dark";
      fieldAge = 99;
    }

    // ---------------------------------------------------------------- balls

    function Ball(x, y, o) { this.x = x; this.y = y; this.o = o; this.vx = 0; this.vy = 0; this.m = [0, 0]; this.s = [0, 0];
      this.k = 0; this.trail = []; this.still = 0; this.life = 1; this.done = false; }
    Ball.prototype.step = function () {
      var g = land.at(this.x, this.y), lr;
      if (this.o === "sgd") {
        lr = 0.045;
        this.vx = -lr * g.gx; this.vy = -lr * g.gy;
      } else if (this.o === "momentum") {
        lr = 0.012;
        this.vx = 0.92 * this.vx - lr * g.gx; this.vy = 0.92 * this.vy - lr * g.gy;
      } else {
        this.k++;
        lr = 0.022;
        this.m[0] = 0.9 * this.m[0] + 0.1 * g.gx; this.m[1] = 0.9 * this.m[1] + 0.1 * g.gy;
        this.s[0] = 0.999 * this.s[0] + 0.001 * g.gx * g.gx; this.s[1] = 0.999 * this.s[1] + 0.001 * g.gy * g.gy;
        var mh0 = this.m[0] / (1 - Math.pow(0.9, this.k)), mh1 = this.m[1] / (1 - Math.pow(0.9, this.k));
        var sh0 = this.s[0] / (1 - Math.pow(0.999, this.k)), sh1 = this.s[1] / (1 - Math.pow(0.999, this.k));
        this.vx = -lr * mh0 / (Math.sqrt(sh0) + 1e-6); this.vy = -lr * mh1 / (Math.sqrt(sh1) + 1e-6);
      }
      this.x += this.vx; this.y += this.vy;
      this.trail.push(this.x, this.y);
      if (this.trail.length > 90) this.trail.splice(0, 2);
      var speed = Math.hypot(this.vx, this.vy);
      this.still = speed < 0.0025 ? this.still + 1 : 0;
      this.loss = g.v;
      if (g.v < best) best = g.v;
      var out = Math.abs(this.x) > SPAN * (W / H) + 0.5 || Math.abs(this.y) > SPAN + 0.5;
      if (this.still > 70 || out) this.done = true;
    };

    function randomSpot() {
      var aspect = W / H;
      var x0 = fadeTo ? toWorld(fadeTo, 0).x : -SPAN * aspect;
      return { x: x0 + Math.random() * (SPAN * aspect - x0), y: (Math.random() * 2 - 1) * SPAN * 0.92 };
    }

    function spawn(n, at) {
      for (var i = 0; i < n; i++) {
        var p = at ? { x: at.x + (Math.random() - 0.5) * 0.5, y: at.y + (Math.random() - 0.5) * 0.5 } : randomSpot();
        balls.push(new Ball(p.x, p.y, opt));
      }
      if (balls.length > 70) balls.splice(0, balls.length - 70);
    }

    function shake() {
      land = new Landscape(Math.floor(Math.random() * 1e9) + 1);
      fieldAge = 99;
      balls = []; minima = []; best = Infinity;
      spawn(26);
      if (reduce) staticFrame();
    }

    // ---------------------------------------------------------------- drawing

    // The landscape changes slowly, so its picture is recomputed only every few frames and reused in between.
    var fieldAge = 99;
    function drawField() {
      if (fieldAge++ >= 4) { fieldAge = 0; computeField(); }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(field, 0, 0, W, H);
    }

    function computeField() {
      var fw = field.width, fh = field.height, img = fctx.createImageData(fw, fh), d = img.data;
      var stops = dark ? RAMP_DARK : RAMP_LIGHT, vmin = Infinity, vmax = -Infinity, vals = new Float32Array(fw * fh);
      for (var j = 0; j < fh; j++) {
        for (var i = 0; i < fw; i++) {
          var w = toWorld((i + 0.5) * W / fw, (j + 0.5) * H / fh);
          var v = land.at(w.x, w.y).v;
          vals[j * fw + i] = v;
          if (v < vmin) vmin = v;
          if (v > vmax) vmax = v;
        }
      }
      lo += (vmin - lo) * 0.1; hi += (vmax - hi) * 0.1;
      for (var n = 0; n < vals.length; n++) {
        var x = clamp((vals[n] - lo) / (hi - lo || 1), 0, 1);
        var c = ramp(stops, Math.pow(x, 0.8));
        // Contour lines every 1/14 of the range, with soft edges so they stay smooth once the picture is scaled up.
        var band = (x * 14) % 1, dist = Math.min(band, 1 - band);
        var wgt = clamp(1 - dist / 0.11, 0, 1);
        wgt = wgt * wgt * (3 - 2 * wgt);
        var line = 1 + wgt * (dark ? 0.32 : -0.12);
        d[n * 4] = clamp(c[0] * line, 0, 255); d[n * 4 + 1] = clamp(c[1] * line, 0, 255); d[n * 4 + 2] = clamp(c[2] * line, 0, 255);
        d[n * 4 + 3] = 255;
      }
      fctx.putImageData(img, 0, 0);
    }

    function drawFade() {
      // Keep the copy readable: the landscape fades in from behind the text.
      if (fadeTo) {
        var bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || (dark ? "#14161a" : "#ffffff");
        var g = ctx.createLinearGradient(0, 0, fadeTo + 120, 0);
        g.addColorStop(0, bg); g.addColorStop(0.72, withAlpha(bg, dark ? 0.84 : 0.93)); g.addColorStop(1, withAlpha(bg, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, fadeTo + 120, H);
      }
    }

    function withAlpha(color, a) {
      var m = /^#([0-9a-f]{6})$/i.exec(color);
      if (!m) return "rgba(0,0,0," + a + ")";
      var n = parseInt(m[1], 16);
      return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
    }

    function drawBalls() {
      balls.forEach(function (b) {
        var col = COLORS[b.o];
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        for (var i = 2; i < b.trail.length; i += 2) {
          var p0 = toScreen(b.trail[i - 2], b.trail[i - 1]), p1 = toScreen(b.trail[i], b.trail[i + 1]);
          ctx.globalAlpha = (i / b.trail.length) * 0.85 * b.life;
          ctx.strokeStyle = col;
          ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        }
        var p = toScreen(b.x, b.y);
        ctx.globalAlpha = b.life;
        ctx.fillStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = dark ? 12 : 4;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4.2, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(p.x - 1.2, p.y - 1.2, 1.4, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      // Minima found so far: a small ring where balls came to rest.
      minima.forEach(function (m) {
        var p = toScreen(m.x, m.y);
        ctx.strokeStyle = dark ? "rgba(255,255,255," + m.a + ")" : "rgba(20,20,40," + m.a + ")";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.stroke();
      });
    }

    function drawPointer() {
      if (!pointer || reduce) return;
      var w = toWorld(pointer.x, pointer.y), g = land.at(w.x, w.y);
      var len = Math.hypot(g.gx, g.gy) || 1, k = Math.min(60, 140 * len) / len;
      var x1 = pointer.x - g.gx * k, y1 = pointer.y - g.gy * k;
      ctx.strokeStyle = dark ? "#ffffff" : "#1b1e23"; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pointer.x, pointer.y); ctx.lineTo(x1, y1); ctx.stroke();
      var a = Math.atan2(y1 - pointer.y, x1 - pointer.x);
      ctx.beginPath(); ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - 9 * Math.cos(a - 0.4), y1 - 9 * Math.sin(a - 0.4));
      ctx.lineTo(x1 - 9 * Math.cos(a + 0.4), y1 - 9 * Math.sin(a + 0.4)); ctx.fill();
      ctx.font = "600 12px " + (getComputedStyle(document.documentElement).getPropertyValue("--mono") || "monospace");
      ctx.fillText("L = " + g.v.toFixed(2) + "   −∇L", pointer.x + 10, pointer.y - 10);
    }

    function draw() {
      if (!W) return;
      drawField();
      drawBalls();
      drawFade();
      drawPointer();
    }

    var statTimer = 0;
    function updateStats() {
      stats.textContent = t("splash.stats", { n: balls.length, opt: t("splash.opt." + opt),
        best: isFinite(best) ? best.toFixed(3) : "—" });
    }

    // ---------------------------------------------------------------- loop

    var last = 0;
    function frame(now) {
      if (!running) return;
      var dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      land.time += dt;
      for (var s = 0; s < 2; s++) balls.forEach(function (b) { if (!b.done) b.step(); });
      balls.forEach(function (b) {
        if (b.done) {
          if (b.life === 1 && b.still > 70) minima.push({ x: b.x, y: b.y, a: 0.9 });
          b.life -= dt * 0.8;
        }
      });
      balls = balls.filter(function (b) { return b.life > 0; });
      minima.forEach(function (m) { m.a -= dt * 0.12; });
      minima = minima.filter(function (m) { return m.a > 0; });
      if (balls.length < 22) spawn(3);
      draw();
      statTimer += dt;
      if (statTimer > 0.3) { statTimer = 0; updateStats(); }
      requestAnimationFrame(frame);
    }

    function setRunning(on) {
      on = on && !paused && visible && !reduce;
      if (on === running) return;
      running = on; last = 0;
      if (on) requestAnimationFrame(frame);
    }

    // Reduced motion: a still picture with finished runs of the three optimisers.
    function staticFrame() {
      balls = [];
      for (var i = 0; i < 24; i++) {
        var p = randomSpot();
        var b = new Ball(p.x, p.y, i < 8 ? "sgd" : i < 16 ? "momentum" : "adam");
        for (var k = 0; k < 400 && !b.done; k++) b.step();
        balls.push(b);
      }
      draw();
      updateStats();
    }

    canvas.addEventListener("pointermove", function (e) {
      var r = canvas.getBoundingClientRect();
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (reduce) draw();
    });
    canvas.addEventListener("pointerleave", function () { pointer = null; if (reduce) draw(); });
    canvas.addEventListener("pointerdown", function (e) {
      var r = canvas.getBoundingClientRect();
      spawn(8, toWorld(e.clientX - r.left, e.clientY - r.top));
      if (reduce) { balls.slice(-8).forEach(function (b) { for (var k = 0; k < 400 && !b.done; k++) b.step(); }); draw(); }
    });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (en) { visible = en[0].isIntersecting; setRunning(true); }).observe(root);
    }
    document.addEventListener("visibilitychange", function () { visible = !document.hidden; setRunning(true); });
    var rt = 0;
    window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { layout(); if (reduce) staticFrame(); else draw(); }, 150); });
    M.onTheme(function () { layout(); draw(); });

    layout();
    if (reduce) staticFrame();
    else { spawn(26); updateStats(); draw(); setRunning(true); }
  });
})();
