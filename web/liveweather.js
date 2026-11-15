/*
 * Live weather for the screensaver, a quiet layer over photos, and the home-screen row.
 * One full-screen shader (WebGL) draws the sky, clouds, rain, snow and fog. A 2D canvas is the fallback where WebGL
 * is missing. The picture stays small (Medium is 960×540, scaled up) and, if frames start taking too long, the
 * quality drops by itself. Lightning is a branched bolt plus a flash that lights the clouds; thunder, if sound is
 * on, follows after a short random wait, the way a distant strike does.
 * Numbers come from the forecast the app already keeps. Radar (RainViewer) wins when it shows rain,
 * then a fresh station observation, then the model. A US severe alert is read from api.weather.gov.
 */
var LiveWeather = (function () {
  'use strict';

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
    if (force === 'clear' || force === 'fog') return false;
    return !isDay;
  }

  /** 0 is new, 0.5 is full. Counted from the new moon of 6 Jan 2000. */
  function moonPhase(ms) {
    var syn = 29.53058867 * 86400000;
    var t = ((ms - Date.UTC(2000, 0, 6, 18, 14)) % syn + syn) % syn;
    return t / syn;
  }

  var QUALITY = {low: {w: 640, h: 360, glass: 0}, medium: {w: 960, h: 540, glass: 1}, high: {w: 1280, h: 720, glass: 1}};
  var KINDN = {clear: 0, cloudy: 1, fog: 2, rain: 3, snow: 4, storm: 5};

  var FS = [
    'precision mediump float;',
    'uniform float uTime, uDrift, uElev, uCover, uRate, uWind, uMove, uFlash, uKind, uNight, uMoon, uLite;',
    'uniform vec2 uBolt;',
    'varying vec2 vUv;',
    'float hash(vec2 p){',
    '  p = fract(p * vec2(0.1031, 0.1030));',
    '  p += dot(p, p.yx + 19.19);',
    '  return fract(p.x * p.y);',
    '}',
    'float noise(vec2 p){',
    '  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash(i); float b = hash(i + vec2(1.0, 0.0));',
    '  float c = hash(i + vec2(0.0, 1.0)); float d = hash(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v = 0.0; float a = 0.5;',
    '  v += a * noise(p); p *= 2.02; a *= 0.5;',
    '  v += a * noise(p); p *= 2.03; a *= 0.5;',
    '  v += a * noise(p);',
    '  return v;',
    '}',
    'float rainLayer(vec2 uv, float columns, float speed, float len, float width, float seed){',
    '  vec2 q = uv;',
    '  q.x += q.y * uWind * 0.38;',
    '  float col = q.x * columns;',
    '  float id = floor(col);',
    '  float h = hash(vec2(id, seed));',
    '  float fx = fract(col) - 0.5 + (h - 0.5) * 0.9;',
    '  float head = fract(h * 5.3 - uTime * speed);',
    '  float dy = fract(q.y - head);',
    '  float along = smoothstep(0.0, len * 0.06, dy) * (1.0 - smoothstep(len * 0.55, len, dy));',
    '  float w = smoothstep(width, 0.0, abs(fx));',
    '  float core = smoothstep(width * 0.22, 0.0, abs(fx));',
    '  float show = smoothstep(0.12, 0.48, h * (0.2 + uRate));',
    '  return (w * 0.5 + core * 0.75) * along * show;',
    '}',
    'float snowLayer(vec2 uv, float scale, float speed, float soft){',
    '  vec2 p = vec2(uv.x * scale + sin(uDrift * 6.28318 + uv.y * 6.0) * 0.08 + uWind * uDrift, uv.y * scale + uDrift * speed * 16.0);',
    '  vec2 id = floor(p); vec2 f = fract(p) - 0.5;',
    '  float h = hash(id);',
    '  f.x += (h - 0.5) * 0.55;',
    '  f.y += (fract(h * 17.0) - 0.5) * 0.35;',
    '  float rad = mix(0.06, 0.2, h);',
    '  return smoothstep(rad, rad - soft, length(f * vec2(1.78, 1.0))) * step(0.86, h);',
    '}',
    'void main(){',
    '  vec2 uv = vUv;',
    '  float elev = uElev;',
    '  float day = smoothstep(-0.05, 0.25, elev);',
    '  float golden = smoothstep(0.0, 0.18, elev) * (1.0 - smoothstep(0.18, 0.45, elev));',
    '  vec3 zenithDay = vec3(0.28, 0.50, 0.86);',
    '  vec3 horizonDay = mix(vec3(0.55, 0.72, 0.90), vec3(0.98, 0.62, 0.32), golden);',
    '  vec3 zenithNight = vec3(0.015, 0.02, 0.06);',
    '  vec3 horizonNight = vec3(0.08, 0.09, 0.16);',
    '  vec3 zenith = mix(zenithNight, zenithDay, day);',
    '  vec3 horizon = mix(horizonNight, horizonDay, day);',
    '  if (uKind > 4.5) { zenith = vec3(0.008, 0.01, 0.026); horizon = vec3(0.06, 0.055, 0.1); }',
    '  else if (uKind > 2.5) { zenith = mix(zenith, vec3(0.16, 0.2, 0.26), 0.62); horizon = mix(horizon, vec3(0.32, 0.36, 0.4), 0.5); }',
    '  float gy = pow(clamp(uv.y, 0.0, 1.0), 0.65);',
    '  vec3 col = mix(horizon, zenith, gy);',
    '  vec2 sunP = vec2(0.72 + sin(uDrift * 6.28318) * 0.02, 0.12 + elev * 0.55);',
    '  vec2 asp = vec2(1.78, 1.0);',
    '  float sd = length((uv - sunP) * asp);',
    '  if (day > 0.2 && uKind < 2.5) {',
    '    col += vec3(1.0, 0.95, 0.8) * exp(-sd * 22.0) * 0.9;',
    '    col += vec3(1.0, 0.85, 0.55) * exp(-sd * 6.0) * 0.35 * day;',
    '  }',
    '  if (uNight > 0.55 && uCover < 0.4) {',
    '    vec2 sp = uv * vec2(120.0, 68.0);',
    '    vec2 sf = fract(sp) - 0.5;',
    '    float sh = hash(floor(sp));',
    '    float tw = 0.55 + 0.45 * sin(uTime * 6.28318 + sh * 6.28318);',
    '    float star = smoothstep(0.08, 0.0, length(sf)) * step(0.992, sh);',
    '    col += vec3(0.9, 0.93, 1.0) * star * tw * uNight;',
    '    vec2 mc = (uv - vec2(0.78, 0.78)) * asp;',
    '    float disk = smoothstep(0.055, 0.045, length(mc));',
    '    float ang = uMoon * 6.28318;',
    '    vec2 sc = mc - vec2(cos(ang) * 0.05, 0.0);',
    '    float shadow = smoothstep(0.055, 0.042, length(sc));',
    '    float moon = disk * (1.0 - shadow);',
    '    col += vec3(0.95, 0.94, 0.86) * moon;',
    '    col += vec3(0.7, 0.75, 0.9) * exp(-length(mc) * 10.0) * 0.25 * disk;',
    '  }',
    '  vec2 cuv = uv * vec2(1.7, 1.05);',
    '  vec2 farC = cuv + vec2(uDrift, 0.0);',
    '  vec2 nearC = cuv + vec2(fract(uDrift * 1.35), 0.0);',
    '  float n1 = fbm(farC * 1.15);',
    '  float n2 = fbm(nearC * 2.15 + vec2(n1 * 0.55, uDrift));',
    '  float fine = uLite > 0.5 ? 0.0 : noise(nearC * 4.2 + vec2(uDrift, n1));',
    '  float field = n1 * 0.55 + n2 * 0.45 + fine * 0.12;',
    '  float edge = mix(0.58, 0.33, uCover);',
    '  float band = uKind > 4.5 ? 0.055 : 0.12;',
    '  float clouds = smoothstep(edge, edge + band, field);',
    '  float lit = smoothstep(edge + band * 0.15, edge + 0.36, field);',
    '  float under = smoothstep(0.8, 0.2, uv.y) * (1.0 - lit);',
    '  vec3 cloudCol = mix(vec3(0.18, 0.2, 0.24), vec3(0.94, 0.95, 0.97), lit * (0.28 + 0.72 * day));',
    '  cloudCol = mix(cloudCol, cloudCol * vec3(0.42, 0.46, 0.52), clamp(under, 0.0, 0.72));',
    '  cloudCol = mix(cloudCol, vec3(1.0, 0.72, 0.42), golden * lit * 0.45);',
    '  if (uKind > 4.5) {',
    '    cloudCol = mix(vec3(0.01, 0.012, 0.02), vec3(0.2, 0.23, 0.3), lit);',
    '    cloudCol = mix(cloudCol, vec3(0.004, 0.005, 0.008), clamp(under, 0.0, 0.82));',
    '  }',
    '  float dLight = length((uv - uBolt) * vec2(0.9, 1.05));',
    '  float glow = exp(-dLight * 1.15) * uFlash;',
    '  float body = smoothstep(edge - 0.02, edge + 0.22, field);',
    '  if (uKind > 4.5) cloudCol += vec3(0.62, 0.7, 0.95) * glow * body * 1.15;',
    '  col = mix(col, cloudCol, clouds * (0.64 + 0.36 * uCover));',
    '  if (uKind > 1.5 && uKind < 2.5) {',
    '    col = mix(col, vec3(0.55, 0.58, 0.62), 0.62);',
    '    float fog = fbm(uv * vec2(1.3, 0.4) + vec2(uDrift, 0.0));',
    '    fog = smoothstep(0.28, 0.75, fog) * (0.55 + (1.0 - uv.y) * 0.45);',
    '    if (uLite < 0.5) {',
    '      float fog2 = fbm(uv * vec2(2.4, 0.8) + vec2(uDrift, 3.0));',
    '      fog = max(fog, smoothstep(0.4, 0.85, fog2) * (1.0 - uv.y * 0.35) * 0.75);',
    '    }',
    '    col = mix(col, vec3(0.78, 0.80, 0.83), clamp(fog, 0.0, 0.92));',
    '  }',
    '  if ((uKind > 2.5 && uKind < 3.5) || uKind > 4.5) {',
    '    float far = rainLayer(uv, 40.0, 1.0, 0.72, 0.045, 1.3) * 0.1;',
    '    float mid = 0.0;',
    '    if (uLite < 0.5) mid = rainLayer(uv + vec2(0.37, 0.2), 22.0, 2.0, 0.8, 0.03, 4.4) * 0.12;',
    '    col += vec3(0.72, 0.8, 0.88) * (far + mid);',
    '  }',
    '  if (uKind > 3.5 && uKind < 4.5) {',
    '    float s = 0.0;',
    '    s += snowLayer(uv, 10.0, 0.08, 0.08) * 0.45;',
    '    s += snowLayer(uv + vec2(0.3), 18.0, 0.14, 0.04) * 0.7;',
    '    s += snowLayer(uv + vec2(0.6), 30.0, 0.22, 0.015) * 0.9;',
    '    col += vec3(0.95, 0.97, 1.0) * s;',
    '  }',
    '  col = pow(max(col, 0.0), vec3(0.92));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var GLASS = [
    'precision mediump float;',
    'uniform sampler2D uScene;',
    'uniform float uTime, uRate;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 uv = vUv;',
    '  vec2 asp = vec2(1.78, 1.0);',
    '  vec2 off = vec2(0.0);',
    '  vec2 p1 = vec2(0.23, fract(0.92 - uTime * 0.008));',
    '  vec2 p2 = vec2(0.71, fract(0.4 - uTime * 0.006));',
    '  vec2 d1 = (uv - p1) * asp; d1.y *= 0.62;',
    '  vec2 d2 = (uv - p2) * asp; d2.y *= 0.62;',
    '  float r1 = length(d1); float r2 = length(d2);',
    '  if (r1 < 0.012) off += d1 * 0.08;',
    '  if (r2 < 0.009) off += d2 * 0.07;',
    '  vec3 col = texture2D(uScene, clamp(uv + off, 0.0, 1.0)).rgb;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var VS = 'attribute vec2 a; varying vec2 vUv; void main(){ vUv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }';

  var DROP_VS = [
    'attribute vec2 a;',
    'uniform vec4 uRect;',
    'varying vec2 vUv;',
    'varying vec2 vLocal;',
    'void main(){',
    '  vec2 p = a * 0.5 + 0.5;',
    '  vLocal = p;',
    '  vUv = vec2(uRect.x + p.x * uRect.z, uRect.y + p.y * uRect.w);',
    '  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var DROP_FS = [
    'precision mediump float;',
    'uniform sampler2D uBg;',
    'uniform sampler2D uSprite;',
    'varying vec2 vUv;',
    'varying vec2 vLocal;',
    'void main(){',
    '  vec4 sp = texture2D(uSprite, vLocal);',
    '  if (sp.a < 0.08) discard;',
    '  vec2 n = sp.rg * 2.0 - 1.0;',
    '  vec3 col = texture2D(uBg, clamp(vUv + n * 0.02 * sp.a, 0.0, 1.0)).rgb;',
    '  col += vec3(0.55, 0.6, 0.66) * sp.b * sp.a;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var COPY_FS = [
    'precision mediump float;',
    'uniform sampler2D uBg;',
    'varying vec2 vUv;',
    'void main(){ gl_FragColor = texture2D(uBg, vUv); }'
  ].join('\n');

  var canvas = null, boltCanvas = null, boltCtx = null, gl = null, ctx = null, prog = null, glassProg = null, quad = null;
  var dropProg = null, copyProg = null, sceneTex = null, blurTex = null, spriteTex = null, dropLocs = null, copyLocs = null;
  var blurAt = 0, blurKey = '';
  var target = null, mode = 'off', running = false, quality = 'medium', forcedQ = '';
  var scene = {kind: 'clear', night: false, rate: 0, wind: 0, dir: 0};
  var locs = null, glassLocs = null;
  var nextBolt = -1, flash = 0, bolt = 0, thunderAt = 0, alertText = '', alertSevere = '', alertAt = 0;
  var skyAt = 0, lastSky = null, skyBusy = false, paused = false, boltSeen = false, drawn = 0, anim = 0, lastDt = 0.034;
  var inits = 0, gapMax = 0, gapSince = 0, gapClock = 0, holdUntil = 0, shownFade = 1, drawnAt = 0;
  var passSec = 0, passDrift = 0, passWind = 0, passFlash = 0, passMove = 0, passLite = 0, elevCache = 0, elevAt = 0;
  var audio = null, nbuf = null;
  var frameAcc = 0, frameN = 0, frameLast = 0;
  var boltPts = new Array(33);
  var branchPts = [], branchLen = [0, 0, 0, 0, 0], branchSpan = [5, 9, 5, 9, 5];
  var bi, bk;
  for (bi = 0; bi < boltPts.length; bi++) boltPts[bi] = {x: 0, y: 0};
  for (bk = 0; bk < 5; bk++) {
    branchPts[bk] = new Array(9);
    for (bi = 0; bi < 9; bi++) branchPts[bk][bi] = {x: 0, y: 0};
  }
    var flickerAt = [0, 0, 0, 0], flickerN = 0, flickerI = 0, showBolt = 0, boltLife = 0, boltAlpha = 0;
  var boltUv = [0.5, 0.72];

  /** 0 is calm, 1 is hurricane. Open-Meteo wind is km/h. A severe alert counts as a hard storm. */
  function drive() {
    var kmh = Math.abs(scene.wind || 0);
    var v = kmh / 130;
    if (alertText) v = Math.max(v, 0.8);
    if (v > 1) v = 1;
    return v;
  }

  function sizeFor(q) { return QUALITY[q] || QUALITY.medium; }

  function coverOf(k) {
    if (k === 'storm') return 0.96;
    if (k === 'rain') return 0.88;
    if (k === 'snow') return 0.72;
    if (k === 'fog') return 0.55;
    if (k === 'cloudy') return 0.78;
    return 0.18;
  }

  function elevNow() {
    var now = Date.now();
    if (elevAt && now - elevAt < 60000) return elevCache;
    elevAt = now;
    if (scene.night) { elevCache = -0.16; return elevCache; }
    var d = new Date(now);
    var h = d.getHours() + d.getMinutes() / 60;
    // "Clear" in the preview is a daytime sky, even when the clock is still before dawn.
    if (typeof Prefs !== 'undefined' && Prefs.liveForce) {
      var force = Prefs.liveForce();
      if (force === 'clear') h = 15.5;
      else if (force === 'fog') h = 9.5;
    }
    var x = (h - 6.2) / 13.2;
    elevCache = (x <= 0 || x >= 1) ? -0.05 : Math.sin(x * Math.PI);
    return elevCache;
  }

  function note(msg) {
    try { console.log('FreeMyTV weather: ' + msg); } catch (e) {}
  }

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = '';
      try { log = gl.getShaderInfoLog(sh) || ''; } catch (e) {}
      note('compile ' + (type === gl.FRAGMENT_SHADER ? 'fragment' : 'vertex') + ' ' + String(log).slice(0, 180));
      return null;
    }
    return sh;
  }

  function fragmentSource() {
    var body = FS.replace(/^precision mediump float;\n/, '');
    var prec = 'precision mediump float;\n';
    try {
      var fmt = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (fmt && fmt.precision > 0) prec = 'precision highp float;\n';
    } catch (e) {}
    return prec + body;
  }

  function program(fs, vsSrc) {
    var p = gl.createProgram();
    var vs = compile(gl.VERTEX_SHADER, vsSrc || VS);
    var fsh = compile(gl.FRAGMENT_SHADER, fs);
    if (!vs || !fsh) return null;
    gl.attachShader(p, vs);
    gl.attachShader(p, fsh);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fsh);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      var log = '';
      try { log = gl.getProgramInfoLog(p) || ''; } catch (e2) {}
      note('link ' + String(log).slice(0, 180));
      gl.deleteProgram(p);
      return null;
    }
    return p;
  }

  function makeTarget(w, h) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return ok ? {tex: tex, fb: fb, w: w, h: h} : null;
  }

  function loseGL() {
    gl = null;
    prog = null;
    glassProg = null;
    dropProg = null;
    copyProg = null;
    sceneTex = null;
    target = null;
    if (!canvas || !canvas.parentNode || typeof document === 'undefined') return;
    // A canvas that already has a WebGL context cannot take a 2D one. Swap the element.
    var fresh = canvas.cloneNode(false);
    canvas.parentNode.replaceChild(fresh, canvas);
    canvas = fresh;
    try { ctx = fresh.getContext('2d'); } catch (e) { ctx = null; }
  }

  function releaseGL() {
    if (!gl) return;
    function kill(p) {
      if (!p) return;
      try { gl.deleteProgram(p); } catch (e) {}
    }
    kill(prog);
    kill(copyProg);
    kill(dropProg);
    kill(glassProg);
    if (sceneTex) {
      try { gl.deleteTexture(sceneTex.tex); gl.deleteFramebuffer(sceneTex.fb); } catch (e2) {}
    }
    if (blurTex) {
      try { gl.deleteTexture(blurTex.tex); gl.deleteFramebuffer(blurTex.fb); } catch (e3) {}
    }
    if (spriteTex) {
      try { gl.deleteTexture(spriteTex); } catch (e4) {}
    }
    prog = null;
    copyProg = null;
    dropProg = null;
    glassProg = null;
    sceneTex = null;
    blurTex = null;
    spriteTex = null;
    target = null;
  }

  function watchContext() {
    if (!canvas || canvas._glWatch) return;
    canvas._glWatch = 1;
    canvas.addEventListener('webglcontextlost', function (ev) {
      if (ev.preventDefault) ev.preventDefault();
      gl = null;
      prog = null;
      copyProg = null;
      dropProg = null;
      sceneTex = null;
      blurTex = null;
      spriteTex = null;
      running = false;
      note('context lost');
    }, false);
    canvas.addEventListener('webglcontextrestored', function () {
      note('context restored');
      gl = null;
      prog = null;
      copyProg = null;
      dropProg = null;
      sceneTex = null;
      blurTex = null;
      spriteTex = null;
      if (mode === 'off') return;
      var use = (mode === 'overlay' || mode === 'row') ? 'low' : (forcedQ || quality);
      if (initGL(use)) loopStart();
    }, false);
  }

  function initGL(q) {
    if (!canvas) return false;
    watchContext();
    var spec = sizeFor(q);
    if (gl && prog && canvas.width === spec.w && canvas.height === spec.h && blurTex && spriteTex) return true;
    if (canvas.width !== spec.w || canvas.height !== spec.h) {
      releaseGL();
      canvas.width = spec.w;
      canvas.height = spec.h;
      gl = null;
    }
    if (!gl) {
      // alpha:false: Tizen 6 drops a transparent WebGL canvas, so Home weather never covered the poster.
      try {
        gl = canvas.getContext('webgl', {alpha: false, antialias: false, premultipliedAlpha: false})
          || canvas.getContext('experimental-webgl', {alpha: false, antialias: false, premultipliedAlpha: false});
      } catch (e) { gl = null; }
      if (!gl) { note('no WebGL'); return false; }
      prog = program(fragmentSource());
      copyProg = program(COPY_FS);
      dropProg = program(DROP_FS, DROP_VS);
      if (!prog) { note('shader failed, using canvas'); loseGL(); return false; }
      inits++;
      quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      locs = {
        a: gl.getAttribLocation(prog, 'a'),
        time: gl.getUniformLocation(prog, 'uTime'),
        drift: gl.getUniformLocation(prog, 'uDrift'),
        elev: gl.getUniformLocation(prog, 'uElev'),
        cover: gl.getUniformLocation(prog, 'uCover'),
        rate: gl.getUniformLocation(prog, 'uRate'),
        wind: gl.getUniformLocation(prog, 'uWind'),
        move: gl.getUniformLocation(prog, 'uMove'),
        flash: gl.getUniformLocation(prog, 'uFlash'),
        kind: gl.getUniformLocation(prog, 'uKind'),
        night: gl.getUniformLocation(prog, 'uNight'),
        moon: gl.getUniformLocation(prog, 'uMoon'),
        lite: gl.getUniformLocation(prog, 'uLite'),
        bolt: gl.getUniformLocation(prog, 'uBolt')
      };
      if (copyProg) {
        copyLocs = {a: gl.getAttribLocation(copyProg, 'a'), bg: gl.getUniformLocation(copyProg, 'uBg')};
      }
      if (dropProg) {
        dropLocs = {
          a: gl.getAttribLocation(dropProg, 'a'),
          bg: gl.getUniformLocation(dropProg, 'uBg'),
          sprite: gl.getUniformLocation(dropProg, 'uSprite'),
          rect: gl.getUniformLocation(dropProg, 'uRect')
        };
      }
      note('gl ready ' + spec.w + 'x' + spec.h);
    }
    if (!blurTex) blurTex = makeTarget(320, 180);
    if (!spriteTex) spriteTex = makeSprite();
    blurKey = '';
    return true;
  }

  /** One small drop, uploaded once. Red and green are the surface normal, blue is the highlight. */
  function makeSprite() {
    var n = 48, data = new Uint8Array(n * n * 4), x, y, dx, dy, dist, a, nx, ny, hi, i;
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++) {
        dx = (x + 0.5) / n * 2 - 1;
        dy = (y + 0.5) / n * 2 - 1;
        dist = Math.sqrt(dx * dx + dy * dy);
        a = dist < 1 ? 1 - dist : 0;
        nx = 0.5;
        ny = 0.5;
        hi = 0;
        if (dist < 1) {
          nx = dx * 0.45 + 0.5;
          ny = dy * 0.45 + 0.5;
          if (dist < 0.42) hi = 1 - dist / 0.42;
        }
        i = (y * n + x) * 4;
        data[i] = (nx * 255) | 0;
        data[i + 1] = (ny * 255) | 0;
        data[i + 2] = (hi * 255) | 0;
        data[i + 3] = (a * 255) | 0;
      }
    }
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var t0 = Date.now();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (typeof Pace !== 'undefined') Pace.note('sprite-upload', Date.now() - t0);
    return tex;
  }

  function jag(pts, count, spread) {
    var step = count - 1, pass, j, half, left, right, mx, my, mag;
    for (pass = 0; step > 1; pass++) {
      half = step / 2;
      for (j = half; j < count - 1; j += step) {
        left = j - half;
        right = j + half;
        if (right >= count) right = count - 1;
        mx = (pts[left].x + pts[right].x) / 2;
        my = (pts[left].y + pts[right].y) / 2;
        mag = spread / Math.pow(2.05, pass);
        if (mag < 1.6) mag = 1.6;
        pts[j].x = mx + (Math.random() - 0.5) * mag;
        pts[j].y = my + (Math.random() - 0.5) * mag * 0.55;
      }
      step = half;
    }
  }

  function displaceBolt() {
    var w = canvas.width, h = canvas.height, b, from, pts, dir, span, reach, origins;
    boltPts[0].x = w * (0.22 + Math.random() * 0.56);
    boltPts[0].y = h * (0.06 + Math.random() * 0.16);
    boltPts[boltPts.length - 1].x = boltPts[0].x + (Math.random() - 0.5) * w * 0.22;
    boltPts[boltPts.length - 1].y = h * (0.32 + Math.random() * 0.22);
    jag(boltPts, boltPts.length, w * 0.16);
    origins = [5, 10, 14, 18, 24];
    for (b = 0; b < 5; b++) {
      if (Math.random() < 0.45) { branchLen[b] = 0; continue; }
      from = origins[b];
      pts = branchPts[b];
      span = branchSpan[b];
      pts[0].x = boltPts[from].x;
      pts[0].y = boltPts[from].y;
      dir = Math.random() < 0.5 ? -1 : 1;
      reach = span === 5 ? 0.55 : 1;
      pts[span - 1].x = pts[0].x + dir * w * (0.025 + Math.random() * 0.07) * reach;
      pts[span - 1].y = pts[0].y + h * (0.02 + Math.random() * 0.09) * reach;
      jag(pts, span, w * (span === 5 ? 0.035 : 0.06));
      branchLen[b] = span;
    }
  }

  function strokeBolt(pts, count, glowW, coreW, alpha, fade) {
    var s, t, a;
    for (s = 1; s < count; s++) {
      t = s / (count - 1);
      a = alpha * (1 - t * fade);
      if (a < 0.04) continue;
      boltCtx.beginPath();
      boltCtx.moveTo(pts[s - 1].x, pts[s - 1].y);
      boltCtx.lineTo(pts[s].x, pts[s].y);
      boltCtx.strokeStyle = 'rgba(150,185,255,' + (0.2 * a) + ')';
      boltCtx.lineWidth = glowW * (1 - t * 0.6);
      boltCtx.stroke();
      boltCtx.strokeStyle = 'rgba(225,235,255,' + (0.4 * a) + ')';
      boltCtx.lineWidth = Math.max(0.8, glowW * 0.34 * (1 - t * 0.75));
      boltCtx.stroke();
      boltCtx.strokeStyle = 'rgba(255,255,255,' + Math.min(1, a) + ')';
      boltCtx.lineWidth = Math.max(0.6, coreW * (1 - t * 0.82));
      boltCtx.stroke();
    }
  }

  function paintBeadsBolt() {
    var n = glassCount(), i, b, x, y, rad;
    if (!boltCtx || !n) return;
    for (i = 0; i < n; i++) {
      b = beads[i];
      if (!b.on) continue;
      x = b.x * boltCanvas.width;
      y = b.y * boltCanvas.height;
      rad = b.r * boltCanvas.height;
      if (rad < 7) rad = 7;
      boltCtx.beginPath();
      boltCtx.arc(x, y, rad, 0, 6.28318);
      if (!dropProg) {
        boltCtx.fillStyle = 'rgba(214,226,236,0.55)';
        boltCtx.fill();
      }
      boltCtx.strokeStyle = 'rgba(255,255,255,0.9)';
      boltCtx.lineWidth = 2;
      boltCtx.stroke();
      if (b.trail > 0.02) {
        boltCtx.strokeStyle = 'rgba(220,230,238,0.45)';
        boltCtx.lineWidth = Math.max(1, rad * 0.35);
        boltCtx.beginPath();
        boltCtx.moveTo(x, y - b.trail * boltCanvas.height);
        boltCtx.lineTo(x, y - rad);
        boltCtx.stroke();
      }
    }
  }

  function drawBolt2d(keep) {
    if (!boltCtx) return;
    var alpha, b;
    if (!keep) boltCtx.clearRect(0, 0, boltCanvas.width, boltCanvas.height);
    if (!showBolt || boltLife <= 0 || boltAlpha < 0.04) return;
    alpha = boltAlpha;
    boltCtx.save();
    boltCtx.globalCompositeOperation = 'lighter';
    boltCtx.lineJoin = 'round';
    boltCtx.lineCap = 'round';
    strokeBolt(boltPts, boltPts.length, 3.2, 0.7, alpha, 0.72);
    for (b = 0; b < 5; b++) {
      if (!branchLen[b]) continue;
      strokeBolt(branchPts[b], branchLen[b], 1.6, 0.45, alpha * 0.55, 0.95);
    }
    boltCtx.restore();
  }

  function noiseBuffer() {
    if (nbuf || !audio) return nbuf;
    var len = Math.floor(audio.sampleRate * 1.6);
    nbuf = audio.createBuffer(1, len, audio.sampleRate);
    var data = nbuf.getChannelData(0), n;
    for (n = 0; n < len; n++) data[n] = Math.random() * 2 - 1;
    return nbuf;
  }

  function rumble(layer) {
    try {
      if (typeof Prefs === 'undefined' || !Prefs.liveSound || !Prefs.liveSound()) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === 'suspended' && audio.resume) audio.resume();
      var src = audio.createBufferSource();
      src.buffer = noiseBuffer();
      var filter = audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = layer ? 180 : 320;
      var g = audio.createGain();
      var now = audio.currentTime;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(layer ? 0.03 : 0.05, now + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, now + (layer ? 1.4 : 1.1));
      src.connect(filter);
      filter.connect(g);
      g.connect(audio.destination);
      src.start();
      src.stop(now + 1.6);
    } catch (e) {}
  }

  var preferSheet = 0;

  function strike() {
    var sheet = preferSheet || Math.random() < 0.86;
    var wall = Date.now(), i, t, at;
    preferSheet = 0;
    displaceBolt();
    showBolt = sheet ? 0 : 1;
    flash = sheet ? (0.12 + Math.random() * 0.08 + drive() * 0.12) : (0.1 + Math.random() * 0.06);
    if (sheet) {
      boltUv[0] = 0.18 + Math.random() * 0.64;
      boltUv[1] = 0.55 + Math.random() * 0.32;
      boltLife = 0;
      boltAlpha = 0;
    } else {
      at = 6 + Math.floor(Math.random() * 8);
      boltUv[0] = boltPts[at].x / canvas.width;
      boltUv[1] = 1 - boltPts[at].y / canvas.height;
      boltLife = 8 + Math.floor(Math.random() * 5);
      boltAlpha = 0.32 + Math.random() * 0.16;
    }
    flickerN = drive() > 0.6 ? (3 + Math.floor(Math.random() * 2)) : 2;
    flickerI = 0;
    t = wall + 60 + Math.random() * 140;
    for (i = 0; i < flickerN; i++) {
      flickerAt[i] = t;
      t += 35 + Math.random() * 240;
    }
    thunderAt = wall + (sheet ? 900 + Math.random() * 2400 : 400 + Math.random() * 1600);
  }

  var BEAD_N = 24;
  var beads = new Array(BEAD_N);
  var beadI;
  for (beadI = 0; beadI < BEAD_N; beadI++) {
    beads[beadI] = {x: 0, y: 0, r: 0.012, vy: 0, run: 0, wait: 0, on: 0, trail: 0, seed: beadI + 1};
  }

  /** How many glass beads to keep. None when it is dry; a few in drizzle; a full set in a downpour.
   *  The old home-screen streaks were one short slice of a slow cycle (about five seconds on the far
   *  layer), so a streak vanished mid-screen and the next one popped in at the top. These beads are
   *  separate, and the faint streaks behind them stay long enough to keep moving through that wrap. */
  function beadCount(rate) {
    if (!rate || rate < 0.2) return 0;
    if (rate < 0.45) return 6;
    if (rate < 0.75) return 14;
    return BEAD_N;
  }

  function respawnBead(b, fromTop) {
    var x = (b.seed * 0.37 + Math.random()) % 1;
    b.x = x < 0 ? x + 1 : x;
    b.y = fromTop ? (-0.04 - Math.random() * 0.2) : Math.random() * 0.85;
    b.r = 0.022 + (b.seed % 5) * 0.004 + Math.random() * 0.008;
    b.run = 0;
    b.vy = 0.015;
    b.wait = 0.6 + Math.random() * 3.4;
    b.trail = 0;
    b.on = 1;
  }

  /** Beads for rain, a storm, or fog that still has precipitation. Light rain keeps a few. */
  function glassCount() {
    var r = scene.rate || 0;
    var rain = scene.kind === 'rain' || scene.kind === 'storm';
    if (scene.kind === 'fog' && r < 0.15) return 0;
    if (!rain && scene.kind !== 'fog') return 0;
    if (rain && r < 0.2) r = 0.35;
    return beadCount(r);
  }

  function stepBeads(dt) {
    var n = glassCount(), i, j, a, b, dx, dy, reach;
    for (i = 0; i < BEAD_N; i++) {
      a = beads[i];
      if (i >= n) { a.on = 0; continue; }
      if (!a.on) respawnBead(a, false);
      a.wait -= dt;
      if (!a.run && a.wait <= 0) {
        a.run = 1;
        a.vy = 0.2 + Math.random() * 0.25;
      }
      if (a.run) {
        a.vy += dt * 0.16;
        if (a.vy > 0.7) a.vy = 0.7;
        a.trail = a.vy * 0.2;
        if (a.trail > 0.14) a.trail = 0.14;
      } else {
        a.vy = 0.018;
        a.trail = 0;
      }
      a.y += a.vy * dt;
      a.x += (scene.wind || 0) * 0.00035 * dt;
      if (a.x < -0.05) a.x += 1;
      if (a.x > 1.05) a.x -= 1;
      if (a.y > 1.06) respawnBead(a, true);
    }
    for (i = 0; i < n; i++) {
      a = beads[i];
      if (!a.on || !a.run) continue;
      for (j = i + 1; j < n; j++) {
        b = beads[j];
        if (!b.on) continue;
        dx = a.x - b.x;
        dy = a.y - b.y;
        reach = a.r + b.r;
        if (dx * dx + dy * dy > reach * reach) continue;
        if (a.y >= b.y) {
          a.r = a.r + b.r * 0.45;
          if (a.r > 0.038) a.r = 0.038;
          if (b.vy > a.vy) a.vy = b.vy;
          a.run = 1;
          respawnBead(b, true);
        } else {
          b.r = b.r + a.r * 0.45;
          if (b.r > 0.038) b.r = 0.038;
          if (a.vy > b.vy) b.vy = a.vy;
          b.run = 1;
          respawnBead(a, true);
        }
      }
    }
  }

  function applySky(p, L) {
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(L.a);
    gl.vertexAttribPointer(L.a, 2, gl.FLOAT, false, 0, 0);
    if (L.time) gl.uniform1f(L.time, passSec);
    if (L.drift) gl.uniform1f(L.drift, passDrift);
    if (L.elev) gl.uniform1f(L.elev, elevNow());
    if (L.cover) gl.uniform1f(L.cover, coverOf(scene.kind));
    if (L.rate) gl.uniform1f(L.rate, scene.kind === 'rain' || scene.kind === 'storm' || scene.kind === 'snow' ? Math.max(scene.rate || 0, 0.35) : 0);
    if (L.wind) gl.uniform1f(L.wind, passWind);
    if (L.move) gl.uniform1f(L.move, passMove);
    if (L.flash) gl.uniform1f(L.flash, passFlash);
    if (L.kind) gl.uniform1f(L.kind, KINDN[scene.kind] || 0);
    if (L.night) gl.uniform1f(L.night, scene.night ? 1 : 0);
    if (L.moon) gl.uniform1f(L.moon, moonPhase(Date.now()));
    if (L.lite) gl.uniform1f(L.lite, passLite);
    if (L.bolt) gl.uniform2f(L.bolt, boltUv[0], boltUv[1]);
  }

  function refreshBlur() {
    if (!blurTex || !prog) return;
    var key = scene.kind + (scene.night ? 'n' : 'd');
    var now = Date.now();
    if (key === blurKey && now - blurAt < 4000) return;
    var t0 = now;
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurTex.fb);
    gl.viewport(0, 0, blurTex.w, blurTex.h);
    applySky(prog, locs);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    blurKey = key;
    blurAt = now;
    if (typeof Pace !== 'undefined') Pace.note('blur-upload', Date.now() - t0);
  }

  function drawBeads() {
    var n = glassCount(), i, b, sy, rad, qw, qh, qx, qy;
    if (!n || !dropProg || !blurTex || !spriteTex || !dropLocs) return;
    gl.useProgram(dropProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(dropLocs.a);
    gl.vertexAttribPointer(dropLocs.a, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, blurTex.tex);
    gl.uniform1i(dropLocs.bg, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, spriteTex);
    gl.uniform1i(dropLocs.sprite, 1);
    gl.activeTexture(gl.TEXTURE0);
    for (i = 0; i < n; i++) {
      b = beads[i];
      if (!b.on) continue;
      sy = 1 - b.y;
      rad = b.r;
      qw = rad * 2.4;
      qh = rad * 2.4 + (b.trail > 0.01 ? b.trail : 0);
      qx = b.x - qw * 0.5;
      qy = sy - rad * 1.2;
      gl.uniform4f(dropLocs.rect, qx, qy, qw, qh);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  function drawGL(sec) {
    var v = drive();
    var w = canvas.width, h = canvas.height;
    passSec = anim % 1;
    if (passSec < 0) passSec += 1;
    passDrift = (anim * 0.05) % 1;
    if (passDrift < 0) passDrift += 1;
    passLite = (mode === 'overlay' || mode === 'row') ? 1 : 0;
    var gust = Math.sin(passDrift * 6.28318) * (0.015 + v * v * 0.4);
    var sign = Math.sin(((scene.dir || 0) * Math.PI) / 180);
    if (!sign) sign = 1;
    sign = sign < 0 ? -1 : 1;
    var wind = sign * (0.28 + v * 1.15) + gust;
    if (wind > 1.4) wind = 1.4;
    if (wind < -1.4) wind = -1.4;
    var flashN = 0;
    if (flash > 0.25) flash -= 0.03;
    else if (flash > 0) flash -= 0.012;
    if (flash > 0) flashN = flash > 1 ? 1 : flash;
    passWind = wind;
    passMove = v;
    passFlash = scene.kind === 'storm' ? flashN : 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    var t0 = Date.now();
    applySky(prog, locs);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (typeof Pace !== 'undefined') Pace.note('sky-draw', Date.now() - t0);
    if (glassCount()) {
      refreshBlur();
      drawBeads();
    }
  }

  function draw2d(sec) {
    var w = canvas.width, h = canvas.height, y, g;
    g = ctx.createLinearGradient(0, 0, 0, h);
    if (scene.night) { g.addColorStop(0, '#070b16'); g.addColorStop(1, '#1a2744'); }
    else if (scene.kind === 'storm') { g.addColorStop(0, '#141820'); g.addColorStop(1, '#2a3038'); }
    else if (scene.kind === 'rain') { g.addColorStop(0, '#3c4a5c'); g.addColorStop(1, '#8b97a3'); }
    else { g.addColorStop(0, '#3d7ec9'); g.addColorStop(1, '#f0d2b0'); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (scene.kind === 'rain' || scene.kind === 'storm') {
      var n, layer, count, len, alpha, x, yy, lean;
      for (layer = 0; layer < 3; layer++) {
        count = layer === 0 ? 80 : (layer === 1 ? 40 : 16);
        len = 70 + layer * 40;
        alpha = 0.1 + layer * 0.14;
        ctx.lineWidth = layer === 2 ? 1.3 : 0.6;
        ctx.strokeStyle = 'rgba(206,218,230,' + alpha + ')';
        for (n = 0; n < count; n++) {
          x = ((n * 97 + layer * 53) % (w + 40)) - 20;
          yy = ((n * 61 + sec * (80 + layer * 130)) % (h + len)) - len;
          lean = (scene.wind || 0) * 0.12;
          ctx.beginPath();
          ctx.moveTo(x, yy);
          ctx.lineTo(x + lean, yy + len);
          ctx.stroke();
        }
      }
      paintBeads2d(w, h);
    }
  }

  function paintBeads2d(w, h) {
    var n = glassCount(), i, b, x, y;
    for (i = 0; i < n; i++) {
      b = beads[i];
      if (!b.on) continue;
      x = b.x * w;
      y = b.y * h;
      if (b.trail > 0.01) {
        ctx.strokeStyle = 'rgba(210,220,230,0.35)';
        ctx.lineWidth = b.r * h * 0.45;
        if (ctx.lineWidth < 1) ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y - b.trail * h);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(226,234,242,0.55)';
      ctx.beginPath();
      ctx.arc(x, y, b.r * h, 0, 6.28318);
      ctx.fill();
    }
  }

  function fadeTo(level) {
    if (!canvas || shownFade === level) return;
    shownFade = level;
    var value = level < 1 ? '0.72' : '1';
    canvas.style.opacity = value;
    if (boltCanvas) boltCanvas.style.opacity = value;
  }

  /** Seconds for the beads. A gap is kept up to a tenth of a second, so a short stall still moves the drops. */
  function stepClock(now) {
    var dt = 0.016;
    if (frameLast) {
      dt = (now - frameLast) / 1000;
      if (!(dt > 0)) dt = 0.016;
      if (dt > 0.1) dt = 0.1;
    }
    frameLast = now;
    lastDt = dt;
    anim += dt;
    return anim;
  }

  function noteGap(ms) {
    var t = Date.now();
    if (!gapSince || t - gapSince > 10000) { gapMax = ms; gapSince = t; gapClock = t; return; }
    if (ms > gapMax) { gapMax = ms; gapClock = t; }
  }

  function schedule(fn) {
    var again = window.requestAnimationFrame || function (cb) { return setTimeout(function () { cb(Date.now()); }, 32); };
    again(fn);
  }

  function frame(now) {
    if (!running || !canvas || mode === 'off') return;
    if (typeof document !== 'undefined' && document.hidden) {
      running = false;
      frameLast = 0;
      drawnAt = 0;
      return;
    }
    var dim = paused || (holdUntil && Date.now() < holdUntil);
    fadeTo(dim ? 0.72 : 1);
    if ((mode === 'overlay' || mode === 'row') && drawnAt && (now - drawnAt) < 30) {
      schedule(frame);
      return;
    }
    if (frameLast && mode !== 'overlay' && mode !== 'row') {
      frameAcc += now - frameLast;
      frameN++;
      if (frameN >= 90) {
        var avg = frameAcc / frameN;
        frameAcc = 0;
        frameN = 0;
        if (avg > 22 && !forcedQ) {
          forcedQ = quality === 'high' ? 'medium' : 'low';
          initGL(forcedQ);
        }
      }
    }
    noteGap(frameLast ? now - frameLast : 34);
    var sec = stepClock(now);
    stepBeads(lastDt);
    var wall = Date.now();
    if (scene.kind === 'storm') {
      if (nextBolt < 0) nextBolt = now + 2200 + Math.random() * 4000;
      if (now > nextBolt) {
        strike();
        nextBolt = now + (showBolt ? 18000 + Math.random() * 20000 : (8000 + Math.random() * 12000) * (1.1 - drive() * 0.55));
      }
    }
    if (boltLife > 0) boltLife--;
    if (flickerI < flickerN && wall > flickerAt[flickerI]) {
      if (flickerI % 2 === 0) {
        flash *= 0.2;
        boltAlpha = 0.1;
      } else {
        flash = showBolt ? (0.1 + Math.random() * 0.06) : (0.1 + Math.random() * 0.08 + drive() * 0.08);
        boltAlpha = showBolt ? (0.28 + Math.random() * 0.14) : 0;
      }
      flickerI++;
    }
    if (thunderAt && wall > thunderAt) {
      thunderAt = 0;
      rumble(0);
      setTimeout(function () { rumble(1); }, 160);
    }
    if (gl && prog) drawGL(sec);
    else if (ctx) draw2d(sec);
    drawn++;
    drawnAt = now;
    if (boltCtx) {
      boltCtx.clearRect(0, 0, boltCanvas.width, boltCanvas.height);
      if (boltLife > 0) { drawBolt2d(true); boltSeen = true; }
      else boltSeen = false;
      paintBeadsBolt();
    }
    schedule(frame);
  }

  function loopStart() {
    if (running) return;
    running = true;
    frameLast = 0;
    schedule(frame);
  }

  function setMode(next, q) {
    if (!canvas) { mode = next; return; }
    if (next === 'off') {
      if (mode === 'off') return;
      mode = 'off';
      running = false;
      frameLast = 0;
      if (canvas.className !== 'layer') canvas.className = 'layer';
      if (boltCanvas && boltCanvas.className !== 'layer') boltCanvas.className = 'layer';
      return;
    }
    quality = q || quality || 'medium';
    // Behind the home screen the canvas stays small. The screensaver still uses the chosen detail.
    var use = (next === 'overlay' || next === 'row') ? 'low' : (forcedQ || quality);
    var spec = sizeFor(use);
    var sizeChanged = canvas.width !== spec.w || canvas.height !== spec.h;
    if (!gl && !ctx) {
      if (!initGL(use) && !ctx) {
        try { ctx = canvas.getContext('2d'); } catch (e2) { ctx = null; }
        if (!ctx) note('no draw');
      }
    } else if (sizeChanged) {
      if (gl) initGL(use);
      else {
        canvas.width = spec.w;
        canvas.height = spec.h;
      }
    }
    var cls = 'layer on ' + next;
    var changed = mode !== next || sizeChanged;
    mode = next;
    if (canvas.className !== cls) canvas.className = cls;
    if (boltCanvas) {
      if (boltCanvas.className !== cls) boltCanvas.className = cls;
      if (boltCanvas.width !== canvas.width || boltCanvas.height !== canvas.height) {
        boltCanvas.width = canvas.width;
        boltCanvas.height = canvas.height;
      }
    }
    if (changed) note(next + (gl ? ' webgl' : (ctx ? ' canvas' : ' undrawn')));
    if (!running) loopStart();
  }

  function boot(node) {
    canvas = node;
    if (typeof document !== 'undefined') boltCanvas = document.getElementById('livebolt');
    if (boltCanvas) boltCtx = boltCanvas.getContext('2d');
  }

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
      var body, features, best = '', severe = '', rank = 0, severeRank = 0, n, p, r;
      try { body = JSON.parse(x.responseText); } catch (e2) { return; }
      features = body && body.features || [];
      for (n = 0; n < features.length; n++) {
        p = features[n].properties || {};
        if (p.status && p.status !== 'Actual') continue;
        r = p.severity === 'Extreme' ? 4 : p.severity === 'Severe' ? 3 : p.severity === 'Moderate' ? 2 : 0;
        if (r > rank && p.event) { rank = r; best = String(p.event); }
        if (r >= 3 && r > severeRank && p.event) { severeRank = r; severe = String(p.event); }
      }
      alertText = best;
      if (alertSevere !== severe) { alertSevere = severe; skyAt = 0; }
    };
    x.ontimeout = x.onerror = function () { over = true; };
    try { x.send(); } catch (e3) {}
  }

  // RainViewer's Universal Blue colors (rain, then snow), dBZ then r, g, b. Alpha under 40 is left out.
  var RADAR = [-6,111,107,95,-5,114,110,97,-4,117,112,98,-3,120,115,100,-2,124,117,101,-1,127,120,103,0,130,123,105,1,133,125,106,2,136,128,108,3,139,130,109,4,142,133,111,5,146,136,113,6,158,147,117,7,170,158,121,8,182,169,126,9,194,180,130,10,206,192,135,11,210,196,139,12,214,200,143,13,218,204,147,14,222,208,151,15,136,221,238,16,108,209,235,17,81,197,232,18,54,186,229,19,27,174,226,20,0,163,224,21,0,154,213,22,0,145,202,23,0,136,191,24,0,127,180,25,0,119,170,26,0,112,163,27,0,105,156,28,0,98,149,29,0,91,142,30,0,85,136,31,0,81,128,32,0,78,120,33,0,74,112,34,0,71,104,35,255,238,0,36,255,224,0,37,255,210,0,38,255,197,0,39,255,183,0,40,255,170,0,41,255,159,0,42,255,149,0,43,255,139,0,44,255,129,0,45,255,68,0,46,242,54,0,47,230,40,0,48,217,27,0,49,205,13,0,50,193,0,0,51,168,0,0,52,143,0,0,53,118,0,0,54,93,0,0,55,255,170,255,56,255,159,255,57,255,149,255,58,255,139,255,59,255,129,255,60,255,119,255,61,255,108,255,62,255,98,255,63,255,88,255,64,255,78,255,65,255,255,255,75,0,255,0,-6,203,255,255,-4,202,255,255,-3,201,255,255,-2,200,255,255,-1,199,255,255,1,198,255,255,2,197,255,255,3,196,255,255,4,195,255,255,6,194,255,255,7,193,255,255,8,192,255,255,9,191,255,255,11,184,248,255,12,178,242,255,13,171,235,255,14,165,229,255,15,159,223,255,16,152,216,255,17,146,210,255,18,139,203,255,19,133,197,255,20,127,191,255,21,120,184,255,22,114,178,255,23,107,171,255,24,101,165,255,25,95,159,255,26,91,155,255,27,88,152,255,28,85,149,255,29,82,146,255,30,79,143,255,31,75,139,255,32,72,136,255,33,69,133,255,34,66,130,255,35,63,127,255,36,59,123,255,37,56,120,255,38,53,117,255,39,50,114,255,40,47,111,255,41,43,107,255,42,40,104,255,43,37,101,255,44,34,98,255,45,31,95,255,46,27,91,255,47,24,88,255,48,21,85,255,49,18,82,255,50,15,79,255,51,12,75,255,52,9,72,255,53,6,69,255,54,2,66,255,55,0,63,255,56,0,59,255,57,0,56,255,58,0,53,255,59,0,50,255,60,0,47,255,61,0,43,255,62,0,40,255,63,0,37,255,64,0,34,255,65,0,31,255,66,0,27,255,67,0,24,255,68,0,21,255,69,0,18,255,70,0,15,255,71,0,12,255,72,0,9,255,73,0,6,255,74,0,2,255,75,0,0,255];

  /** dBZ for one Universal Blue pixel. A clear pixel is 0. A color that isn't in the table is 0 too. */
  function dbzFromPixel(r, g, b, a) {
    if (a < 16) return 0;
    var best = 1600, dbz = null, i, dr, dg, db, d;
    for (i = 0; i < RADAR.length; i += 4) {
      dr = RADAR[i + 1] - r;
      dg = RADAR[i + 2] - g;
      db = RADAR[i + 3] - b;
      d = dr * dr + dg * dg + db * db;
      if (d < best) { best = d; dbz = RADAR[i]; }
    }
    return dbz === null ? 0 : dbz;
  }

  function hasSnow(model, obs) {
    if ((model >= 71 && model <= 77) || model === 85 || model === 86) return true;
    var text = obs ? ((obs.weather || '') + ' ' + (obs.text || '')).toLowerCase() : '';
    return text.indexOf('snow') >= 0 || text.indexOf('sleet') >= 0;
  }

  function isConvective(model) {
    return (model >= 80 && model <= 82) || model >= 95;
  }

  function rainCode(dbz, snow, thunder) {
    if (thunder) return 95;
    if (snow) return dbz >= 45 ? 75 : dbz >= 35 ? 73 : 71;
    if (dbz >= 45) return 65;
    if (dbz >= 35) return 63;
    if (dbz < 25) return 51;
    return 61;
  }

  function minuteCode(mm, snow) {
    if (snow) return mm >= 2 ? 75 : mm >= 0.5 ? 73 : 71;
    if (mm >= 2) return 65;
    if (mm >= 0.5) return 63;
    if (mm < 0.2) return 51;
    return 61;
  }

  /** A severe warning that should replace the sky. Wind and heat do not. */
  function alertCode(alert) {
    var s = String(alert || '').toLowerCase();
    if (!s) return 0;
    if (s.indexOf('snow') >= 0 || s.indexOf('blizzard') >= 0 || s.indexOf('ice storm') >= 0 || s.indexOf('winter') >= 0 || s.indexOf('freezing') >= 0 || s.indexOf('sleet') >= 0) return 75;
    if (s.indexOf('tornado') >= 0 || s.indexOf('thunder') >= 0) return 95;
    if (s.indexOf('hurricane') >= 0 || s.indexOf('tropical') >= 0 || s.indexOf('flood') >= 0 || s.indexOf('rain') >= 0) return 65;
    return 0;
  }

  function obsFresh(obs) {
    return !!(obs && typeof obs.ageMin === 'number' && obs.ageMin < 45);
  }

  function obsCode(obs) {
    if (!obsFresh(obs)) return 0;
    var weather = String(obs.weather || '').toLowerCase();
    var text = String(obs.text || '').toLowerCase();
    var both = weather + ' ' + text;
    var heavy = obs.intensity === 'heavy' || text.indexOf('heavy') >= 0;
    var moderate = obs.intensity === 'moderate' || text.indexOf('moderate') >= 0;
    var vis = typeof obs.visibilityM === 'number' ? obs.visibilityM : null;
    if (both.indexOf('thunder') >= 0) return 95;
    if (both.indexOf('snow') >= 0 || both.indexOf('sleet') >= 0) return heavy ? 75 : moderate ? 73 : 71;
    if (both.indexOf('drizzle') >= 0) return 51;
    if (both.indexOf('rain') >= 0 || both.indexOf('shower') >= 0) return heavy ? 65 : moderate ? 63 : 61;
    if ((both.indexOf('fog') >= 0 || both.indexOf('mist') >= 0) && vis !== null && vis < 1000) return 45;
    if (text.indexOf('partly') >= 0) return 2;
    if (text.indexOf('cloud') >= 0 || text.indexOf('overcast') >= 0) return 3;
    if (text.indexOf('clear') >= 0 || text.indexOf('fair') >= 0 || text.indexOf('sunny') >= 0) return 1;
    return 0;
  }

  /**
   * Which code to show. Severe alert, then radar precipitation, then the 15-minute amount, then a fresh
   * observation, then the model. Fog only when nothing is falling and visibility is low.
   */
  function chooseSky(o) {
    o = o || {};
    var model = o.modelCode || 0;
    var obs = o.obs || null;
    var snow = hasSnow(model, obs);
    var fromAlert = alertCode(o.alert);
    var dbz = typeof o.radarDbz === 'number' ? o.radarDbz : null;
    if (fromAlert) return {code: fromAlert, source: 'alert', dbz: dbz};
    if (dbz !== null && dbz >= 20) {
      return {code: rainCode(dbz, snow, isConvective(model) && dbz >= 45), source: 'radar', dbz: dbz};
    }
    var mm = typeof o.minuteMm === 'number' ? o.minuteMm : 0;
    if (mm >= 0.1) return {code: minuteCode(mm, snow), source: 'minutely', dbz: dbz};
    var fromObs = obsCode(obs);
    if (fromObs) return {code: fromObs, source: 'obs', dbz: dbz};
    if (model === 45 || model === 48) {
      var vis = obsFresh(obs) && typeof obs.visibilityM === 'number' ? obs.visibilityM : null;
      if (vis !== null && vis < 1000) return {code: model, source: 'model', dbz: dbz};
      return {code: 3, source: 'model', dbz: dbz};
    }
    return {code: model, source: 'model', dbz: dbz};
  }

  function getJson(url, headers, done) {
    if (typeof XMLHttpRequest === 'undefined') { done(null); return; }
    var x = new XMLHttpRequest();
    var over = false;
    x.open('GET', url, true);
    x.timeout = 8000;
    if (headers) {
      for (var k in headers) if (headers.hasOwnProperty(k)) {
        try { x.setRequestHeader(k, headers[k]); } catch (e) {}
      }
    }
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status !== 200) { done(null); return; }
      try { done(JSON.parse(x.responseText)); } catch (e2) { done(null); }
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(null); } };
    try { x.send(); } catch (e3) { if (!over) { over = true; done(null); } }
  }

  /** The middle pixel of a RainViewer tile. CORS is open; a tainted canvas fails closed. */
  function sampleCenter(url, done) {
    if (typeof Image === 'undefined' || typeof document === 'undefined') { done(null); return; }
    var img = new Image();
    var over = false;
    function fail() { if (!over) { over = true; done(null); } }
    img.onload = function () {
      if (over) return;
      over = true;
      try {
        var c = document.createElement('canvas');
        var w = img.width || 256, h = img.height || 256;
        c.width = w;
        c.height = h;
        var g = c.getContext('2d');
        var tileAt = Date.now();
        g.drawImage(img, 0, 0);
        var p = g.getImageData((w / 2) | 0, (h / 2) | 0, 1, 1).data;
        if (typeof Pace !== 'undefined') Pace.note('radar-tile', Date.now() - tileAt);
        done({r: p[0], g: p[1], b: p[2], a: p[3]});
      } catch (e) { done(null); }
    };
    img.onerror = fail;
    try { img.crossOrigin = 'anonymous'; } catch (e2) {}
    img.src = url;
  }

  function tvRadar(lat, lon, done) {
    getJson('https://api.rainviewer.com/public/weather-maps.json', null, function (body) {
      var past = body && body.radar && body.radar.past;
      if (!past || !past.length || !body.host) { done(null); return; }
      var frame = past[past.length - 1];
      if (!frame || !frame.path) { done(null); return; }
      var url = body.host + frame.path + '/256/7/' + Number(lat).toFixed(4) + '/' + Number(lon).toFixed(4) + '/2/0_0.png';
      sampleCenter(url, function (px) {
        if (!px) { done(null); return; }
        done({ok: true, dbz: dbzFromPixel(px.r, px.g, px.b, px.a), frameTime: frame.time || 0, via: 'tv'});
      });
    });
  }

  function bridgeRadar(lat, lon, done) {
    if (typeof Prefs === 'undefined' || !Prefs.wizUrl || typeof XMLHttpRequest === 'undefined') { done(null); return; }
    var root = String(Prefs.wizUrl() || '').replace(/\/+$/, '');
    if (!root) { done(null); return; }
    var key = Prefs.wizToken ? Prefs.wizToken() : '';
    var path = '/weather/radar?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon);
    var url = root + path;
    var x = new XMLHttpRequest();
    var over = false;
    x.open('GET', url, true);
    x.timeout = 8000;
    try { if (key) x.setRequestHeader('X-Bridge-Token', key); } catch (e) {}
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status !== 200) { done(null); return; }
      var body = null;
      try { body = JSON.parse(x.responseText); } catch (e2) { done(null); return; }
      if (!body || typeof body.dbz !== 'number') { done(null); return; }
      done({ok: true, dbz: body.dbz, frameTime: body.frameTime || 0, via: 'bridge'});
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(null); } };
    try { x.send(); } catch (e3) { if (!over) { over = true; done(null); } }
  }

  function readObs(body) {
    var p = body && body.properties;
    if (!p || !p.timestamp) return null;
    var at = Date.parse(p.timestamp);
    if (!at) return null;
    var pw = p.presentWeather && p.presentWeather.length ? p.presentWeather[0] : {};
    var vis = p.visibility && typeof p.visibility.value === 'number' ? p.visibility.value : null;
    return {
      ageMin: (Date.now() - at) / 60000,
      weather: pw.weather || '',
      intensity: pw.intensity || '',
      text: p.textDescription || '',
      visibilityM: vis
    };
  }

  function freshObs(lat, lon, done) {
    var headers = {'Accept': 'application/geo+json'};
    getJson('https://api.weather.gov/points/' + lat + ',' + lon, headers, function (points) {
      var stations = points && points.properties && points.properties.observationStations;
      if (!stations) { done(null); return; }
      getJson(stations, headers, function (list) {
        var feat = list && list.features && list.features[0];
        var id = feat && feat.properties && feat.properties.stationIdentifier;
        if (!id && feat && feat.id) id = String(feat.id).split('/').pop();
        if (!id) { done(null); return; }
        getJson('https://api.weather.gov/stations/' + id + '/observations/latest', headers, function (obs) {
          done(readObs(obs));
        });
      });
    });
  }

  function radarFresh(radar) {
    if (!radar || !radar.ok || typeof radar.dbz !== 'number') return null;
    if (radar.frameTime && (Date.now() / 1000 - radar.frameTime) > 25 * 60) return null;
    return radar;
  }

  /** Radar, the station and the model, at most every 5 minutes. The TV reads the tile; the bridge is the fallback. */
  function refreshConditions(opts, done) {
    var now = Date.now();
    if (skyBusy) { if (done) done(lastSky); return; }
    if (skyAt && now - skyAt < 5 * 60000 && lastSky) { if (done) done(lastSky); return; }
    if (!opts || typeof opts.lat !== 'number' || typeof opts.lon !== 'number' || isNaN(opts.lat) || isNaN(opts.lon)) {
      if (done) done(null);
      return;
    }
    skyBusy = true;
    var left = 2, radar = null, obs = null;
    function finish() {
      if (--left) return;
      skyBusy = false;
      var known = radarFresh(radar);
      var choice = chooseSky({
        modelCode: opts.modelCode || 0,
        minuteMm: opts.minuteMm,
        radarDbz: known ? known.dbz : null,
        obs: obs,
        alert: alertSevere
      });
      choice.at = Date.now();
      choice.via = known ? known.via : '';
      lastSky = choice;
      skyAt = choice.at - (known || obs ? 0 : 4 * 60000);
      var msg = choice.source;
      if (known) msg += ' ' + Math.round(known.dbz) + ' dBZ';
      if (choice.via) msg += ' via ' + choice.via;
      note(msg + ' -> ' + choice.code);
      if (done) done(choice);
    }
    tvRadar(opts.lat, opts.lon, function (found) {
      if (found) { radar = found; finish(); return; }
      bridgeRadar(opts.lat, opts.lon, function (found2) { radar = found2; finish(); });
    });
    freshObs(opts.lat, opts.lon, function (found) { obs = found; finish(); });
  }

  return {
    kind: kind,
    rate: rate,
    night: night,
    moonPhase: moonPhase,
    boot: boot,
    setPaused: function (on) {
      paused = !!on;
      if (mode !== 'off') loopStart();
    },
    skipFrame: function () {},
    hold: function (ms) {
      var until = Date.now() + (ms || 0);
      if (until > holdUntil) holdUntil = until;
    },
    drawn: function () { return drawn; },
    stats: function () { return {inits: inits, gap: Math.round(gapMax), gapAt: gapClock}; },
    beadCount: beadCount,
    setMode: setMode,
    mode: function () { return mode; },
    scene: function (next) { if (next) scene = next; return scene; },
    alert: function () { return alertText; },
    severeAlert: function () { return alertSevere; },
    noteAlert: function (text) { alertText = text || ''; },
    refreshAlert: refreshAlert,
    dbzFromPixel: dbzFromPixel,
    chooseSky: chooseSky,
    refreshConditions: refreshConditions,
    sky: function () { return lastSky; },
    resetSky: function () { skyAt = 0; lastSky = null; skyBusy = false; },
    wake: loopStart,
    strikeSoon: function () { nextBolt = 0; preferSheet = 1; }
  };
})();
