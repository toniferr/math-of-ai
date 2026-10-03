// Timeline — filter events by chapter with the chips above the list.
(function () {
  "use strict";
  var M = window.MOA;

  M.register("timeline/filter", function (bar) {
    var chips = Array.prototype.slice.call(bar.querySelectorAll(".chip"));
    var events = Array.prototype.slice.call(document.querySelectorAll(".event"));
    var eras = Array.prototype.slice.call(document.querySelectorAll(".era"));

    function apply(filter) {
      chips.forEach(function (c) { c.setAttribute("aria-pressed", c.dataset.filter === filter ? "true" : "false"); });
      events.forEach(function (e) { e.hidden = filter !== "all" && e.dataset.chapter !== filter; });
      eras.forEach(function (era) { era.classList.toggle("empty", !era.querySelector(".event:not([hidden])")); });
    }

    chips.forEach(function (c) {
      c.addEventListener("click", function () {
        var f = c.dataset.filter;
        apply(c.getAttribute("aria-pressed") === "true" && f !== "all" ? "all" : f);
      });
    });
  });
})();
