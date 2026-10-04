// A small Prolog interpreter that runs entirely in the browser: parser with operators, unification,
// SLD resolution with backtracking and cut, arbitrary-precision integers, a library of list predicates
// and the usual built-ins. No eval, no network: it fits the site's strict CSP. Exposed as window.Prolog.
(function () {
  "use strict";

  // ------------------------------------------------------------------ terms

  var varCounter = 0;
  function Atom(n) { return { t: "a", n: n }; }
  function Var(name) { return { t: "v", n: name || "_", id: ++varCounter, ref: null }; }
  function Int(v) { return { t: "i", v: typeof v === "bigint" ? v : BigInt(v) }; }
  function Flt(v) { return { t: "f", v: v }; }
  function Str(n, args) { return { t: "c", n: n, args: args }; }
  var NIL = Atom("[]"), TRUE = Atom("true");

  function deref(t) { while (t.t === "v" && t.ref) t = t.ref; return t; }
  function list(items, tail) {
    var l = tail || NIL;
    for (var i = items.length - 1; i >= 0; i--) l = Str(".", [items[i], l]);
    return l;
  }
  function listToArray(t) { // returns null if not a proper list
    var out = [];
    t = deref(t);
    while (t.t === "c" && t.n === "." && t.args.length === 2) { out.push(t.args[0]); t = deref(t.args[1]); }
    return t.t === "a" && t.n === "[]" ? out : null;
  }

  function PrologError(msg, term) { this.message = msg; this.term = term; }
  PrologError.prototype = Object.create(Error.prototype);
  function typeError(type, culprit) { return new PrologError("type_error(" + type + ", " + show(culprit, true) + ")"); }
  function instErr() { return new PrologError("instantiation_error: argument not sufficiently instantiated"); }

  // ------------------------------------------------------------------ operators

  var OPS = {};
  function op(p, type, names) {
    names.split(" ").forEach(function (n) {
      OPS[n] = OPS[n] || {};
      if (type[0] === "f" && type.length === 2) OPS[n].prefix = { p: p, type: type };
      else OPS[n].infix = { p: p, type: type };
    });
  }
  op(1200, "xfx", ":- -->");
  op(1200, "fx", ":- ?-");
  op(1100, "xfy", "; |");
  op(1050, "xfy", "->");
  op(1000, "xfy", ",");
  op(990, "xfx", ":=");
  op(900, "fy", "\\+");
  op(700, "xfx", "= \\= == \\== @< @> @=< @>= =.. is =:= =\\= < > =< >= >:< :<");
  op(600, "xfy", ":");
  op(500, "yfx", "+ - /\\ \\/ xor");
  op(400, "yfx", "* / // mod rem << >> div rdiv divmod");
  op(200, "xfx", "**");
  op(200, "xfy", "^");
  op(200, "fy", "- + \\");
  op(100, "yfx", ".");
  op(1, "fx", "$");
  op(1150, "fx", "dynamic discontiguous initialization");

  // ------------------------------------------------------------------ tokenizer

  var SYMCH = "+-*/\\^<>=~:.?@#&$";
  function tokenize(src) {
    var toks = [], i = 0, line = 1, n = src.length;
    function push(type, val, ws) { toks.push({ type: type, val: val, ws: ws, line: line }); }
    while (i < n) {
      var ws = false;
      for (;;) { // whitespace and comments
        var c0 = src[i];
        if (c0 === "\n") { line++; i++; ws = true; }
        else if (c0 === " " || c0 === "\t" || c0 === "\r") { i++; ws = true; }
        else if (c0 === "%") { while (i < n && src[i] !== "\n") i++; ws = true; }
        else if (c0 === "/" && src[i + 1] === "*") {
          i += 2;
          while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; }
          i += 2; ws = true;
        } else break;
      }
      if (i >= n) break;
      var c = src[i];
      if (/[0-9]/.test(c)) {
        if (c === "0" && src[i + 1] === "'") { // character code 0'a
          var ch = src[i + 2];
          if (ch === "\\") { ch = { n: "\n", t: "\t", "\\": "\\", "'": "'" }[src[i + 3]] || src[i + 3]; i += 4; }
          else if (ch === "'" && src[i + 3] === "'") { i += 4; }
          else i += 3;
          push("int", BigInt(ch.codePointAt(0)), ws); continue;
        }
        var m = /^\d+(\.\d+([eE][+-]?\d+)?)?/.exec(src.slice(i));
        if (m[1]) push("float", parseFloat(m[0]), ws); else push("int", BigInt(m[0]), ws);
        i += m[0].length; continue;
      }
      if (/[A-Z_]/.test(c)) {
        var mv = /^[A-Za-z0-9_]+/.exec(src.slice(i));
        push("var", mv[0], ws); i += mv[0].length; continue;
      }
      if (/[a-z]/.test(c)) {
        var ma = /^[A-Za-z0-9_]+/.exec(src.slice(i));
        push("atom", ma[0], ws); i += ma[0].length; continue;
      }
      if (c === "'" || c === '"' || c === "`") {
        var q = c, s = "";
        i++;
        while (i < n) {
          var d = src[i];
          if (d === q) { if (src[i + 1] === q) { s += q; i += 2; continue; } i++; break; }
          if (d === "\\") {
            var e = src[i + 1];
            s += { n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"', "`": "`" }[e] !== undefined ? { n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"', "`": "`" }[e] : e;
            i += 2; continue;
          }
          if (d === "\n") line++;
          s += d; i++;
        }
        push(q === "'" ? "qatom" : "string", s, ws); continue;
      }
      if ("()[]{},|".indexOf(c) >= 0) { push("punct", c, ws); i++; continue; }
      if (c === "!" || c === ";") { push("atom", c, ws); i++; continue; }
      if (c === "." && (i + 1 >= n || /[\s%]/.test(src[i + 1]))) { push("end", ".", ws); i++; continue; }
      if (SYMCH.indexOf(c) >= 0) {
        var j = i;
        while (j < n && SYMCH.indexOf(src[j]) >= 0) j++;
        push("atom", src.slice(i, j), ws); i = j; continue;
      }
      throw new PrologError("syntax error: unexpected character '" + c + "' at line " + line);
    }
    push("eof", null, true);
    return toks;
  }

  // ------------------------------------------------------------------ parser

  function Parser(toks) { this.toks = toks; this.i = 0; this.vars = null; }
  Parser.prototype.peek = function (k) { return this.toks[this.i + (k || 0)]; };
  Parser.prototype.next = function () { return this.toks[this.i++]; };
  Parser.prototype.err = function (msg) {
    var tk = this.peek();
    throw new PrologError("syntax error: " + msg + " (line " + tk.line + ")");
  };
  Parser.prototype.expect = function (type, val) {
    var tk = this.next();
    if (tk.type !== type || (val !== undefined && tk.val !== val)) { this.i--; this.err("expected " + (val || type)); }
    return tk;
  };
  Parser.prototype.isAtomTok = function (tk) { return tk.type === "atom" || tk.type === "qatom" || (tk.type === "punct" && (tk.val === "," || tk.val === "|")); };
  Parser.prototype.startsTerm = function (tk) {
    if (tk.type === "eof" || tk.type === "end") return false;
    if (tk.type === "punct") return tk.val === "(" || tk.val === "[" || tk.val === "{";
    if (tk.type === "atom" && OPS[tk.val] && OPS[tk.val].infix && !OPS[tk.val].prefix) return false;
    return true;
  };

  // Read one clause (term followed by '.'), or null at end of input.
  Parser.prototype.readClause = function () {
    if (this.peek().type === "eof") return null;
    this.vars = {};
    this.varList = [];
    var t = this.parse(1200);
    this.expect("end");
    return t;
  };

  Parser.prototype.parse = function (maxP) {
    var left = this.parsePrimary(maxP);
    return this.parseInfix(left.term, left.p, maxP);
  };

  Parser.prototype.parseInfix = function (left, leftP, maxP) {
    for (;;) {
      var tk = this.peek(), name = null;
      if (tk.type === "atom") name = tk.val;
      else if (tk.type === "punct" && (tk.val === "," || tk.val === "|")) name = tk.val;
      if (name === null || !OPS[name] || !OPS[name].infix) break;
      var o = OPS[name].infix, p = o.p;
      if (p > maxP) break;
      var leftMax = o.type === "yfx" ? p : p - 1, rightMax = o.type === "xfy" ? p : p - 1;
      if (leftP > leftMax) break;
      this.next();
      var right = this.parse(rightMax);
      if (name === "|") name = ";";
      left = Str(name, [left, right]);
      leftP = p;
    }
    return left;
  };

  Parser.prototype.parseArgs = function () {
    var args = [this.parse(999)];
    while (this.peek().type === "punct" && this.peek().val === ",") { this.next(); args.push(this.parse(999)); }
    this.expect("punct", ")");
    return args;
  };

  Parser.prototype.parsePrimary = function (maxP) {
    var tk = this.next();
    switch (tk.type) {
      case "int": return { term: Int(tk.val), p: 0 };
      case "float": return { term: Flt(tk.val), p: 0 };
      case "string": { var sa = Atom(tk.val); sa.str = true; return { term: sa, p: 0 }; }
      case "var": {
        if (tk.val === "_") return { term: Var("_"), p: 0 };
        if (!this.vars[tk.val]) { this.vars[tk.val] = Var(tk.val); this.varList.push(tk.val); }
        return { term: this.vars[tk.val], p: 0 };
      }
      case "punct": {
        if (tk.val === "(") { var t = this.parse(1200); this.expect("punct", ")"); return { term: t, p: 0 }; }
        if (tk.val === "[") {
          if (this.peek().type === "punct" && this.peek().val === "]") { this.next(); return this.atomOrCompound("[]", maxP); }
          var items = [this.parse(999)], tail = NIL;
          while (this.peek().type === "punct" && this.peek().val === ",") { this.next(); items.push(this.parse(999)); }
          if (this.peek().type === "punct" && this.peek().val === "|") { this.next(); tail = this.parse(999); }
          this.expect("punct", "]");
          return { term: list(items, tail), p: 0 };
        }
        if (tk.val === "{") {
          if (this.peek().type === "punct" && this.peek().val === "}") { this.next(); return { term: Atom("{}"), p: 0 }; }
          var inner = this.parse(1200);
          this.expect("punct", "}");
          return { term: Str("{}", [inner]), p: 0 };
        }
        if (tk.val === "," ) this.i--, this.err("unexpected ','");
        if (tk.val === "|") return { term: Atom("|"), p: 0 };
        this.i--; this.err("unexpected '" + tk.val + "'");
        break;
      }
      case "atom": case "qatom": {
        var name = tk.val, nxt = this.peek();
        if (nxt.type === "punct" && nxt.val === "(" && !nxt.ws) { this.next(); return { term: Str(name, this.parseArgs()), p: 0 }; }
        // Negative numeric literal: "-" glued to a number.
        if (tk.type === "atom" && name === "-" && (nxt.type === "int" || nxt.type === "float") && !nxt.ws) {
          this.next();
          return { term: nxt.type === "int" ? Int(-nxt.val) : Flt(-nxt.val), p: 0 };
        }
        if (tk.type === "atom" && OPS[name] && OPS[name].prefix && this.startsTerm(nxt)) {
          var po = OPS[name].prefix;
          // An infix operator right after (e.g. "- = x") means the prefix op is used as an atom.
          var isInfixNext = nxt.type === "atom" && OPS[nxt.val] && OPS[nxt.val].infix && !(nxt.type === "atom" && nxt.val === "(");
          if (!isInfixNext || (OPS[nxt.val] && OPS[nxt.val].prefix)) {
            var p = po.p > maxP ? 999 : po.p;
            var arg = this.parse(po.type === "fy" ? p : p - 1);
            return { term: Str(name, [arg]), p: p };
          }
        }
        return this.atomOrCompound(name, maxP);
      }
      case "end": this.i--; this.err("unexpected end of clause"); break;
      default: this.i--; this.err("unexpected end of input");
    }
  };
  Parser.prototype.atomOrCompound = function (name, maxP) {
    var p = OPS[name] ? Math.max(OPS[name].prefix ? OPS[name].prefix.p : 0, OPS[name].infix ? OPS[name].infix.p : 0) : 0;
    return { term: Atom(name), p: p > maxP ? 0 : p };
  };

  function parseTerm(text) {
    var ps = new Parser(tokenize(text.trim().replace(/\.\s*$/, "") + " ."));
    var t = ps.readClause();
    if (ps.peek().type !== "eof") ps.err("unexpected text after the term");
    return { term: t, vars: ps.vars, varList: ps.varList };
  }

  // ------------------------------------------------------------------ writing terms

  function atomText(n, quoted) {
    if (!quoted) return n;
    if (/^[a-z][A-Za-z0-9_]*$/.test(n) || n === "[]" || n === "!" || n === ";" || n === "{}" || n === ",") return n === "," ? "','" : n;
    if (/^[+\-*/\\^<>=~:.?@#&$]+$/.test(n)) return n;
    return "'" + n.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'";
  }
  function numText(t) {
    if (t.t === "i") return t.v.toString();
    var v = t.v;
    if (!isFinite(v)) return v > 0 ? "inf" : v < 0 ? "-inf" : "nan";
    var s = String(v);
    return /[.e]/.test(s) ? s : s + ".0";
  }
  var NAMES = null; // Map var -> name while writing an answer, so unbound variables print as the user wrote them
  function show(t, quoted, maxDepth, names, prec) {
    NAMES = names || null;
    try { return write(t, quoted === undefined ? true : quoted, prec || 1200, maxDepth || 60); } finally { NAMES = null; }
  }
  function write(t, q, prec, depth) {
    t = deref(t);
    if (depth <= 0) return "...";
    switch (t.t) {
      case "v":
        if (!NAMES) return "_G" + t.id;
        if (!NAMES.has(t)) { // fresh variables in an answer: _A, _B, …
          NAMES.fresh = (NAMES.fresh || 0) + 1;
          var k = NAMES.fresh - 1, nm = "";
          do { nm = String.fromCharCode(65 + k % 26) + nm; k = Math.floor(k / 26) - 1; } while (k >= 0);
          NAMES.set(t, "_" + nm);
        }
        return NAMES.get(t);
      case "i": case "f": return numText(t);
      case "a": return atomText(t.n, q);
      case "c": {
        if (t.n === "." && t.args.length === 2) {
          var parts = [], cur = t, k = 0;
          while (cur.t === "c" && cur.n === "." && cur.args.length === 2 && k < 500) {
            parts.push(write(cur.args[0], q, 999, depth - 1)); cur = deref(cur.args[1]); k++;
          }
          var tail = cur.t === "a" && cur.n === "[]" ? "" : "|" + write(cur, q, 999, depth - 1);
          return "[" + parts.join(",") + tail + "]";
        }
        if (t.n === "{}" && t.args.length === 1) return "{" + write(t.args[0], q, 1200, depth - 1) + "}";
        var o = OPS[t.n];
        if (t.args.length === 2 && o && o.infix) {
          var p = o.infix.p, lp = o.infix.type === "yfx" ? p : p - 1, rp = o.infix.type === "xfy" ? p : p - 1;
          var alpha = /^[a-z]/.test(t.n);
          var sep = t.n === "," ? "," : alpha || t.n === "->" || t.n === ":-" || t.n === ";" ? " " + t.n + " " : t.n;
          var ls = write(t.args[0], q, lp, depth - 1), rs = write(t.args[1], q, rp, depth - 1);
          // Keep symbolic operators from gluing to a neighbouring sign: "1- -1", not "1--1".
          if (sep === t.n && SYMCH.indexOf(t.n[0]) >= 0) {
            if (SYMCH.indexOf(rs[0]) >= 0) sep = sep + " ";
            if (SYMCH.indexOf(ls[ls.length - 1]) >= 0) sep = " " + sep;
          }
          var s = ls + sep + rs;
          return p > prec ? "(" + s + ")" : s;
        }
        if (t.args.length === 1 && o && o.prefix && t.n !== "-" || (t.args.length === 1 && t.n === "-" && deref(t.args[0]).t !== "i" && deref(t.args[0]).t !== "f")) {
          var pp = o.prefix.p, a = write(t.args[0], q, o.prefix.type === "fy" ? pp : pp - 1, depth - 1);
          var s2 = t.n + (/^[a-z]/.test(t.n) || /^[a-z(]/.test(a) && /[a-z]$/.test(t.n) ? " " : "") + a;
          return pp > prec ? "(" + s2 + ")" : s2;
        }
        return atomText(t.n, q) + "(" + t.args.map(function (x) { return write(x, q, 999, depth - 1); }).join(",") + ")";
      }
    }
    return "?";
  }

  // ------------------------------------------------------------------ copying and comparing

  function copyTerm(t, map) {
    t = deref(t);
    if (t.t === "v") { if (!map.has(t)) map.set(t, Var(t.n)); return map.get(t); }
    if (t.t === "c") return Str(t.n, t.args.map(function (a) { return copyTerm(a, map); }));
    return t;
  }
  // Compile a clause: variables become slots so renaming is a cheap array of fresh variables.
  function compile(t, slots) {
    t = deref(t);
    if (t.t === "v") { if (!slots.has(t)) slots.set(t, slots.size); return { t: "s", i: slots.get(t) }; }
    if (t.t === "c") return Str(t.n, t.args.map(function (a) { return compile(a, slots); }));
    return t;
  }
  function instantiate(t, frame) {
    if (t.t === "s") return frame[t.i] || (frame[t.i] = Var("_"));
    if (t.t === "c") {
      var args = new Array(t.args.length);
      for (var k = 0; k < args.length; k++) args[k] = instantiate(t.args[k], frame);
      return Str(t.n, args);
    }
    return t;
  }

  var ORDER = { v: 0, f: 1, i: 1, a: 3, c: 4 };
  function numVal(t) { return t.t === "i" ? Number(t.v) : t.v; }
  function compareTerms(a, b) {
    a = deref(a); b = deref(b);
    if (a === b) return 0;
    var oa = ORDER[a.t], ob = ORDER[b.t];
    if (oa !== ob) return oa < ob ? -1 : 1;
    switch (a.t) {
      case "v": return a.id < b.id ? -1 : 1;
      case "i": case "f": {
        if (a.t === "i" && b.t === "i") return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
        var x = numVal(a), y = numVal(b);
        if (x !== y) return x < y ? -1 : 1;
        return a.t === b.t ? 0 : a.t === "f" ? -1 : 1;
      }
      case "a": return a.n < b.n ? -1 : a.n > b.n ? 1 : 0;
      case "c": {
        if (a.args.length !== b.args.length) return a.args.length < b.args.length ? -1 : 1;
        if (a.n !== b.n) return a.n < b.n ? -1 : 1;
        for (var k = 0; k < a.args.length; k++) { var c = compareTerms(a.args[k], b.args[k]); if (c) return c; }
        return 0;
      }
    }
    return 0;
  }

  // ------------------------------------------------------------------ arithmetic

  function evalArith(t) {
    t = deref(t);
    switch (t.t) {
      case "i": case "f": return t;
      case "v": throw instErr();
      case "a": {
        if (t.n === "pi") return Flt(Math.PI);
        if (t.n === "e") return Flt(Math.E);
        if (t.n === "inf" || t.n === "infinite") return Flt(Infinity);
        if (t.n === "max_tagged_integer") return Int(Number.MAX_SAFE_INTEGER);
        if (t.n === "random") return Flt(Math.random());
        if (t.n === "[]") break;
        throw typeError("evaluable", Str("/", [t, Int(0)]));
      }
      case "c": {
        if (t.n === "." && t.args.length === 2 && deref(t.args[1]).t === "a") return evalArith(t.args[0]); // "a"
        var a = t.args.map(evalArith);
        var r = arith(t.n, a);
        if (r === undefined) throw typeError("evaluable", Str("/", [Atom(t.n), Int(t.args.length)]));
        return r;
      }
    }
    throw typeError("evaluable", t);
  }
  function isInt(x) { return x.t === "i"; }
  function toF(x) { return x.t === "i" ? Number(x.v) : x.v; }
  function needInt(x) { if (!isInt(x)) throw typeError("integer", x); return x.v; }
  function arith(name, a) {
    var x = a[0], y = a[1];
    if (a.length === 2) {
      switch (name) {
        case "+": return isInt(x) && isInt(y) ? Int(x.v + y.v) : Flt(toF(x) + toF(y));
        case "-": return isInt(x) && isInt(y) ? Int(x.v - y.v) : Flt(toF(x) - toF(y));
        case "*": return isInt(x) && isInt(y) ? Int(x.v * y.v) : Flt(toF(x) * toF(y));
        case "/":
          if (isInt(x) && isInt(y)) {
            if (y.v === 0n) throw new PrologError("evaluation_error(zero_divisor)");
            return x.v % y.v === 0n ? Int(x.v / y.v) : Flt(Number(x.v) / Number(y.v));
          }
          if (toF(y) === 0) throw new PrologError("evaluation_error(zero_divisor)");
          return Flt(toF(x) / toF(y));
        case "//": { var d = needInt(y); if (d === 0n) throw new PrologError("evaluation_error(zero_divisor)"); return Int(needInt(x) / d); }
        case "div": { var dv = needInt(y), nv = needInt(x); if (dv === 0n) throw new PrologError("evaluation_error(zero_divisor)"); var qv = nv / dv; if ((nv % dv !== 0n) && ((nv < 0n) !== (dv < 0n))) qv -= 1n; return Int(qv); }
        case "mod": { var m = needInt(y); if (m === 0n) throw new PrologError("evaluation_error(zero_divisor)"); return Int(((needInt(x) % m) + m) % m); }
        case "rem": { var rm = needInt(y); if (rm === 0n) throw new PrologError("evaluation_error(zero_divisor)"); return Int(needInt(x) % rm); }
        case "min": return compareNum(x, y) <= 0 ? x : y;
        case "max": return compareNum(x, y) >= 0 ? x : y;
        case "**": case "^":
          if (isInt(x) && isInt(y)) {
            if (y.v < 0n) { if (x.v === 1n) return Int(1); if (x.v === -1n) return Int(y.v % 2n === 0n ? 1 : -1); if (name === "^") throw typeError("integer", y); return Flt(Math.pow(Number(x.v), Number(y.v))); }
            return Int(x.v ** y.v);
          }
          return Flt(Math.pow(toF(x), toF(y)));
        case "atan2": case "atan": return Flt(Math.atan2(toF(x), toF(y)));
        case "log": return Flt(Math.log(toF(y)) / Math.log(toF(x)));
        case ">>": return Int(needInt(x) >> needInt(y));
        case "<<": return Int(needInt(x) << needInt(y));
        case "/\\": return Int(needInt(x) & needInt(y));
        case "\\/": return Int(needInt(x) | needInt(y));
        case "xor": return Int(needInt(x) ^ needInt(y));
        case "gcd": { var p = needInt(x), q = needInt(y); if (p < 0n) p = -p; if (q < 0n) q = -q; while (q) { var tmp = q; q = p % q; p = tmp; } return Int(p); }
        case "copysign": return Flt(Math.sign(toF(y)) * Math.abs(toF(x)));
      }
    } else if (a.length === 1) {
      switch (name) {
        case "-": return isInt(x) ? Int(-x.v) : Flt(-x.v);
        case "+": return x;
        case "abs": return isInt(x) ? Int(x.v < 0n ? -x.v : x.v) : Flt(Math.abs(x.v));
        case "sign": return isInt(x) ? Int(x.v > 0n ? 1 : x.v < 0n ? -1 : 0) : Flt(Math.sign(x.v));
        case "sqrt": return Flt(Math.sqrt(toF(x)));
        case "sin": return Flt(Math.sin(toF(x)));
        case "cos": return Flt(Math.cos(toF(x)));
        case "tan": return Flt(Math.tan(toF(x)));
        case "asin": return Flt(Math.asin(toF(x)));
        case "acos": return Flt(Math.acos(toF(x)));
        case "atan": return Flt(Math.atan(toF(x)));
        case "exp": return Flt(Math.exp(toF(x)));
        case "log": return Flt(Math.log(toF(x)));
        case "log2": return Flt(Math.log2(toF(x)));
        case "float": return Flt(toF(x));
        case "integer": return isInt(x) ? x : Int(BigInt(Math.round(x.v)));
        case "float_integer_part": return Flt(Math.trunc(toF(x)));
        case "float_fractional_part": return Flt(toF(x) - Math.trunc(toF(x)));
        case "truncate": return isInt(x) ? x : Int(BigInt(Math.trunc(x.v)));
        case "round": return isInt(x) ? x : Int(BigInt(Math.round(x.v)));
        case "ceiling": return isInt(x) ? x : Int(BigInt(Math.ceil(x.v)));
        case "floor": return isInt(x) ? x : Int(BigInt(Math.floor(x.v)));
        case "\\": return Int(~needInt(x));
        case "msb": return Int(needInt(x).toString(2).length - 1);
        case "succ": return Int(needInt(x) + 1n);
        case "random": return Int(BigInt(Math.floor(Math.random() * Number(needInt(x)))));
        case "random_float": return Flt(Math.random());
      }
    }
    return undefined;
  }
  function compareNum(x, y) {
    if (isInt(x) && isInt(y)) return x.v < y.v ? -1 : x.v > y.v ? 1 : 0;
    var p = toF(x), q = toF(y);
    return p < q ? -1 : p > q ? 1 : 0;
  }

  // ------------------------------------------------------------------ library (written in Prolog)

  var LIBRARY = [
    "append([], L, L).",
    "append([H|T], L, [H|R]) :- append(T, L, R).",
    "member(X, [X|_]).",
    "member(X, [_|T]) :- member(X, T).",
    "memberchk(X, L) :- member(X, L), !.",
    "reverse(L, R) :- '$rev'(L, [], R).",
    "'$rev'([], A, A).",
    "'$rev'([H|T], A, R) :- '$rev'(T, [H|A], R).",
    "length(L, N) :- var(N), !, '$len'(L, 0, N).",
    "length(L, N) :- integer(N), N >= 0, '$mk'(N, L).",
    "'$len'([], N, N).",
    "'$len'([_|T], A, N) :- A1 is A + 1, '$len'(T, A1, N).",
    "'$mk'(0, []) :- !.",
    "'$mk'(N, [_|T]) :- N1 is N - 1, '$mk'(N1, T).",
    "nth0(I, L, E) :- nth_(L, 0, I, E).",
    "nth1(I, L, E) :- nth_(L, 1, I, E).",
    "nth_([H|_], B, B, H).",
    "nth_([_|T], B, I, E) :- B1 is B + 1, nth_(T, B1, I, E).",
    "last([X], X) :- !.",
    "last([_|T], X) :- last(T, X).",
    "between(L, H, L) :- L =< H.",
    "between(L, H, X) :- L < H, L1 is L + 1, between(L1, H, X).",
    "numlist(L, H, []) :- L > H, !.",
    "numlist(L, H, [L|T]) :- L1 is L + 1, numlist(L1, H, T).",
    "select(X, [X|T], T).",
    "select(X, [H|T], [H|R]) :- select(X, T, R).",
    "selectchk(X, L, R) :- select(X, L, R), !.",
    "permutation([], []).",
    "permutation(L, [H|T]) :- select(H, L, R), permutation(R, T).",
    "delete([], _, []).",
    "delete([H|T], X, R) :- H \\= X, !, R = [H|R1], delete(T, X, R1).",
    "delete([_|T], X, R) :- delete(T, X, R).",
    "exclude(_, [], []).",
    "exclude(P, [H|T], R) :- ( call(P, H) -> R = R1 ; R = [H|R1] ), exclude(P, T, R1).",
    "include(_, [], []).",
    "include(P, [H|T], R) :- ( call(P, H) -> R = [H|R1] ; R = R1 ), include(P, T, R1).",
    "maplist(_, []).",
    "maplist(P, [A|As]) :- call(P, A), maplist(P, As).",
    "maplist(_, [], []).",
    "maplist(P, [A|As], [B|Bs]) :- call(P, A, B), maplist(P, As, Bs).",
    "maplist(_, [], [], []).",
    "maplist(P, [A|As], [B|Bs], [C|Cs]) :- call(P, A, B, C), maplist(P, As, Bs, Cs).",
    "foldl(G, L, A0, A) :- '$foldl'(L, G, A0, A).",
    "'$foldl'([], _, A, A).",
    "'$foldl'([X|Xs], G, A0, A) :- call(G, X, A0, A1), '$foldl'(Xs, G, A1, A).",
    "sum_list(L, S) :- '$sum'(L, 0, S).",
    "sumlist(L, S) :- sum_list(L, S).",
    "'$sum'([], S, S).",
    "'$sum'([H|T], A, S) :- A1 is A + H, '$sum'(T, A1, S).",
    "max_list([H|T], M) :- '$maxl'(T, H, M).",
    "'$maxl'([], M, M).",
    "'$maxl'([H|T], A, M) :- B is max(A, H), '$maxl'(T, B, M).",
    "min_list([H|T], M) :- '$minl'(T, H, M).",
    "'$minl'([], M, M).",
    "'$minl'([H|T], A, M) :- B is min(A, H), '$minl'(T, B, M).",
    "list_to_set(L, S) :- '$lts'(L, [], S).",
    "'$lts'([], _, []).",
    "'$lts'([H|T], Seen, R) :- ( memberchk(H, Seen) -> R = R1 ; R = [H|R1] ), '$lts'(T, [H|Seen], R1).",
    "subtract([], _, []).",
    "subtract([H|T], L, R) :- ( memberchk(H, L) -> R = R1 ; R = [H|R1] ), subtract(T, L, R1).",
    "intersection([], _, []).",
    "intersection([H|T], L, R) :- ( memberchk(H, L) -> R = [H|R1] ; R = R1 ), intersection(T, L, R1).",
    "union([], L, L).",
    "union([H|T], L, R) :- ( memberchk(H, L) -> R = R1 ; R = [H|R1] ), union(T, L, R1).",
    "not(G) :- \\+ G.",
    "forall(C, A) :- \\+ (C, \\+ A).",
    "ignore(G) :- (call(G) -> true ; true).",
    "once(G) :- call(G), !.",
    "concat_atom(L, R) :- atomic_list_concat(L, R).",
    "phrase(G, L) :- phrase(G, L, []).",
    "phrase(G, L, R) :- call(G, L, R).",
  ].join("\n");

  // ------------------------------------------------------------------ database

  function Prolog() {
    this.db = new Map();      // user predicates: "name/arity" -> {clauses: [], dynamic}
    this.lib = new Map();     // library predicates
    this.flags = { unknown: "error" };
    this.consultInto(LIBRARY, this.lib);
  }

  function keyOf(t) { return t.t === "a" ? t.n + "/0" : t.n + "/" + t.args.length; }
  function splitClause(t) {
    t = deref(t);
    if (t.t === "c" && t.n === ":-" && t.args.length === 2) return { head: deref(t.args[0]), body: t.args[1] };
    return { head: t, body: TRUE };
  }
  function makeClause(t) {
    var parts = splitClause(t), head = parts.head;
    if (head.t === "v") throw instErr();
    if (head.t !== "a" && head.t !== "c") throw typeError("callable", head);
    var slots = new Map();
    var ch = compile(head, slots), cb = compile(parts.body, slots);
    return { head: ch, body: cb, nvars: slots.size, key: keyOf(head) };
  }

  // DCG translation: Head --> Body.
  function dcgBody(b, S0, S) {
    b = deref(b);
    if (b.t === "c" && b.n === "," && b.args.length === 2) { var M = Var("_"); return Str(",", [dcgBody(b.args[0], S0, M), dcgBody(b.args[1], M, S)]); }
    if (b.t === "c" && (b.n === ";" || b.n === "|") && b.args.length === 2) return Str(";", [dcgBody(b.args[0], S0, S), dcgBody(b.args[1], S0, S)]);
    if (b.t === "c" && b.n === "->" && b.args.length === 2) { var M2 = Var("_"); return Str("->", [dcgBody(b.args[0], S0, M2), dcgBody(b.args[1], M2, S)]); }
    if (b.t === "a" && b.n === "!") return Str(",", [Atom("!"), Str("=", [S0, S])]);
    if (b.t === "a" && b.n === "[]") return Str("=", [S0, S]);
    if (b.t === "a" && b.str) return Str("=", [S0, list(Array.from(b.n).map(function (ch) { return Atom(ch); }), S)]);
    if (b.t === "c" && b.n === "{}" && b.args.length === 1) return Str(",", [b.args[0], Str("=", [S0, S])]);
    if (b.t === "c" && b.n === "\\+" && b.args.length === 1) return Str(",", [Str("\\+", [dcgBody(b.args[0], S0, Var("_"))]), Str("=", [S0, S])]);
    var items = listToArray(b);
    if (items) return Str("=", [S0, list(items, S)]);
    if (b.t === "c" && b.n === "call") return Str("call", b.args.concat([S0, S]));
    if (b.t === "a") return Str(b.n, [S0, S]);
    if (b.t === "c") return Str(b.n, b.args.concat([S0, S]));
    throw typeError("callable", b);
  }
  function dcgTransform(t) {
    var head = deref(t.args[0]), body = t.args[1], S0 = Var("S0"), S = Var("S");
    var pushback = null;
    if (head.t === "c" && head.n === "," ) { pushback = head.args[1]; head = deref(head.args[0]); }
    var nh = head.t === "a" ? Str(head.n, [S0, S]) : Str(head.n, head.args.concat([S0, S]));
    if (pushback) {
      var Mid = Var("_");
      nh = head.t === "a" ? Str(head.n, [S0, S]) : Str(head.n, head.args.concat([S0, S]));
      return Str(":-", [nh, Str(",", [dcgBody(body, S0, Mid), dcgBody(pushback, S, Mid)])]);
    }
    return Str(":-", [nh, dcgBody(body, S0, S)]);
  }

  Prolog.prototype.addClause = function (t, store, front) {
    t = deref(t);
    if (t.t === "c" && t.n === "-->" && t.args.length === 2) t = dcgTransform(t);
    var c = makeClause(t);
    if (store !== this.lib && (BUILTINS[c.key] || CONTROL[c.key] || /^call\/\d+$/.test(c.key))) {
      throw new PrologError("permission_error: cannot redefine the built-in predicate " + c.key);
    }
    var store2 = store || this.db;
    if (!store2.has(c.key)) store2.set(c.key, { clauses: [], dynamic: false });
    var pred = store2.get(c.key);
    if (front) pred.clauses.unshift(c); else pred.clauses.push(c);
  };

  // Load program text. Returns {errors: [...], output: "..."} — errors do not stop the rest of the file.
  Prolog.prototype.consultInto = function (text, store) {
    var errors = [], out = "";
    var toks;
    try { toks = tokenize(text); } catch (e) { return { errors: [e.message], output: "" }; }
    var ps = new Parser(toks);
    for (;;) {
      var t;
      try {
        t = ps.readClause();
      } catch (e) {
        errors.push(e.message);
        // Skip to the next clause end.
        while (ps.peek().type !== "end" && ps.peek().type !== "eof") ps.next();
        if (ps.peek().type === "end") ps.next();
        continue;
      }
      if (t === null) break;
      t = deref(t);
      if (t.t === "c" && t.n === ":-" && t.args.length === 1) { // directive
        var goal = deref(t.args[0]);
        if (goal.t === "c" && (goal.n === "dynamic" || goal.n === "discontiguous")) {
          if (goal.n === "dynamic") this.declareDynamic(goal.args[0]);
          continue;
        }
        if (goal.t === "c" && goal.n === "initialization") goal = deref(goal.args[0]);
        try {
          var q = this.queryTerm(goal, {}, []);
          var r = q.next();
          out += q.output;
          if (!r) errors.push("warning: directive failed: " + show(goal));
        } catch (e) { errors.push("directive " + show(goal) + ": " + e.message); }
        continue;
      }
      try { this.addClause(t, store); } catch (e) { errors.push(e.message); }
    }
    return { errors: errors, output: out };
  };
  Prolog.prototype.consult = function (text) {
    this.db = new Map();
    return this.consultInto(text, this.db);
  };
  Prolog.prototype.declareDynamic = function (spec) {
    var self = this;
    (function walk(s) {
      s = deref(s);
      if (s.t === "c" && (s.n === "," || s.n === "/") && s.n === ",") { walk(s.args[0]); walk(s.args[1]); return; }
      var items = listToArray(s);
      if (items) { items.forEach(walk); return; }
      if (s.t === "c" && s.n === "/" && s.args.length === 2) {
        var k = deref(s.args[0]).n + "/" + deref(s.args[1]).v;
        if (!self.db.has(k)) self.db.set(k, { clauses: [], dynamic: true });
        else self.db.get(k).dynamic = true;
      }
    })(spec);
  };
  Prolog.prototype.lookup = function (key) { return this.db.get(key) || this.lib.get(key) || null; };

  Prolog.prototype.query = function (text, opts) {
    var parsed = parseTerm(text);
    return this.queryTerm(parsed.term, parsed.vars, parsed.varList, opts);
  };
  Prolog.prototype.queryTerm = function (goal, vars, varList, opts) {
    return new Engine(this, goal, vars, varList, opts || {});
  };

  // ------------------------------------------------------------------ engine

  function Engine(prolog, goal, vars, varList, opts) {
    this.pl = prolog;
    this.vars = vars;
    this.varList = varList;
    this.trail = [];
    this.chp = [];
    this.goals = { term: goal, next: null, barrier: 0, depth: 0 };
    this.output = "";
    this.steps = 0;
    this.maxSteps = opts.maxSteps || 2000000;
    this.deadline = opts.deadline || 0;
    this.trace = opts.trace ? [] : null;
    if (this.trace) { // query variables keep their names in the trace; fresh ones become _A, _B…
      this.traceNames = new Map();
      for (var vi = 0; vi < varList.length; vi++) if (varList[vi][0] !== "_") this.traceNames.set(vars[varList[vi]], varList[vi]);
    }
    this.traceMax = opts.traceMax || 400;
    this.started = false;
    this.done = false;
    this.parent = opts.parent || null;
  }

  Engine.prototype.bind = function (v, t) { v.ref = t; this.trail.push(v); };
  Engine.prototype.undo = function (mark) {
    var tr = this.trail;
    while (tr.length > mark) tr.pop().ref = null;
  };
  Engine.prototype.unify = function (a, b, occurs) {
    var stack = [a, b];
    while (stack.length) {
      var y = deref(stack.pop()), x = deref(stack.pop());
      if (x === y) continue;
      if (x.t === "v") { if (occurs && occursIn(x, y)) return false; this.bind(x, y); continue; }
      if (y.t === "v") { if (occurs && occursIn(y, x)) return false; this.bind(y, x); continue; }
      if (x.t !== y.t) return false;
      if (x.t === "a") { if (x.n !== y.n) return false; continue; }
      if (x.t === "i") { if (x.v !== y.v) return false; continue; }
      if (x.t === "f") { if (x.v !== y.v) return false; continue; }
      if (x.n !== y.n || x.args.length !== y.args.length) return false;
      for (var k = 0; k < x.args.length; k++) stack.push(x.args[k], y.args[k]);
    }
    return true;
  };
  function occursIn(v, t) {
    t = deref(t);
    if (t === v) return true;
    if (t.t === "c") for (var k = 0; k < t.args.length; k++) if (occursIn(v, t.args[k])) return true;
    return false;
  }

  Engine.prototype.log = function (port, term, depth) {
    if (!this.trace || this.trace.length >= this.traceMax) return;
    this.trace.push({ port: port, depth: Math.min(depth, 30), text: show(term, true, 8, this.traceNames) });
  };

  // Next solution: true (bindings available), false (no more). Throws PrologError on errors.
  Engine.prototype.next = function () {
    if (this.done) return false;
    if (this.started) { if (!this.backtrack()) { this.done = true; return false; } }
    this.started = true;
    var ok = this.run();
    if (!ok) this.done = true;
    return ok;
  };

  Engine.prototype.backtrack = function () {
    for (;;) {
      var cp = this.chp.pop();
      if (!cp) return false;
      this.undo(cp.trail);
      if (cp.kind === "alt") { this.goals = cp.goals; return true; }
      if (cp.kind === "clauses") {
        this.log("Redo", cp.goal, cp.depth);
        if (this.tryClauses(cp.goal, cp.pred, cp.i, cp.next, cp.depth)) return true;
        continue;
      }
    }
  };

  // Try clauses of pred from index i; on success sets this.goals. Pushes a choicepoint for the rest.
  Engine.prototype.tryClauses = function (goal, pred, i, next, depth) {
    var cls = pred.clauses;
    var args = goal.t === "c" ? goal.args : null;
    for (; i < cls.length; i++) {
      var c = cls[i];
      // Cheap first-argument check before renaming.
      if (args && c.head.args && c.head.args.length) {
        var ga = deref(args[0]), ha = c.head.args[0];
        if (ga.t !== "v" && ha.t !== "s") {
          if (ga.t !== ha.t) continue;
          if (ga.t === "a" && ga.n !== ha.n) continue;
          if (ga.t === "i" && ga.v !== ha.v) continue;
          if (ga.t === "c" && (ga.n !== ha.n || ga.args.length !== ha.args.length)) continue;
        }
      }
      var barrier = this.chp.length;
      var mark = this.trail.length;
      if (i + 1 < cls.length) this.chp.push({ kind: "clauses", goal: goal, pred: pred, i: i + 1, next: next, depth: depth, trail: mark });
      var frame = new Array(c.nvars);
      var head = instantiate(c.head, frame);
      if (this.unify(head, goal)) {
        var body = instantiate(c.body, frame);
        var after = this.trace ? { term: Str("$exit", [goal, Int(depth)]), next: next, barrier: barrier, depth: depth } : next;
        this.goals = body.t === "a" && body.n === "true" ? after : { term: body, next: after, barrier: barrier, depth: depth + 1 };
        return true;
      }
      this.undo(mark);
      if (i + 1 < cls.length) this.chp.pop();
    }
    this.log("Fail", goal, depth);
    return false;
  };

  Engine.prototype.fail = function () { return this.backtrack(); };

  Engine.prototype.run = function () {
    for (;;) {
      if (this.goals === null) return true;
      if (++this.steps > this.maxSteps) throw new PrologError("resource limit: more than " + this.maxSteps + " inference steps (infinite loop?)");
      if ((this.steps & 0x3fff) === 0 && this.deadline && Date.now() > this.deadline) throw new PrologError("time limit exceeded (infinite loop?)");
      var fr = this.goals;
      this.goals = fr.next;
      var g = deref(fr.term);
      if (g.t === "v") throw instErr();
      if (g.t === "i" || g.t === "f") throw typeError("callable", g);
      var name = g.n, arity = g.t === "c" ? g.args.length : 0, A = g.t === "c" ? g.args : [];
      var key = name + "/" + arity;

      // Control constructs.
      if (key === "true/0") continue;
      if (key === "fail/0" || key === "false/0") { if (!this.backtrack()) return false; continue; }
      if (key === ",/2") {
        this.goals = { term: A[0], next: { term: A[1], next: this.goals, barrier: fr.barrier, depth: fr.depth }, barrier: fr.barrier, depth: fr.depth };
        continue;
      }
      if (key === "!/0") { this.chp.length = Math.min(this.chp.length, fr.barrier); continue; }
      if (key === "$exit/2") { this.log("Exit", A[0], Number(deref(A[1]).v)); continue; }
      if (key === "$cut/1") { this.chp.length = Math.min(this.chp.length, Number(deref(A[0]).v)); continue; }
      if (key === ";/2") {
        var lhs = deref(A[0]);
        if (lhs.t === "c" && lhs.n === "->" && lhs.args.length === 2) {
          var h = this.chp.length;
          this.chp.push({ kind: "alt", goals: { term: A[1], next: this.goals, barrier: fr.barrier, depth: fr.depth }, trail: this.trail.length });
          this.goals = { term: lhs.args[0], barrier: h + 1, depth: fr.depth,
            next: { term: Str("$cut", [Int(h)]), barrier: fr.barrier, depth: fr.depth,
              next: { term: lhs.args[1], next: this.goals, barrier: fr.barrier, depth: fr.depth } } };
          continue;
        }
        this.chp.push({ kind: "alt", goals: { term: A[1], next: this.goals, barrier: fr.barrier, depth: fr.depth }, trail: this.trail.length });
        this.goals = { term: A[0], next: this.goals, barrier: fr.barrier, depth: fr.depth };
        continue;
      }
      if (key === "->/2") {
        var h2 = this.chp.length;
        this.goals = { term: A[0], barrier: h2, depth: fr.depth,
          next: { term: Str("$cut", [Int(h2)]), barrier: fr.barrier, depth: fr.depth,
            next: { term: A[1], next: this.goals, barrier: fr.barrier, depth: fr.depth } } };
        continue;
      }
      if (key === "\\+/1") {
        this.goals = { term: Str(";", [Str("->", [A[0], Atom("fail")]), TRUE]), next: this.goals, barrier: fr.barrier, depth: fr.depth };
        continue;
      }
      if (name === "call" && arity >= 1) {
        var callee = deref(A[0]);
        if (callee.t === "v") throw instErr();
        if (arity > 1) {
          var extra = A.slice(1);
          if (callee.t === "a") callee = Str(callee.n, extra);
          else if (callee.t === "c") callee = Str(callee.n, callee.args.concat(extra));
          else throw typeError("callable", callee);
        }
        this.goals = { term: callee, next: this.goals, barrier: this.chp.length, depth: fr.depth + 1 };
        continue;
      }
      if (key === "findall/3") {
        var results = this.collect(A[1], A[0]);
        if (!this.unify(A[2], list(results))) { if (!this.backtrack()) return false; }
        continue;
      }
      if (key === "bagof/3" || key === "setof/3") { // simplified: no grouping by free variables
        var goal3 = deref(A[1]);
        while (goal3.t === "c" && goal3.n === "^" && goal3.args.length === 2) goal3 = deref(goal3.args[1]);
        var res = this.collect(goal3, A[0]);
        if (key === "setof/3") res = sortUnique(res);
        if (!res.length || !this.unify(A[2], list(res))) { if (!this.backtrack()) return false; }
        continue;
      }
      if (key === "aggregate_all/3") {
        if (!this.aggregateAll(A)) { if (!this.backtrack()) return false; }
        continue;
      }

      // Built-in predicates.
      var bi = BUILTINS[key];
      if (bi) {
        var ok = bi.call(this, A);
        if (ok === "halt") { this.goals = null; this.halted = true; return true; }
        if (!ok) { if (!this.backtrack()) return false; }
        continue;
      }

      // User and library predicates.
      var pred = this.pl.lookup(key);
      if (!pred) {
        if (this.pl.flags.unknown === "fail") { if (!this.backtrack()) return false; continue; }
        throw new PrologError("existence_error: unknown procedure " + key);
      }
      this.log("Call", g, fr.depth);
      if (!this.tryClauses(g, pred, 0, this.goals, fr.depth)) { if (!this.backtrack()) return false; }
    }
  };

  // Run a sub-query and collect a copy of the template for each solution (findall semantics).
  Engine.prototype.collect = function (goal, template) {
    var sub = new Engine(this.pl, goal, {}, [], { maxSteps: this.maxSteps - this.steps, deadline: this.deadline, parent: this });
    var out = [];
    try {
      while (sub.next()) {
        out.push(copyTerm(template, new Map()));
        if (out.length > 100000) throw new PrologError("resource limit: findall/3 collected too many solutions");
      }
    } finally {
      this.steps += sub.steps;
      this.output += sub.output;
      sub.undo(0);
    }
    return out;
  };
  Engine.prototype.aggregateAll = function (A) {
    var spec = deref(A[0]);
    if (spec.t === "a" && spec.n === "count") return this.unify(A[2], Int(this.collect(A[1], TRUE).length));
    if (spec.t !== "c" || spec.args.length !== 1) throw typeError("aggregate_spec", spec);
    var vals = this.collect(A[1], spec.args[0]);
    switch (spec.n) {
      case "count": return this.unify(A[2], Int(vals.length));
      case "bag": return this.unify(A[2], list(vals));
      case "set": return this.unify(A[2], list(sortUnique(vals)));
      case "sum": return this.unify(A[2], vals.reduce(function (acc, v) { return arith("+", [acc, evalArith(v)]); }, Int(0)));
      case "max": if (!vals.length) return false; return this.unify(A[2], vals.map(evalArith).reduce(function (a, b) { return compareNum(a, b) >= 0 ? a : b; }));
      case "min": if (!vals.length) return false; return this.unify(A[2], vals.map(evalArith).reduce(function (a, b) { return compareNum(a, b) <= 0 ? a : b; }));
    }
    throw typeError("aggregate_spec", spec);
  };
  function sortUnique(arr) {
    var s = arr.slice().sort(compareTerms), out = [];
    s.forEach(function (x) { if (!out.length || compareTerms(out[out.length - 1], x) !== 0) out.push(x); });
    return out;
  }

  // ------------------------------------------------------------------ built-ins

  function text(t) { // atom/number/code list -> JS string
    t = deref(t);
    if (t.t === "a") return t.n;
    if (t.t === "i" || t.t === "f") return numText(t);
    var items = listToArray(t);
    if (items) return items.map(function (x) { x = deref(x); return x.t === "i" ? String.fromCodePoint(Number(x.v)) : x.n; }).join("");
    if (t.t === "v") throw instErr();
    throw typeError("atomic", t);
  }
  function parseNumber(s) {
    s = s.trim();
    if (/^[+-]?\d+$/.test(s)) return Int(BigInt(s));
    if (/^[+-]?\d+\.\d+([eE][+-]?\d+)?$/.test(s)) return Flt(parseFloat(s));
    return null;
  }
  function formatDirective(fmt, args, eng) {
    var out = "", ai = 0, s = text(fmt);
    function nextArg() { if (ai >= args.length) throw new PrologError("format/2: not enough arguments"); return args[ai++]; }
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c !== "~") { out += c; continue; }
      var num = "";
      while (/[0-9]/.test(s[i + 1])) num += s[++i];
      var d = s[++i];
      switch (d) {
        case "w": case "a": out += show(nextArg(), false); break;
        case "q": case "p": out += show(nextArg(), true); break;
        case "d": { var v = evalArith(nextArg()); out += isInt(v) ? v.v.toString() : String(Math.trunc(v.v)); break; }
        case "f": case "e": case "g": { var fv = toF(evalArith(nextArg())); out += fv.toFixed(num ? Number(num) : 6); break; }
        case "s": out += text(nextArg()); break;
        case "n": out += "\n".repeat(num ? Number(num) : 1); break;
        case "t": case "|": case "+": break;
        case "~": out += "~"; break;
        case "c": { var code = Number(deref(nextArg()).v); out += String.fromCodePoint(code).repeat(num ? Number(num) : 1); break; }
        default: throw new PrologError("format/2: unknown directive ~" + d);
      }
    }
    void eng;
    return out;
  }
  function typeCheck(fn) { return function (A) { return fn(deref(A[0])); }; }

  var BUILTINS = {
    "=/2": function (A) { return this.unify(A[0], A[1]); },
    "\\=/2": function (A) { var m = this.trail.length, r = this.unify(A[0], A[1]); this.undo(m); return !r; },
    "unify_with_occurs_check/2": function (A) { return this.unify(A[0], A[1], true); },
    "==/2": function (A) { return compareTerms(A[0], A[1]) === 0; },
    "\\==/2": function (A) { return compareTerms(A[0], A[1]) !== 0; },
    "@</2": function (A) { return compareTerms(A[0], A[1]) < 0; },
    "@>/2": function (A) { return compareTerms(A[0], A[1]) > 0; },
    "@=</2": function (A) { return compareTerms(A[0], A[1]) <= 0; },
    "@>=/2": function (A) { return compareTerms(A[0], A[1]) >= 0; },
    "compare/3": function (A) { var c = compareTerms(A[1], A[2]); return this.unify(A[0], Atom(c < 0 ? "<" : c > 0 ? ">" : "=")); },
    "var/1": typeCheck(function (t) { return t.t === "v"; }),
    "nonvar/1": typeCheck(function (t) { return t.t !== "v"; }),
    "atom/1": typeCheck(function (t) { return t.t === "a"; }),
    "number/1": typeCheck(function (t) { return t.t === "i" || t.t === "f"; }),
    "integer/1": typeCheck(function (t) { return t.t === "i"; }),
    "float/1": typeCheck(function (t) { return t.t === "f"; }),
    "atomic/1": typeCheck(function (t) { return t.t === "a" || t.t === "i" || t.t === "f"; }),
    "compound/1": typeCheck(function (t) { return t.t === "c"; }),
    "callable/1": typeCheck(function (t) { return t.t === "a" || t.t === "c"; }),
    "is_list/1": function (A) { return listToArray(A[0]) !== null; },
    "ground/1": function (A) { return (function g(t) { t = deref(t); if (t.t === "v") return false; if (t.t === "c") return t.args.every(g); return true; })(A[0]); },
    "is/2": function (A) { return this.unify(A[0], evalArith(A[1])); },
    "=:=/2": function (A) { return compareNum(evalArith(A[0]), evalArith(A[1])) === 0; },
    "=\\=/2": function (A) { return compareNum(evalArith(A[0]), evalArith(A[1])) !== 0; },
    "</2": function (A) { return compareNum(evalArith(A[0]), evalArith(A[1])) < 0; },
    ">/2": function (A) { return compareNum(evalArith(A[0]), evalArith(A[1])) > 0; },
    "=</2": function (A) { return compareNum(evalArith(A[0]), evalArith(A[1])) <= 0; },
    ">=/2": function (A) { return compareNum(evalArith(A[0]), evalArith(A[1])) >= 0; },
    "succ/2": function (A) {
      var a = deref(A[0]), b = deref(A[1]);
      if (a.t === "i") { if (a.v < 0n) throw typeError("not_less_than_zero", a); return this.unify(b, Int(a.v + 1n)); }
      if (b.t === "i") { if (b.v <= 0n) return false; return this.unify(a, Int(b.v - 1n)); }
      throw instErr();
    },
    "plus/3": function (A) {
      var a = deref(A[0]), b = deref(A[1]), c = deref(A[2]);
      if (a.t !== "v" && b.t !== "v") return this.unify(c, arith("+", [evalArith(a), evalArith(b)]));
      if (a.t !== "v" && c.t !== "v") return this.unify(b, arith("-", [evalArith(c), evalArith(a)]));
      if (b.t !== "v" && c.t !== "v") return this.unify(a, arith("-", [evalArith(c), evalArith(b)]));
      throw instErr();
    },
    "functor/3": function (A) {
      var t = deref(A[0]);
      if (t.t === "v") {
        var n = deref(A[1]), ar = deref(A[2]);
        if (ar.t !== "i") throw instErr();
        var k = Number(ar.v);
        if (k === 0) return this.unify(t, n);
        var args = []; for (var i = 0; i < k; i++) args.push(Var("_"));
        return this.unify(t, Str(n.n, args));
      }
      if (t.t === "c") return this.unify(A[1], Atom(t.n)) && this.unify(A[2], Int(t.args.length));
      return this.unify(A[1], t) && this.unify(A[2], Int(0));
    },
    "arg/3": function (A) {
      var n = deref(A[0]), t = deref(A[1]);
      if (n.t !== "i" || t.t !== "c") throw instErr();
      var k = Number(n.v);
      if (k < 1 || k > t.args.length) return false;
      return this.unify(A[2], t.args[k - 1]);
    },
    "=../2": function (A) {
      var t = deref(A[0]);
      if (t.t === "v") {
        var items = listToArray(A[1]);
        if (!items || !items.length) throw instErr();
        var h = deref(items[0]);
        return this.unify(t, items.length === 1 ? h : Str(h.n, items.slice(1)));
      }
      return this.unify(A[1], t.t === "c" ? list([Atom(t.n)].concat(t.args)) : list([t]));
    },
    "copy_term/2": function (A) { return this.unify(A[1], copyTerm(A[0], new Map())); },
    "atom_length/2": function (A) { return this.unify(A[1], Int(Array.from(text(A[0])).length)); },
    "atom_chars/2": function (A) {
      var a = deref(A[0]);
      if (a.t !== "v") return this.unify(A[1], list(Array.from(text(a)).map(Atom)));
      return this.unify(a, Atom(text(A[1])));
    },
    "atom_codes/2": function (A) {
      var a = deref(A[0]);
      if (a.t !== "v") return this.unify(A[1], list(Array.from(text(a)).map(function (c) { return Int(c.codePointAt(0)); })));
      return this.unify(a, Atom(text(A[1])));
    },
    "char_code/2": function (A) {
      var a = deref(A[0]);
      if (a.t === "a") return this.unify(A[1], Int(a.n.codePointAt(0)));
      return this.unify(a, Atom(String.fromCodePoint(Number(deref(A[1]).v))));
    },
    "number_codes/2": function (A) {
      var a = deref(A[0]);
      if (a.t !== "v") return this.unify(A[1], list(Array.from(numText(a)).map(function (c) { return Int(c.codePointAt(0)); })));
      var nn = parseNumber(text(A[1])); if (!nn) throw new PrologError("syntax_error(illegal_number)");
      return this.unify(a, nn);
    },
    "atom_number/2": function (A) {
      var a = deref(A[0]);
      if (a.t === "v") { var b = deref(A[1]); if (b.t === "v") throw instErr(); return this.unify(a, Atom(numText(b))); }
      var nn = parseNumber(text(a));
      return nn ? this.unify(A[1], nn) : false;
    },
    "number_string/2": function (A) { var nn = parseNumber(text(A[1])); return nn ? this.unify(A[0], nn) : false; },
    "atom_string/2": function (A) { return this.unify(A[1], Atom(text(A[0]))); },
    "term_to_atom/2": function (A) { return this.unify(A[1], Atom(show(A[0], true))); },
    "upcase_atom/2": function (A) { return this.unify(A[1], Atom(text(A[0]).toUpperCase())); },
    "downcase_atom/2": function (A) { return this.unify(A[1], Atom(text(A[0]).toLowerCase())); },
    "atom_concat/3": function (A) {
      var a = deref(A[0]), b = deref(A[1]);
      if (a.t !== "v" && b.t !== "v") return this.unify(A[2], Atom(text(a) + text(b)));
      var whole = text(A[2]);
      if (a.t !== "v") { var pa = text(a); return whole.indexOf(pa) === 0 && this.unify(b, Atom(whole.slice(pa.length))); }
      if (b.t !== "v") { var pb = text(b); return whole.endsWith(pb) && this.unify(a, Atom(whole.slice(0, whole.length - pb.length))); }
      throw instErr();
    },
    "atomic_list_concat/2": function (A) { return this.unify(A[1], Atom(listToArray(A[0]).map(text).join(""))); },
    "atomic_list_concat/3": function (A) {
      var sep = text(A[1]), items = listToArray(A[0]);
      if (items && items.every(function (x) { return deref(x).t !== "v"; })) return this.unify(A[2], Atom(items.map(text).join(sep)));
      if (!sep) throw instErr();
      return this.unify(A[0], list(text(A[2]).split(sep).map(Atom)));
    },
    "sub_atom/5": function (A) { // only the common deterministic mode: sub_atom(+Atom, +B, +L, -A, -Sub)
      var s = text(A[0]), b = deref(A[1]), l = deref(A[2]);
      if (b.t !== "i" || l.t !== "i") throw new PrologError("sub_atom/5: only sub_atom(+Atom, +Before, +Length, -After, -Sub) is supported");
      var bb = Number(b.v), ll = Number(l.v);
      if (bb + ll > s.length) return false;
      return this.unify(A[3], Int(s.length - bb - ll)) && this.unify(A[4], Atom(s.substr(bb, ll)));
    },
    "write/1": function (A) { this.output += show(A[0], false); return true; },
    "print/1": function (A) { this.output += show(A[0], true); return true; },
    "writeln/1": function (A) { this.output += show(A[0], false) + "\n"; return true; },
    "writeq/1": function (A) { this.output += show(A[0], true); return true; },
    "write_canonical/1": function (A) { this.output += show(A[0], true); return true; },
    "write_term/2": function (A) { this.output += show(A[0], false); return true; },
    "nl/0": function () { this.output += "\n"; return true; },
    "tab/1": function (A) { this.output += " ".repeat(Number(evalArith(A[0]).v)); return true; },
    "format/1": function (A) { this.output += formatDirective(A[0], [], this); return true; },
    "format/2": function (A) {
      var args = listToArray(A[1]);
      this.output += formatDirective(A[0], args === null ? [A[1]] : args, this);
      return true;
    },
    "halt/0": function () { return "halt"; },
    "assert/1": function (A) { this.pl.addClause(copyTerm(A[0], new Map())); return true; },
    "assertz/1": function (A) { this.pl.addClause(copyTerm(A[0], new Map())); return true; },
    "asserta/1": function (A) { this.pl.addClause(copyTerm(A[0], new Map()), null, true); return true; },
    "retract/1": function (A) { // deterministic: removes the first matching clause
      var parts = splitClause(A[0]), key = keyOf(deref(parts.head)), pred = this.pl.db.get(key);
      if (!pred) return false;
      for (var i = 0; i < pred.clauses.length; i++) {
        var c = pred.clauses[i], frame = new Array(c.nvars), mark = this.trail.length;
        if (this.unify(instantiate(c.head, frame), parts.head) && this.unify(instantiate(c.body, frame), parts.body)) {
          pred.clauses.splice(i, 1);
          return true;
        }
        this.undo(mark);
      }
      return false;
    },
    "retractall/1": function (A) {
      var head = deref(A[0]), key = keyOf(head), pred = this.pl.db.get(key);
      if (!pred) { this.pl.db.set(key, { clauses: [], dynamic: true }); return true; }
      var self = this;
      pred.clauses = pred.clauses.filter(function (c) {
        var mark = self.trail.length, m = self.unify(instantiate(c.head, new Array(c.nvars)), head);
        self.undo(mark);
        return !m;
      });
      return true;
    },
    "msort/2": function (A) { return this.unify(A[1], list(listToArray(A[0]).slice().sort(compareTerms))); },
    "sort/2": function (A) { var items = listToArray(A[0]); if (!items) throw instErr(); return this.unify(A[1], list(sortUnique(items))); },
    "predsort/3": null,
    "keysort/2": function (A) {
      var items = listToArray(A[0]);
      var sorted = items.map(function (x, i) { return [x, i]; }).sort(function (p, q) {
        var c = compareTerms(deref(p[0]).args[0], deref(q[0]).args[0]); return c || p[1] - q[1];
      }).map(function (p) { return p[0]; });
      return this.unify(A[1], list(sorted));
    },
    "nb_getval/2": null,
    "tab/2": null,
  };
  Object.keys(BUILTINS).forEach(function (k) { if (!BUILTINS[k]) delete BUILTINS[k]; });
  // Handled directly by the engine's run loop; user programs may not redefine them either.
  var CONTROL = {};
  ["true/0", "fail/0", "false/0", ",/2", "!/0", ";/2", "->/2", "\\+/1", "findall/3", "bagof/3", "setof/3",
    "aggregate_all/3"].forEach(function (k) { CONTROL[k] = true; });

  // ------------------------------------------------------------------ public API

  function Query(engine) { this.engine = engine; }

  Prolog.prototype.solve = function (text, opts) {
    var parsed = parseTerm(text);
    var eng = new Engine(this, parsed.term, parsed.vars, parsed.varList, opts || {});
    return {
      vars: parsed.varList.filter(function (n) { return n[0] !== "_"; }),
      next: function () {
        eng.output = "";
        var ok = eng.next();
        var out = eng.output;
        if (!ok) return { ok: false, output: out, steps: eng.steps, trace: eng.trace };
        // Unbound variables print with the name the user gave them: their own name first, then an alias.
        var bindings = [], names = new Map();
        parsed.varList.forEach(function (n) {
          var u = deref(parsed.vars[n]);
          if (n[0] !== "_" && u === parsed.vars[n]) names.set(u, n);
        });
        parsed.varList.forEach(function (n) {
          var u = deref(parsed.vars[n]);
          if (n[0] !== "_" && u.t === "v" && !names.has(u)) names.set(u, n);
        });
        parsed.varList.forEach(function (n) {
          if (n[0] === "_") return;
          var v = deref(parsed.vars[n]);
          if (v.t === "v" && v === parsed.vars[n]) return; // unbound and unshared
          bindings.push([n, show(v, true, 60, names, 699)]); // written as the right side of "="
        });
        return { ok: true, bindings: bindings, output: out, steps: eng.steps, halted: !!eng.halted, more: eng.chp.length > 0, trace: eng.trace };
      },
    };
  };

  function parseProgram(text) {
    var ps = new Parser(tokenize(text)), out = [];
    for (;;) {
      var t = ps.readClause();
      if (t === null) return out;
      out.push({ term: t, varList: ps.varList });
    }
  }

  window.Prolog = {
    create: function () { return new Prolog(); },
    parse: function (text) { return parseTerm(text); },
    parseProgram: parseProgram,
    show: show,
    deref: deref,
    Var: Var,
    Str: Str,
    Atom: Atom,
    PrologError: PrologError,
    tokenize: tokenize,
  };
  void Query;
})();
