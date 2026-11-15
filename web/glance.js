/*
 * Ambient time of day, the calendar, apps opened from this screen, and the lights bridge.
 * The calendar link and the bridge token stay in the TV's own settings. Nothing here writes them to the log.
 * Tizen does not tell a third-party app what another app is playing, or how far a title has got, so those stay empty.
 */
var Glance = (function () {
  'use strict';

  var RECENT = 'fmtv.recent';
  var cachedEvent = null, eventProblem = '', wishAt = 0;

  /** Which ambient screen this hour belongs to. Each window starts at its hour and runs until the next one. */
  function phase(hour, windows) {
    var names = ['night', 'morning', 'day', 'evening'];
    var starts = [windows.night, windows.morning, windows.day, windows.evening];
    var best = 'day', gap = 48, i, since;
    hour = ((hour % 24) + 24) % 24;
    for (i = 0; i < names.length; i++) {
      since = (hour - (starts[i] % 24) + 24) % 24;
      if (since < gap) { gap = since; best = names[i]; }
    }
    return best;
  }

  function unfold(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  }

  function unescapeIcs(text) {
    return String(text || '').replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  }

  function icsTime(value) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?/.exec(value || '');
    if (!m) return 0;
    if (!m[4]) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    if (m[7]) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  }

  /** Events from an iCalendar file. All-day dates count as local midnight. */
  function parseIcs(text) {
    var body = unfold(text), blocks = body.split('BEGIN:VEVENT'), out = [], i, lines, ev, j, line, key, value;
    for (i = 1; i < blocks.length; i++) {
      lines = blocks[i].split('END:VEVENT')[0].split('\n');
      ev = {title: '', start: 0, end: 0};
      for (j = 0; j < lines.length; j++) {
        line = lines[j];
        if (!line || line.indexOf(':') < 0) continue;
        key = line.split(':')[0].split(';')[0].toUpperCase();
        value = line.slice(line.indexOf(':') + 1);
        if (key === 'SUMMARY') ev.title = unescapeIcs(value);
        else if (key === 'DTSTART') ev.start = icsTime(value);
        else if (key === 'DTEND') ev.end = icsTime(value);
      }
      if (ev.start && ev.title) out.push(ev);
    }
    return out;
  }

  /** The event on now, or the next one that has not ended. */
  function nextEvent(events, now) {
    var best = null, i, ev;
    for (i = 0; i < events.length; i++) {
      ev = events[i];
      if (ev.end && ev.end < now) continue;
      if (ev.start + 3 * 3600000 < now && !(ev.end && ev.end > now)) continue;
      if (!best || ev.start < best.start) best = ev;
    }
    return best;
  }

  function recent() {
    try { return JSON.parse(localStorage.getItem(RECENT)) || []; } catch (e) { return []; }
  }

  function noteLaunch(id, title) {
    if (!id) return;
    var list = recent().filter(function (x) { return x.id !== id; });
    list.unshift({id: id, title: title || id, at: Date.now()});
    if (list.length > 8) list.length = 8;
    try { localStorage.setItem(RECENT, JSON.stringify(list)); } catch (e) {}
  }

  function clampByte(n) { return n < 0 ? 0 : n > 255 ? 255 : Math.round(n); }

  /** A dark tint white text can sit on, mixed a little toward `rgb`. */
  function tintCss(r, g, b) {
    return 'rgb(' + clampByte(r * 0.4 + 14) + ',' + clampByte(g * 0.4 + 16) + ',' + clampByte(b * 0.4 + 22) + ')';
  }

  function parseColor(color) {
    var m = /^#?([0-9a-f]{6})$/i.exec(color || '');
    if (m) { var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color || '');
    return m ? [+m[1], +m[2], +m[3]] : [36, 40, 48];
  }

  function mixCss(base, tint, amount) {
    var a = parseColor(base), b = parseColor(tint), t = amount;
    return 'rgb(' + clampByte(a[0] * (1 - t) + b[0] * t) + ',' + clampByte(a[1] * (1 - t) + b[1] * t) + ',' + clampByte(a[2] * (1 - t) + b[2] * t) + ')';
  }

  function baseUrl() {
    var url = (typeof Prefs !== 'undefined' && Prefs.wizUrl) ? Prefs.wizUrl() : '';
    return String(url || '').replace(/\/+$/, '');
  }

  function token() {
    return (typeof Prefs !== 'undefined' && Prefs.wizToken) ? Prefs.wizToken() : '';
  }

  function request(method, path, body, done) {
    var root = baseUrl();
    if (!root || typeof XMLHttpRequest === 'undefined') { if (done) done(null); return; }
    var x = new XMLHttpRequest();
    var url = root + path;
    var key = token();
    if (key) url += (path.indexOf('?') >= 0 ? '&' : '?') + 'k=' + encodeURIComponent(key);
    x.open(method, url, true);
    x.timeout = 4000;
    try { if (key) x.setRequestHeader('X-Bridge-Token', key); } catch (e) {}
    if (body) try { x.setRequestHeader('Content-Type', 'application/json'); } catch (e2) {}
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var parsed = null;
      if (x.status === 200) { try { parsed = JSON.parse(x.responseText); } catch (e3) { parsed = {}; } }
      if (done) done(parsed);
    };
    x.onerror = x.ontimeout = function () { if (done) done(null); };
    try { x.send(body ? JSON.stringify(body) : null); } catch (e4) { if (done) done(null); }
  }

  function sendScene(scene, group) {
    request('POST', '/lights/scene', {scene: scene, group: group || ''}, function () {});
  }

  function pushStatus(status) {
    request('POST', '/tv/status', status, function () {});
  }

  function pullWish(apply) {
    request('GET', '/tv/wish', null, function (body) {
      if (!body || !body.at || body.at === wishAt) return;
      wishAt = body.at;
      apply(body);
    });
  }

  /** Tizen never exposes another app's playback, so this stays empty on purpose. */
  function nowPlaying() { return null; }

  return {
    phase: phase,
    parseIcs: parseIcs,
    nextEvent: nextEvent,
    event: function () { return cachedEvent; },
    eventProblem: function () { return eventProblem; },
    setEvent: function (ev) { cachedEvent = ev; },
    noteLaunch: noteLaunch,
    recent: recent,
    tintCss: tintCss,
    mixCss: mixCss,
    sendScene: sendScene,
    pushStatus: pushStatus,
    pullWish: pullWish,
    nowPlaying: nowPlaying,
    loadCalendar: function (url, done) {
      eventProblem = '';
      if (!url || typeof XMLHttpRequest === 'undefined') { cachedEvent = null; if (done) done(); return; }
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.timeout = 8000;
      x.onreadystatechange = function () {
        if (x.readyState !== 4) return;
        if (x.status !== 200) { eventProblem = 'fail'; cachedEvent = null; if (done) done(); return; }
        cachedEvent = nextEvent(parseIcs(x.responseText), Date.now());
        if (done) done();
      };
      x.onerror = x.ontimeout = function () { eventProblem = 'fail'; cachedEvent = null; if (done) done(); };
      try { x.send(); } catch (e) { eventProblem = 'fail'; if (done) done(); }
    }
  };
})();
