/*
 * Live weather, drawn on one canvas for the screensaver and, more quietly, over the home screen and the photos.
 * It reads the forecast the app already keeps (Open-Meteo, through Data.weather) and adds nothing of its own until
 * that canvas is actually showing. A 2021 Samsung (Tizen 6) draws this in 2D: the picture is at most 1280 wide and
 * scaled up, and the drops are a fixed list, so a frame does not allocate. Lightning follows a thunderstorm code,
 * and a severe US alert when the forecast's point has one (api.weather.gov allows any site to read it).
 */
var LiveWeather = (function () {
  'use strict';

  var MAX = 280;
  var drops = new Array(MAX);
  var streaks = new Array(12);
  var clouds = new Array(6);
  var stars = new Array(48);
  var i;
  for (i = 0; i < MAX; i++) drops[i] = {x: 0, y: 0, s: 0, len: 0, on: 0};
  for (i = 0; i < streaks.length; i++) streaks[i] = {x: 0, y: 0, len: 0, a: 0, on: 0};
  for (i = 0; i < clouds.length; i++) clouds[i] = {x: 0, y: 0, r: 0, s: 0, on: 0};
  for (i = 0; i < stars.length; i++) stars[i] = {x: Math.random(), y: Math.random() * 0.55, p: Math.random() * 6.28};

  /** What to draw for a WMO code. `force` is the preview in Home Settings ('auto' uses the code). */
  function kind(code, force) {
    if (force === 'storm') return 'storm';
    if (force === 'rain') return 'rain';
    if (force === 'snow') return 'snow';
    if (force === 'fog') return 'fog';
    if (force === 'clear' || force === 'night') return 'clear';
    code = code || 0;
    if (code >= 95) return 'storm';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if (code >= 2) return 'cloudy';
    return 'clear';
  }

  /** 0..1 from millimetres in the next hour. A code with no amount yet still shows a light fall. */
  function rate(mm, hasCode) {
    if (mm === null || mm === undefined || isNaN(mm)) return hasCode ? 0.4 : 0;
    if (mm <= 0) return hasCode ? 0.3 : 0;
    if (mm < 0.4) return 0.35;
    if (mm < 1.5) return 0.55;
    if (mm < 4) return 0.75;
    return 1;
  }

  function night(isDay, force) {
    if (force === 'night') return true;
    if (force === 'clear') return false;
    return !isDay;
  }

  var QUALITY = {low: {w: 640, h: 360, n: 70}, medium: {w: 960, h: 540, n: 150}, high: {w: 1280, h: 720, n: 260}};

  var canvas = null, ctx = null, mode = 'off', running = false, skyKey = '', skyGrad = null;
  var cap = 150, viewW = 960, viewH = 540;
  var scene = {kind: 'clear', night: false, rate: 0, wind: 0, dir: 0};
  var flash = 0, bolt = 0, nextBolt = -1, alertText = '', alertAt = 0;
  var boltPts = new Array(9);
  for (i = 0; i < boltPts.length; i++) boltPts[i] = {x: 0, y: 0};
  var audio = null;

  function sizeFor(q) {
    return QUALITY[q] || QUALITY.medium;
  }

  function resize(q) {
    var s = sizeFor(q);
    viewW = s.w;
    viewH = s.h;
    cap = s.n;
    if (canvas) {
      canvas.width = viewW;
      canvas.height = viewH;
    }
    skyKey = '';
  }

  function seedDrop(d) {
    d.x = Math.random() * (viewW + 80) - 40;
    d.y = Math.random() * viewH;
    d.s = 0.55 + Math.random() * 0.9;
    d.len = 8 + Math.random() * 16;
    d.on = 1;
  }

  function sky(kindName, isNight) {
    var key = kindName + (isNight ? 'n' : 'd');
    if (key === skyKey && skyGrad) return skyGrad;
    var g = ctx.createLinearGradient(0, 0, 0, viewH);
    var top, bot;
    if (kindName === 'storm') { top = '#1C2433'; bot = '#0E1218'; }
    else if (kindName === 'rain') { top = isNight ? '#1A2433' : '#6E8498'; bot = isNight ? '#0E141C' : '#C5D0DA'; }
    else if (kindName === 'snow') { top = isNight ? '#1B2430' : '#C9D7E4'; bot = isNight ? '#101820' : '#F4F7FA'; }
    else if (kindName === 'fog') { top = '#B7BFC6'; bot = '#E4E8EC'; }
    else if (kindName === 'cloudy') { top = isNight ? '#1A2230' : '#8EA2B8'; bot = isNight ? '#101820' : '#D5DEE6'; }
    else { top = isNight ? '#070B16' : '#6AADFF'; bot = isNight ? '#1A2744' : '#E7F3FF'; }
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
    skyKey = key;
    skyGrad = g;
    return g;
  }

  /** Wind blows toward dir+180 (the report is where it comes from). The number is a fraction of the fall. */
  function windPush() {
    var kmh = scene.wind || 0;
    var toward = ((scene.dir || 0) + 180) * Math.PI / 180;
    var sway = kmh / 35;
    if (sway > 2.4) sway = 2.4;
    return {x: Math.sin(toward) * sway, y: 1};
  }

  function drawClouds(drift) {
    var n = scene.kind === 'clear' ? 2 : 5, k;
    for (k = 0; k < n; k++) {
      var c = clouds[k];
      if (!c.on) { c.x = Math.random() * viewW; c.y = viewH * (0.08 + 0.18 * k / n); c.r = viewW * (0.08 + k * 0.015); c.s = 0.15 + k * 0.05; c.on = 1; }
      c.x += c.s * (0.35 + drift);
      if (c.x - c.r > viewW) c.x = -c.r;
      ctx.fillStyle = scene.night ? 'rgba(180, 196, 214, 0.18)' : 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, 6.284);
      ctx.arc(c.x + c.r * 0.8, c.y + c.r * 0.15, c.r * 0.7, 0, 6.284);
      ctx.fill();
    }
  }

  function drawClear(t) {
    if (scene.night) {
      var s, st;
      ctx.fillStyle = '#F4F7FF';
      for (s = 0; s < stars.length; s++) {
        st = stars[s];
        ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 700 + st.p));
        ctx.fillRect(st.x * viewW, st.y * viewH, 2, 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#F6F1D8';
      ctx.beginPath();
      ctx.arc(viewW * 0.78, viewH * 0.2, viewW * 0.035, 0, 6.284);
      ctx.fill();
      return;
    }
    ctx.fillStyle = '#FFF6D0';
    ctx.beginPath();
    ctx.arc(viewW * 0.78, viewH * 0.2, viewW * 0.045, 0, 6.284);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 236, 180, 0.45)';
    ctx.lineWidth = 2;
    var ray;
    for (ray = 0; ray < 8; ray++) {
      var a = ray / 8 * 6.284 + t / 8000;
      var r0 = viewW * 0.06, r1 = viewW * 0.09;
      ctx.beginPath();
      ctx.moveTo(viewW * 0.78 + Math.cos(a) * r0, viewH * 0.2 + Math.sin(a) * r0);
      ctx.lineTo(viewW * 0.78 + Math.cos(a) * r1, viewH * 0.2 + Math.sin(a) * r1);
      ctx.stroke();
    }
  }

  function drawFall(wind, snow) {
    var use = Math.round(cap * (0.35 + 0.65 * (scene.rate || 0.4)));
    var push = wind.x;
    var col = snow ? 'rgba(255, 255, 255, 0.92)' : 'rgba(210, 226, 240, 0.8)';
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = snow ? 2 : 1.4;
    var n, d, vy;
    for (n = 0; n < use; n++) {
      d = drops[n];
      if (!d.on) seedDrop(d);
      vy = snow ? 0.6 + d.s * 0.5 : 6 + d.s * 7;
      d.y += vy * (scene.rate > 0 ? 0.65 + scene.rate : 1);
      d.x += push * (snow ? 1.4 : vy * 0.35) + (snow ? Math.sin(d.y / 18 + n) * 0.4 : 0);
      if (d.y > viewH + 8) { d.y = -20; d.x = Math.random() * (viewW + 80) - 40; }
      if (d.x > viewW + 40) d.x = -20;
      if (d.x < -40) d.x = viewW + 20;
      if (snow) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, 1.2 + d.s, 0, 6.284);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - push * d.len * 0.45, d.y - d.len);
        ctx.stroke();
      }
    }
    if (snow) return;
    // A few streaks that sit on the glass instead of falling with the rest.
    for (n = 0; n < streaks.length; n++) {
      var st = streaks[n];
      if (!st.on) {
        if (Math.random() > 0.02) continue;
        st.x = Math.random() * viewW;
        st.y = Math.random() * viewH * 0.7;
        st.len = 30 + Math.random() * 50;
        st.a = 0.35;
        st.on = 1;
      }
      st.y += 0.8 + push * 0.2;
      st.a -= 0.004;
      if (st.a <= 0 || st.y > viewH) { st.on = 0; continue; }
      ctx.globalAlpha = st.a;
      ctx.beginPath();
      ctx.moveTo(st.x, st.y);
      ctx.lineTo(st.x - push * 6, st.y + st.len);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function strike() {
    flash = 6;
    bolt = 16;
    var x = viewW * (0.25 + Math.random() * 0.5), s;
    for (s = 0; s < boltPts.length; s++) {
      boltPts[s].x = x;
      boltPts[s].y = viewH * s / (boltPts.length - 1);
      x += (Math.random() - 0.42) * viewW * 0.07;
    }
    if (scene.kind !== 'storm') return;
    try {
      if (typeof Prefs === 'undefined' || !Prefs.liveSound || !Prefs.liveSound()) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === 'suspended' && audio.resume) audio.resume();
      var o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sawtooth';
      o.frequency.value = 48 + Math.random() * 20;
      g.gain.setValueAtTime(0.045, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.7);
      o.connect(g);
      g.connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + 0.7);
    } catch (e) {}
  }

  function drawBolt() {
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (flash > 3 ? 0.72 : 0.18) + ')';
      ctx.fillRect(0, 0, viewW, viewH);
      flash--;
    }
    if (bolt <= 0) return;
    ctx.beginPath();
    ctx.moveTo(boltPts[0].x, boltPts[0].y);
    var step;
    for (step = 1; step < boltPts.length; step++) ctx.lineTo(boltPts[step].x, boltPts[step].y);
    ctx.strokeStyle = 'rgba(255, 255, 255, ' + Math.min(1, bolt / 8) + ')';
    ctx.lineWidth = 3;
    ctx.stroke();
    bolt--;
  }

  function frame(t) {
    if (!running || !ctx) return;
    if (typeof document !== 'undefined' && document.hidden) {
      running = false;
      return;
    }
    var overlay = mode === 'overlay';
    ctx.clearRect(0, 0, viewW, viewH);
    if (!overlay) {
      ctx.fillStyle = sky(scene.kind, scene.night);
      ctx.fillRect(0, 0, viewW, viewH);
    }
    var wind = windPush();
    if (scene.kind === 'clear') drawClear(t);
    if (scene.kind === 'cloudy' || scene.kind === 'rain' || scene.kind === 'storm') drawClouds(Math.abs(wind.x));
    if (scene.kind === 'fog') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.fillRect(0, viewH * 0.35, viewW, viewH * 0.65);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(0, viewH * 0.15, viewW, viewH * 0.4);
    }
    if (scene.kind === 'rain' || scene.kind === 'storm') drawFall(wind, false);
    if (scene.kind === 'snow') drawFall(wind, true);
    if (scene.kind === 'storm') {
      if (nextBolt < 0) nextBolt = t + 2500 + Math.random() * 5000;
      if (t > nextBolt) { strike(); nextBolt = t + (scene.rate > 0.6 ? 1800 : 4200) + Math.random() * 4000; }
      drawBolt();
    }
    var again = window.requestAnimationFrame || function (fn) { return setTimeout(function () { fn(Date.now()); }, 32); };
    again(frame);
  }

  function applyScene(next) {
    var changed = !scene || scene.kind !== next.kind || scene.night !== next.night;
    scene = next;
    if (changed) {
      skyKey = '';
      var n;
      for (n = 0; n < clouds.length; n++) clouds[n].on = 0;
      for (n = 0; n < streaks.length; n++) streaks[n].on = 0;
    }
  }

  function loopStart() {
    if (running) return;
    running = true;
    var again = window.requestAnimationFrame || function (fn) { return setTimeout(function () { fn(Date.now()); }, 32); };
    again(frame);
  }

  /**
   * 'full' is the Live weather screensaver (a sky of its own). 'overlay' is drops and clouds only, over whatever
   * is already on screen. 'off' stops the frames.
   */
  function setMode(next, quality) {
    if (!canvas) { mode = next; return; }
    if (next === 'off') {
      mode = 'off';
      running = false;
      canvas.className = 'layer';
      return;
    }
    var spec = sizeFor(quality || 'medium');
    if (canvas.width !== spec.w) resize(quality || 'medium');
    mode = next === 'glass' ? 'overlay' : next;
    canvas.className = 'layer on ' + next;
    loopStart();
  }

  function boot(node) {
    canvas = node;
    if (canvas && canvas.getContext) ctx = canvas.getContext('2d');
  }

  function considerAlert(text) { alertText = text || ''; }

  function alert() { return alertText; }

  /** Ask api.weather.gov when the animation is up. An empty list, or a TV that can't reach it, changes nothing else. */
  function refreshAlert(lat, lon) {
    var now = Date.now();
    if (now - alertAt < 5 * 60000) return;
    alertAt = now;
    if (!lat || !lon || typeof XMLHttpRequest === 'undefined') return;
    var x = new XMLHttpRequest();
    var over = false;
    x.open('GET', 'https://api.weather.gov/alerts/active?point=' + lat + ',' + lon, true);
    x.timeout = 8000;
    try { x.setRequestHeader('Accept', 'application/geo+json'); } catch (e) {}
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status !== 200) return;
      var body, features, best = '', rank = 0, i, p, r;
      try { body = JSON.parse(x.responseText); } catch (e2) { return; }
      features = body && body.features || [];
      for (i = 0; i < features.length; i++) {
        p = features[i].properties || {};
        if (p.status && p.status !== 'Actual') continue;
        r = p.severity === 'Extreme' ? 4 : p.severity === 'Severe' ? 3 : p.severity === 'Moderate' ? 2 : 0;
        if (r > rank && p.event) { rank = r; best = String(p.event); }
      }
      alertText = best;
    };
    x.ontimeout = x.onerror = function () { over = true; };
    try { x.send(); } catch (e3) {}
  }

  return {
    kind: kind,
    rate: rate,
    night: night,
    boot: boot,
    setMode: setMode,
    mode: function () { return mode; },
    scene: function (next) { if (next) applyScene(next); return scene; },
    alert: alert,
    noteAlert: considerAlert,
    refreshAlert: refreshAlert,
    wake: loopStart,
    /** The next frame strikes. The preview uses it so a still can catch the flash. */
    strikeSoon: function () { nextBolt = 0; }
  };
})();
