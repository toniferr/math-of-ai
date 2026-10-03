"""A small TeX-to-MathML converter (standard library only).

It covers the subset of LaTeX math used in this site's chapters and turns it into native
MathML Core at build time, so pages need no math JavaScript, no web fonts and no CDN.
Unknown commands raise TexError, so a typo fails the build instead of rendering garbage.

    to_mathml(r"H(X) = -\\sum_x p(x)\\log_2 p(x)", display=True)
"""
from __future__ import annotations

import re
from html import escape


class TexError(ValueError):
    pass


GREEK = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ϵ", "varepsilon": "ε",
    "zeta": "ζ", "eta": "η", "theta": "θ", "vartheta": "ϑ", "iota": "ι", "kappa": "κ",
    "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "pi": "π", "rho": "ρ", "sigma": "σ",
    "tau": "τ", "upsilon": "υ", "phi": "ϕ", "varphi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",
}
GREEK_UPPER = {
    "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ", "Pi": "Π",
    "Sigma": "Σ", "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω",
}
OPERATORS = {
    "cdot": "⋅", "times": "×", "div": "÷", "pm": "±", "mp": "∓", "leq": "≤", "le": "≤",
    "geq": "≥", "ge": "≥", "neq": "≠", "ne": "≠", "approx": "≈", "sim": "∼", "simeq": "≃",
    "equiv": "≡", "propto": "∝", "in": "∈", "notin": "∉", "subset": "⊂", "subseteq": "⊆",
    "cup": "∪", "cap": "∩", "to": "→", "rightarrow": "→", "leftarrow": "←", "gets": "←",
    "Rightarrow": "⇒", "Leftarrow": "⇐", "Leftrightarrow": "⇔", "iff": "⟺", "implies": "⟹",
    "mapsto": "↦", "ll": "≪", "gg": "≫", "mid": "∣", "parallel": "∥", "forall": "∀",
    "exists": "∃", "neg": "¬", "land": "∧", "lor": "∨", "oplus": "⊕", "otimes": "⊗",
    "odot": "⊙", "circ": "∘", "ast": "∗", "star": "⋆", "bullet": "∙", "ldots": "…",
    "dots": "…", "cdots": "⋯", "vdots": "⋮", "ddots": "⋱", "langle": "⟨", "rangle": "⟩",
    "lvert": "|", "rvert": "|", "vert": "|", "lVert": "‖", "rVert": "‖", "Vert": "‖",
    "lfloor": "⌊", "rfloor": "⌋", "lceil": "⌈", "rceil": "⌉", "colon": ":", "setminus": "∖",
    "triangleq": "≜", "coloneqq": "≔", "uparrow": "↑", "downarrow": "↓", "perp": "⟂",
    "lessapprox": "⪅", "lesssim": "≲", "gtrsim": "≳", "longrightarrow": "⟶", "longmapsto": "⟼", "succ": "≻", "prec": "≺", "approxeq": "≊", "leftrightarrow": "↔",
}
IDENTIFIERS = {
    "infty": "∞", "partial": "∂", "nabla": "∇", "ell": "ℓ", "emptyset": "∅", "varnothing": "∅",
    "top": "⊤", "bot": "⊥", "hbar": "ℏ", "aleph": "ℵ", "Box": "□", "checkmark": "✓",
}
LARGE_OPS = {"sum": "∑", "prod": "∏", "bigcup": "⋃", "bigcap": "⋂", "coprod": "∐"}
INTEGRALS = {"int": "∫", "iint": "∬", "oint": "∮"}
FUNCTIONS = {
    "log", "ln", "exp", "sin", "cos", "tan", "tanh", "sinh", "cosh", "det", "dim", "ker",
    "Pr", "deg", "gcd", "sgn", "rank", "tr", "erf",
}
LIMIT_FUNCTIONS = {"lim": "lim", "max": "max", "min": "min", "sup": "sup", "inf": "inf",
                   "argmax": "arg max", "argmin": "arg min", "limsup": "lim sup", "liminf": "lim inf"}
SPACES = {",": "0.1667em", ":": "0.2222em", ">": "0.2222em", ";": "0.2778em",
          "!": "-0.1667em", " ": "0.25em", "quad": "1em", "qquad": "2em"}
ESCAPES = {"{": "{", "}": "}", "%": "%", "$": "$", "#": "#", "_": "_", "&": "&", "|": "‖"}
ACCENTS = {  # command: (mark, stretchy)
    "hat": ("^", False), "widehat": ("^", True), "bar": ("¯", False), "overline": ("‾", True),
    "vec": ("→", False), "tilde": ("˜", False), "widetilde": ("˜", True), "dot": ("˙", False),
    "ddot": ("¨", False),
}
BIG = {"big": "1.2em", "Big": "1.623em", "bigg": "2.047em", "Bigg": "2.470em"}
MATRIX_FENCES = {"matrix": None, "pmatrix": ("(", ")"), "bmatrix": ("[", "]"),
                 "vmatrix": ("|", "|"), "Vmatrix": ("‖", "‖"), "Bmatrix": ("{", "}")}
OPERATOR_CHARS = set("+-=<>()[]|/,;:!?.*")


def _styled(ch: str, style: str) -> str | None:
    """Map a letter or digit to its Unicode mathematical-alphanumeric form (MathML Core has no mathvariant)."""
    o = ord(ch)
    upper, lower, digit = "A" <= ch <= "Z", "a" <= ch <= "z", "0" <= ch <= "9"
    if style == "bold":
        if upper: return chr(0x1D400 + o - 65)
        if lower: return chr(0x1D41A + o - 97)
        if digit: return chr(0x1D7CE + o - 48)
        if "α" <= ch <= "ω": return chr(0x1D6C2 + o - 0x3B1)
        if "Α" <= ch <= "Ω": return chr(0x1D6A8 + o - 0x391)
    elif style == "bolditalic":
        if upper: return chr(0x1D468 + o - 65)
        if lower: return chr(0x1D482 + o - 97)
        if digit: return chr(0x1D7CE + o - 48)
        if "α" <= ch <= "ω": return chr(0x1D736 + o - 0x3B1)
        if ch in "ϵϕ": return {"ϵ": "\U0001D750", "ϕ": "\U0001D753"}[ch]
    elif style == "double":
        special = {"C": "ℂ", "H": "ℍ", "N": "ℕ", "P": "ℙ", "Q": "ℚ", "R": "ℝ", "Z": "ℤ"}
        if ch in special: return special[ch]
        if upper: return chr(0x1D538 + o - 65)
        if digit: return chr(0x1D7D8 + o - 48)
    elif style == "script":
        special = {"B": "ℬ", "E": "ℰ", "F": "ℱ", "H": "ℋ", "I": "ℐ", "L": "ℒ", "M": "ℳ", "R": "ℛ"}
        if ch in special: return special[ch]
        if upper: return chr(0x1D49C + o - 65)
    return None


class Node:
    """A parsed atom. `limits` puts scripts under/over it; `after` is appended after its scripts."""

    def __init__(self, xml: str, limits: bool = False, integral: bool = False, after: str = "",
                 style: str | None = None):
        self.xml, self.limits, self.integral, self.after, self.style = xml, limits, integral, after, style


def _mrow(parts: list[str]) -> str:
    return parts[0] if len(parts) == 1 else "<mrow>" + "".join(parts) + "</mrow>"


def _mo(ch: str, **attrs) -> str:
    a = "".join(f' {k.replace("_", "")}="{v}"' for k, v in attrs.items())
    return f"<mo{a}>{escape(ch)}</mo>"


FUNC_APPLY = '<mo lspace="0" rspace="0.1667em">\u2061</mo>'
FENCES = set("()[]{}|\u2016\u27e8\u27e9\u230a\u230b\u2308\u2309")


def _plain(ch: str) -> str:
    """An operator outside \\left/\\right: fences keep their natural size."""
    return _mo(ch, stretchy="false") if ch in FENCES else _mo(ch)


class Parser:
    def __init__(self, src: str):
        self.s, self.i = src, 0

    # ---------------------------------------------------------------- scanning
    def error(self, msg: str) -> TexError:
        return TexError(f"{msg} at position {self.i} in: {self.s}")

    def skip_ws(self) -> None:
        while self.i < len(self.s) and self.s[self.i] in " \t\r\n":
            self.i += 1

    def peek(self) -> str:
        self.skip_ws()
        return self.s[self.i] if self.i < len(self.s) else ""

    def peek_cmd(self) -> str | None:
        """Name of the command at the cursor, without consuming it."""
        self.skip_ws()
        if self.i < len(self.s) and self.s[self.i] == "\\":
            m = re.match(r"\\([A-Za-z]+\*?|.)", self.s[self.i:])
            return m.group(1) if m else None
        return None

    def read_cmd(self) -> str:
        m = re.match(r"\\([A-Za-z]+\*?|.)", self.s[self.i:])
        if not m:
            raise self.error("dangling backslash")
        self.i += m.end()
        return m.group(1)

    def read_raw_group(self) -> str:
        """The verbatim text of the next {...} group (for \\text, \\begin and friends)."""
        if self.peek() != "{":
            raise self.error("expected '{'")
        depth, start = 0, self.i
        while self.i < len(self.s):
            c = self.s[self.i]
            if c == "\\":
                self.i += 2
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    self.i += 1
                    return self.s[start + 1:self.i - 1]
            self.i += 1
        raise self.error("unbalanced braces")

    def read_optional(self) -> str | None:
        if self.peek() != "[":
            return None
        end = self.s.index("]", self.i)
        raw, self.i = self.s[self.i + 1:end], end + 1
        return raw

    # ---------------------------------------------------------------- grammar
    def parse_seq(self) -> list[str]:
        """Atoms up to '}', '&', '\\\\', '\\right', '\\middle', '\\end' or the end of input."""
        out: list[str] = []
        while True:
            c = self.peek()
            if c == "" or c in "}&":
                return out
            cmd = self.peek_cmd()
            if cmd in ("\\", "right", "middle", "end"):
                return out
            node = self.parse_atom()
            if node.style:  # \displaystyle applies to the rest of the group
                rest = self.parse_seq()
                out.append(f'<mstyle displaystyle="{node.style}">{_mrow(rest or ["<mrow></mrow>"])}</mstyle>')
                return out
            out.append(self.parse_scripts(node))

    def parse_group(self) -> str:
        self.i += 1  # '{'
        items = self.parse_seq()
        if self.peek() != "}":
            raise self.error("expected '}'")
        self.i += 1
        return _mrow(items) if items else "<mrow></mrow>"

    def parse_arg(self) -> str:
        c = self.peek()
        if c == "{":
            return self.parse_group()
        if c == "":
            raise self.error("missing argument")
        return self.parse_atom(single=True).xml

    def parse_scripts(self, base: Node) -> str:
        sub = sup = None
        primes = 0
        while True:
            c = self.peek()
            if c == "'":
                self.i += 1
                primes += 1
            elif c == "_" and sub is None:
                self.i += 1
                sub = self.parse_arg()
            elif c == "^" and sup is None:
                self.i += 1
                sup = self.parse_arg()
            elif self.peek_cmd() in ("limits", "nolimits"):
                base.limits = self.read_cmd() == "limits"
            else:
                break
        if primes:
            mark = _mo("′" * primes)
            sup = mark if sup is None else f"<mrow>{mark}{sup}</mrow>"
        b = base.xml
        if sub is None and sup is None:
            xml = b
        elif base.limits and not base.integral:
            if sub is not None and sup is not None:
                xml = f"<munderover>{b}{sub}{sup}</munderover>"
            elif sub is not None:
                xml = f"<munder>{b}{sub}</munder>"
            else:
                xml = f"<mover>{b}{sup}</mover>"
        elif sub is not None and sup is not None:
            xml = f"<msubsup>{b}{sub}{sup}</msubsup>"
        elif sub is not None:
            xml = f"<msub>{b}{sub}</msub>"
        else:
            xml = f"<msup>{b}{sup}</msup>"
        return xml + base.after

    def parse_atom(self, single: bool = False) -> Node:
        c = self.peek()
        if c == "{":
            return Node(self.parse_group())
        if c == "\\":
            return self.parse_command()
        if c in "^_":  # script with no base
            return Node("<mrow></mrow>")
        if c.isdigit() or (c == "." and self.s[self.i + 1:self.i + 2].isdigit()):
            if single:
                self.i += 1
                return Node(f"<mn>{c}</mn>")
            m = re.match(r"[0-9]*\.?[0-9]+|[0-9]+", self.s[self.i:])
            self.i += m.end()
            return Node(f"<mn>{m.group(0)}</mn>")
        self.i += 1
        if c.isalpha():
            return Node(f"<mi>{escape(c)}</mi>")
        if c == "-":
            return Node(_mo("−"))
        if c == "*":
            return Node(_mo("∗"))
        if c == "~":
            return Node('<mspace width="0.25em"></mspace>')
        if c in OPERATOR_CHARS or not c.isalnum():
            return Node(_plain(c))
        raise self.error(f"unexpected character {c!r}")

    def parse_delim(self) -> str:
        """A delimiter after \\left, \\right, \\middle or \\big."""
        c = self.peek()
        if c == "\\":
            name = self.read_cmd()
            if name in OPERATORS:
                return OPERATORS[name]
            if name in ESCAPES:
                return ESCAPES[name]
            raise self.error(f"unknown delimiter \\{name}")
        self.i += 1
        return "" if c == "." else c

    def parse_command(self) -> Node:
        name = self.read_cmd()
        if name in GREEK:
            return Node(f"<mi>{GREEK[name]}</mi>")
        if name in GREEK_UPPER:
            return Node(f'<mi mathvariant="normal">{GREEK_UPPER[name]}</mi>')
        if name in OPERATORS:
            return Node(_plain(OPERATORS[name]))
        if name in IDENTIFIERS:
            return Node(f"<mi>{IDENTIFIERS[name]}</mi>")
        if name in LARGE_OPS:
            return Node(_mo(LARGE_OPS[name], largeop="true", movablelimits="true"), limits=True)
        if name in INTEGRALS:
            return Node(_mo(INTEGRALS[name], largeop="true"), limits=True, integral=True)
        if name in FUNCTIONS:
            return Node(f"<mi>{name}</mi>", after=FUNC_APPLY)
        if name in LIMIT_FUNCTIONS:
            return Node(_mo(LIMIT_FUNCTIONS[name], movablelimits="true", form="prefix"), limits=True,
                        after=FUNC_APPLY)
        if name in SPACES:
            return Node(f'<mspace width="{SPACES[name]}"></mspace>')
        if name in ESCAPES:
            return Node(_plain(ESCAPES[name]))
        if name in ("frac", "dfrac", "tfrac"):
            num, den = self.parse_arg(), self.parse_arg()
            xml = f"<mfrac>{num}{den}</mfrac>"
            if name == "dfrac":
                xml = f'<mstyle displaystyle="true">{xml}</mstyle>'
            elif name == "tfrac":
                xml = f'<mstyle displaystyle="false">{xml}</mstyle>'
            return Node(xml)
        if name == "binom":
            n, k = self.parse_arg(), self.parse_arg()
            return Node(f'<mrow>{_mo("(")}<mfrac linethickness="0">{n}{k}</mfrac>{_mo(")")}</mrow>')
        if name == "sqrt":
            index = self.read_optional()
            body = self.parse_arg()
            if index is not None:
                return Node(f"<mroot>{body}{_mrow(Parser(index).parse_seq())}</mroot>")
            return Node(f"<msqrt>{body}</msqrt>")
        if name in ("text", "textrm", "textit", "mbox", "textbf"):
            raw = self.read_raw_group().replace("~", "\u00a0")
            raw = re.sub(r"\\([{}%$#&_])", r"\1", raw)
            return Node(f"<mtext>{escape(raw)}</mtext>")
        if name in ("mathrm", "operatorname", "operatorname*"):
            raw = self.read_raw_group().strip()
            if not re.fullmatch(r"[\w \-]+", raw):
                raise self.error(f"unsupported \\{name} content {raw!r}")
            if name == "mathrm" and len(raw) == 1:
                return Node(f'<mi mathvariant="normal">{raw}</mi>')
            if name == "operatorname*":
                return Node(_mo(raw, movablelimits="true", form="prefix"), limits=True, after=FUNC_APPLY)
            if name == "operatorname":
                return Node(f"<mi>{escape(raw)}</mi>", after=FUNC_APPLY)
            return Node(f"<mi>{escape(raw)}</mi>")
        if name in ("mathbf", "mathbb", "mathcal", "boldsymbol", "bm"):
            style = {"mathbf": "bold", "mathbb": "double", "mathcal": "script"}.get(name, "bolditalic")
            return Node(self.styled_letters(self.read_raw_group(), style))
        if name in ACCENTS:
            mark, stretchy = ACCENTS[name]
            body = self.parse_arg()
            return Node(f'<mover accent="true">{body}{_mo(mark, stretchy=str(stretchy).lower())}</mover>')
        if name == "underline":
            body = self.parse_arg()
            return Node(f'<munder accentunder="true">{body}{_mo("‾", stretchy="true")}</munder>')
        if name in ("underbrace", "overbrace"):
            body = self.parse_arg()
            under = name == "underbrace"
            brace = _mo("⏟" if under else "⏞", stretchy="true")
            tag = "munder" if under else "mover"
            xml = f"<{tag}>{body}{brace}</{tag}>"
            if self.peek() == ("_" if under else "^"):
                self.i += 1
                label = self.parse_arg()
                xml = f"<{tag}>{xml}{label}</{tag}>"
            return Node(xml)
        if name in ("overset", "stackrel", "underset"):
            over, body = self.parse_arg(), self.parse_arg()
            tag = "munder" if name == "underset" else "mover"
            return Node(f"<{tag}>{body}{over}</{tag}>")
        if name == "left":
            open_ = self.parse_delim()
            parts = [_mo(open_, fence="true", stretchy="true")] if open_ else []
            while True:
                parts += self.parse_seq()
                cmd = self.peek_cmd()
                if cmd == "middle":
                    self.read_cmd()
                    parts.append(_mo(self.parse_delim(), stretchy="true"))
                    continue
                if cmd != "right":
                    raise self.error("\\left without \\right")
                self.read_cmd()
                close = self.parse_delim()
                if close:
                    parts.append(_mo(close, fence="true", stretchy="true"))
                return Node(f"<mrow>{''.join(parts)}</mrow>")
        big = re.sub(r"[lrm]$", "", name)
        if big in BIG:
            size = BIG[big]
            return Node(_mo(self.parse_delim(), minsize=size, maxsize=size, stretchy="true"))
        if name == "class":
            cls = self.read_raw_group().strip()
            if not re.fullmatch(r"[a-z][a-z0-9-]*", cls):
                raise self.error(f"bad class name {cls!r}")
            return Node(f'<mrow class="{cls}">{self.parse_arg()}</mrow>')
        if name in ("displaystyle", "textstyle"):
            return Node("", style="true" if name == "displaystyle" else "false")
        if name == "not":
            nxt = self.parse_atom()
            if nxt.xml == _mo("="):
                return Node(_mo("≠"))
            if nxt.xml == _mo("∈"):
                return Node(_mo("∉"))
            raise self.error("unsupported \\not")
        if name in ("mod", "bmod"):
            return Node(_mo("mod", lspace="0.2777em", rspace="0.2777em"))
        if name == "begin":
            return Node(self.parse_env(self.read_raw_group().strip()))
        raise self.error(f"unknown command \\{name}")

    def styled_letters(self, raw: str, style: str) -> str:
        chars: list[str] = []
        j = 0
        while j < len(raw):
            if raw[j] == "\\":
                m = re.match(r"\\([A-Za-z]+)", raw[j:])
                if not m or (m.group(1) not in GREEK and m.group(1) not in GREEK_UPPER):
                    raise self.error(f"unsupported styled content {raw!r}")
                chars.append(GREEK.get(m.group(1)) or GREEK_UPPER[m.group(1)])
                j += m.end()
            elif raw[j] != " ":
                chars.append(raw[j])
                j += 1
            else:
                j += 1
        out = []
        for ch in chars:
            mapped = _styled(ch, style)
            if mapped is None:
                raise self.error(f"no {style} form for {ch!r}")
            tag = "mn" if ch.isdigit() else "mi"
            out.append(f"<{tag}>{mapped}</{tag}>")
        return _mrow(out)

    def parse_env(self, env: str) -> str:
        rows: list[list[str]] = [[]]
        while True:
            rows[-1].append(_mrow(self.parse_seq() or ["<mrow></mrow>"]))
            c = self.peek()
            if c == "&":
                self.i += 1
                continue
            cmd = self.peek_cmd()
            if cmd == "\\":
                self.read_cmd()
                rows.append([])
                continue
            if cmd == "end":
                self.read_cmd()
                if self.read_raw_group().strip() != env:
                    raise self.error(f"mismatched \\end for {env}")
                break
            raise self.error(f"unterminated environment {env}")
        if rows[-1] == ["<mrow></mrow>"]:  # trailing \\
            rows.pop()

        def table(align: str | None = None, cls: str = "") -> str:
            body = "".join("<mtr>" + "".join(f"<mtd>{c}</mtd>" for c in r) + "</mtr>" for r in rows)
            a = f' columnalign="{align}"' if align else ""
            c = f' class="{cls}"' if cls else ""
            return f"<mtable{a}{c}>{body}</mtable>"

        if env in MATRIX_FENCES:
            fences = MATRIX_FENCES[env]
            t = table(cls="matrix")
            if not fences:
                return t
            return f"<mrow>{_mo(fences[0], fence='true')}{t}{_mo(fences[1], fence='true')}</mrow>"
        if env == "cases":
            return f'<mrow>{_mo("{", fence="true")}{table("left left", "cases")}</mrow>'
        if env in ("aligned", "align*", "align"):
            body = "".join("<mtr>" + "".join(
                f'<mtd class="{"al-r" if k % 2 == 0 else "al-l"}"><mstyle displaystyle="true">{c}</mstyle></mtd>'
                for k, c in enumerate(r)) + "</mtr>" for r in rows)
            return f'<mtable class="aligned">{body}</mtable>'
        raise self.error(f"unknown environment {env}")


def to_mathml(tex: str, display: bool = False) -> str:
    p = Parser(tex.strip())
    items = p.parse_seq()
    if p.peek() != "":
        raise p.error("unexpected input")
    body = _mrow(items) if items else "<mrow></mrow>"
    if display:
        return f'<math display="block">{body}</math>'
    return f"<math>{body}</math>"
