/*
 * The slowest bit of work in the last 10 seconds, for the yellow timing overlay.
 * A label is kept only when it took at least 8 ms, so the rain frames themselves stay off the line.
 */
var Pace = (function () {
  'use strict';

  var label = '', ms = 0, at = 0;

  function note(name, dur) {
    if (!(dur >= 8)) return;
    var t = Date.now();
    if (!at || t - at > 10000) ms = 0;
    if (dur >= ms) { ms = dur; label = name; at = t; }
  }

  function time(name, fn) {
    var t0 = Date.now();
    var out = fn();
    note(name, Date.now() - t0);
    return out;
  }

  return {
    note: note,
    time: time,
    read: function () { return {label: label, ms: Math.round(ms), at: at}; }
  };
})();
