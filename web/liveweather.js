/*
 * Live weather for the screensaver, a quiet layer over photos, and the home-screen row.
 * One full-screen shader (WebGL) draws the sky, clouds, rain, snow and fog. A 2D canvas is the fallback where WebGL
 * is missing. The picture stays small (Medium is 960×540, scaled up) and, if frames start taking too long, the
 * quality drops by itself. Lightning is a branched bolt plus a flash that lights the clouds; thunder, if sound is
 * on, follows after a short random wait, the way a distant strike does.
 * Numbers come from the forecast the app already keeps. A US severe alert is read from api.weather.gov.
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
    'uniform float uTime, uElev, uCover, uRate, uWind, uFlash, uKind, uNight, uMoon;',
    'uniform vec2 uBolt;',
    'varying vec2 vUv;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
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
    '  v += a * noise(p); p *= 2.01; a *= 0.5;',
    '  v += a * noise(p); p *= 2.02; a *= 0.5;',
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
    '  float along = smoothstep(0.0, len * 0.07, dy) * smoothstep(len, len * 0.25, dy);',
    '  float w = smoothstep(width, 0.0, abs(fx));',
    '  float core = smoothstep(width * 0.22, 0.0, abs(fx));',
    '  float show = smoothstep(0.12, 0.48, h * (0.2 + uRate));',
    '  return (w * 0.5 + core * 0.75) * along * show;',
    '}',
    'float snowLayer(vec2 uv, float scale, float speed, float soft){',
    '  vec2 p = vec2(uv.x * scale + sin(uTime * 0.6 + uv.y * 6.0) * 0.08 + uWind * uTime * 0.05, uv.y * scale + uTime * speed);',
    '  vec2 id = floor(p); vec2 f = fract(p) - 0.5;',
    '  float h = hash(id);',
    '  f.x += (h - 0.5) * 0.55;',
    '  f.y += (fract(h * 17.0) - 0.5) * 0.35;',
    '  float rad = mix(0.06, 0.2, h);',
    '  return smoothstep(rad, rad - soft, length(f * vec2(1.78, 1.0))) * step(0.86, h);',
    '}',
    'void main(){',
    '  vec2 uv = vUv;',
    '  uv.x += sin(uTime * 0.15) * 0.01;',
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
    '  vec2 sunP = vec2(0.72 + sin(uTime * 0.05) * 0.02, 0.12 + elev * 0.55);',
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
    '    float tw = 0.55 + 0.45 * sin(uTime * 2.2 + sh * 40.0);',
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
    '  float storm = step(4.5, uKind);',
    '  float drift = mix(0.018, 0.11, storm);',
    '  vec2 farC = cuv + vec2(uTime * drift + uWind * 0.02, sin(uTime * 0.05) * 0.012);',
    '  vec2 nearC = cuv + vec2(uTime * drift * 2.35, sin(uTime * 0.08 + uv.x) * 0.02);',
    '  float n1 = fbm(farC * 1.15);',
    '  float n2 = fbm(nearC * 2.15 + vec2(n1 * 0.85, uTime * mix(0.012, 0.04, storm)));',
    '  float fine = noise(nearC * 5.4 + vec2(uTime * drift * 2.6, n1));',
    '  float field = n1 * 0.52 + n2 * 0.36 + fine * 0.12;',
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
    '    float fog = fbm(uv * vec2(1.3, 0.4) + vec2(uTime * 0.025, 0.0));',
    '    fog = smoothstep(0.28, 0.75, fog) * (0.55 + (1.0 - uv.y) * 0.45);',
    '    float fog2 = fbm(uv * vec2(2.4, 0.8) + vec2(-uTime * 0.04, 3.0));',
    '    float fog3 = fbm(uv * vec2(0.7, 0.25) + vec2(uTime * 0.012, 1.0));',
    '    fog = max(fog, smoothstep(0.4, 0.85, fog2) * (1.0 - uv.y * 0.35) * 0.75);',
    '    fog = max(fog, smoothstep(0.35, 0.8, fog3) * 0.55);',
    '    col = mix(col, vec3(0.78, 0.80, 0.83), clamp(fog, 0.0, 0.92));',
    '  }',
    '  if ((uKind > 2.5 && uKind < 3.5) || uKind > 4.5) {',
    '    float far = rainLayer(uv, 150.0, 0.5, 0.038, 0.1, 1.3) * 0.16;',
    '    far += rainLayer(uv + vec2(0.17, 0.0), 96.0, 0.72, 0.05, 0.09, 2.9) * 0.22;',
    '    float mid = rainLayer(uv + vec2(0.41, 0.0), 44.0, 1.05, 0.09, 0.08, 4.4) * 0.36;',
    '    float near = rainLayer(uv + vec2(0.73, 0.0), 18.0, 1.45, 0.17, 0.055, 7.1) * 0.55;',
    '    col += vec3(0.5, 0.58, 0.68) * far;',
    '    col += vec3(0.66, 0.74, 0.84) * mid;',
    '    col += vec3(0.82, 0.9, 0.98) * near;',
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

  var canvas = null, boltCanvas = null, boltCtx = null, gl = null, ctx = null, prog = null, glassProg = null, quad = null;
  var target = null, mode = 'off', running = false, quality = 'medium', forcedQ = '';
  var scene = {kind: 'clear', night: false, rate: 0, wind: 0, dir: 0};
  var locs = null, glassLocs = null;
  var nextBolt = -1, flash = 0, bolt = 0, thunderAt = 0, alertText = '', alertAt = 0;
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
    if (scene.night) return -0.16;
    var h = new Date().getHours() + new Date().getMinutes() / 60;
    // "Clear" in the preview is a daytime sky, even when the clock is still before dawn.
    if (typeof Prefs !== 'undefined' && Prefs.liveForce) {
      var force = Prefs.liveForce();
      if (force === 'clear') h = 15.5;
      else if (force === 'fog') h = 9.5;
    }
    var x = (h - 6.2) / 13.2;
    if (x <= 0 || x >= 1) return -0.05;
    return Math.sin(x * Math.PI);
  }

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      try { console.log(gl.getShaderInfoLog(sh)); } catch (e) {}
      return null;
    }
    return sh;
  }

  function program(fs) {
    var p = gl.createProgram();
    var vs = compile(gl.VERTEX_SHADER, VS);
    var fsh = compile(gl.FRAGMENT_SHADER, fs);
    if (!vs || !fsh) return null;
    gl.attachShader(p, vs);
    gl.attachShader(p, fsh);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
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

  function initGL(q) {
    if (!canvas) return false;
    var spec = sizeFor(q);
    if (canvas.width !== spec.w || canvas.height !== spec.h) {
      canvas.width = spec.w;
      canvas.height = spec.h;
      gl = null;
      prog = null;
      glassProg = null;
      target = null;
    }
    if (!gl) {
      try { gl = canvas.getContext('webgl', {antialias: false, alpha: true}) || canvas.getContext('experimental-webgl'); } catch (e) { gl = null; }
      if (!gl) return false;
      prog = program(FS);
      glassProg = program(GLASS);
      if (!prog) { gl = null; return false; }
      quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      locs = {
        a: gl.getAttribLocation(prog, 'a'),
        time: gl.getUniformLocation(prog, 'uTime'),
        elev: gl.getUniformLocation(prog, 'uElev'),
        cover: gl.getUniformLocation(prog, 'uCover'),
        rate: gl.getUniformLocation(prog, 'uRate'),
        wind: gl.getUniformLocation(prog, 'uWind'),
        flash: gl.getUniformLocation(prog, 'uFlash'),
        kind: gl.getUniformLocation(prog, 'uKind'),
        night: gl.getUniformLocation(prog, 'uNight'),
        moon: gl.getUniformLocation(prog, 'uMoon'),
        bolt: gl.getUniformLocation(prog, 'uBolt')
      };
      if (glassProg) {
        glassLocs = {
          a: gl.getAttribLocation(glassProg, 'a'),
          scene: gl.getUniformLocation(glassProg, 'uScene'),
          time: gl.getUniformLocation(glassProg, 'uTime'),
          rate: gl.getUniformLocation(glassProg, 'uRate')
        };
      }
    }
    if (target && target.tex) { gl.deleteTexture(target.tex); gl.deleteFramebuffer(target.fb); target = null; }
    if (spec.glass && glassProg) target = makeTarget(spec.w, spec.h);
    return true;
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

  function drawBolt2d() {
    if (!boltCtx) return;
    var alpha, b;
    boltCtx.clearRect(0, 0, boltCanvas.width, boltCanvas.height);
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
    flash = sheet ? (0.28 + Math.random() * 0.2) : (0.22 + Math.random() * 0.12);
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
    flickerN = 3 + Math.floor(Math.random() * 3);
    flickerI = 0;
    t = wall + 60 + Math.random() * 140;
    for (i = 0; i < flickerN; i++) {
      flickerAt[i] = t;
      t += 35 + Math.random() * 240;
    }
    thunderAt = wall + (sheet ? 900 + Math.random() * 2400 : 400 + Math.random() * 1600);
  }

  function drawGL(sec) {
    var spec = sizeFor(forcedQ || quality);
    var w = canvas.width, h = canvas.height;
    var gust = Math.sin(sec * 0.35) * 0.22 + Math.sin(sec * 0.07) * 0.1;
    var wind = Math.max(-1.4, Math.min(1.4, (scene.wind || 0) / 28 + gust));
    var flashN = flash > 0 ? Math.min(1, flash) : 0;
    if (flash > 0.25) flash -= 0.03;
    else if (flash > 0) flash -= 0.012;
    function uniforms(p, L) {
      gl.useProgram(p);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(L.a);
      gl.vertexAttribPointer(L.a, 2, gl.FLOAT, false, 0, 0);
      if (L.time) gl.uniform1f(L.time, sec);
      if (L.elev) gl.uniform1f(L.elev, elevNow());
      if (L.cover) gl.uniform1f(L.cover, coverOf(scene.kind));
      if (L.rate) gl.uniform1f(L.rate, scene.kind === 'rain' || scene.kind === 'storm' || scene.kind === 'snow' ? Math.max(scene.rate || 0, 0.35) : 0);
      if (L.wind) gl.uniform1f(L.wind, wind);
      if (L.flash) gl.uniform1f(L.flash, scene.kind === 'storm' ? flashN : 0);
      if (L.kind) gl.uniform1f(L.kind, KINDN[scene.kind] || 0);
      if (L.night) gl.uniform1f(L.night, scene.night ? 1 : 0);
      if (L.moon) gl.uniform1f(L.moon, moonPhase(Date.now()));
      if (L.bolt) gl.uniform2f(L.bolt, boltUv[0], boltUv[1]);
    }
    gl.viewport(0, 0, w, h);
    if (target && spec.glass && (scene.kind === 'rain' || scene.kind === 'storm')) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      uniforms(prog, locs);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(glassProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, target.tex);
      gl.uniform1i(glassLocs.scene, 0);
      gl.uniform1f(glassLocs.time, sec);
      gl.uniform1f(glassLocs.rate, scene.rate || 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(glassLocs.a);
      gl.vertexAttribPointer(glassLocs.a, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      uniforms(prog, locs);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
        len = 16 + layer * 28;
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
    }
  }

  function frame(now) {
    if (!running || !canvas) return;
    if (typeof document !== 'undefined' && document.hidden) { running = false; return; }
    if (frameLast) {
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
    frameLast = now;
    var sec = now / 1000;
    var wall = Date.now();
    if (scene.kind === 'storm') {
      if (nextBolt < 0) nextBolt = now + 2200 + Math.random() * 4000;
      if (now > nextBolt) {
        strike();
        nextBolt = now + (showBolt ? 7000 + Math.random() * 9000 : 700 + Math.random() * 2600);
      }
    }
    if (boltLife > 0) boltLife--;
    if (flickerI < flickerN && wall > flickerAt[flickerI]) {
      if (flickerI % 2 === 0) {
        flash *= 0.2;
        boltAlpha = 0.1;
      } else {
        flash = showBolt ? (0.16 + Math.random() * 0.1) : (0.22 + Math.random() * 0.22);
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
    if (bolt > 0 || (boltCtx && boltCanvas.width)) drawBolt2d();
    var again = window.requestAnimationFrame || function (fn) { return setTimeout(function () { fn(Date.now()); }, 32); };
    again(frame);
  }

  function loopStart() {
    if (running) return;
    running = true;
    frameLast = 0;
    var again = window.requestAnimationFrame || function (fn) { return setTimeout(function () { fn(Date.now()); }, 32); };
    again(frame);
  }

  function setMode(next, q) {
    if (!canvas) { mode = next; return; }
    if (next === 'off') {
      mode = 'off';
      running = false;
      canvas.className = 'layer';
      return;
    }
    quality = q || quality || 'medium';
    var use = forcedQ || quality;
    if (!gl && !ctx) {
      if (!initGL(use)) ctx = canvas.getContext('2d');
    } else if (canvas.width !== sizeFor(use).w) {
      initGL(use);
    }
    mode = next;
    canvas.className = 'layer on ' + next;
    if (boltCanvas) {
      boltCanvas.className = canvas.className;
      boltCanvas.width = canvas.width;
      boltCanvas.height = canvas.height;
    }
    loopStart();
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
      var body, features, best = '', rank = 0, n, p, r;
      try { body = JSON.parse(x.responseText); } catch (e2) { return; }
      features = body && body.features || [];
      for (n = 0; n < features.length; n++) {
        p = features[n].properties || {};
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
    moonPhase: moonPhase,
    boot: boot,
    setMode: setMode,
    mode: function () { return mode; },
    scene: function (next) { if (next) scene = next; return scene; },
    alert: function () { return alertText; },
    noteAlert: function (text) { alertText = text || ''; },
    refreshAlert: refreshAlert,
    wake: loopStart,
    strikeSoon: function () { nextBolt = 0; preferSheet = 1; }
  };
})();
