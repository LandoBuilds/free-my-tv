/*
 * The home screen for web-app TVs (LG webOS, Samsung Tizen), with the Android app's design and behavior (HomeView):
 *  - top: the "For You" title and the tabs (Explore, Movies, Shows); icon-only glass buttons at the right (Live TV,
 *    HDMI Inputs, Settings) and the crypto quotes at the end of the tab row;
 *  - three picks for this hour in the selected tab; the background is the focused one's photo, blurred, almost white;
 *  - the glass shelf with the apps; ↓ opens the drawer (inputs, shortcuts, weather, prices); ↑ or Back closes it;
 *  - a night look from sunset to sunrise; a screensaver after a few idle minutes.
 * The remote's arrows, OK and Back move the focus; a pointer (LG's Magic Remote) focuses what it points at.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function sym(name, parent, size) {
    var s = el('span', 'sym', parent);
    s.style.webkitMaskImage = 'url(symbols/' + name + '.png)';
    s.style.maskImage = 'url(symbols/' + name + '.png)';
    if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; }
    return s;
  }

  function coin(i, parent) {
    var c = window.COINS && window.COINS[i];
    if (!c) return;
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    // Old WebKit (Tizen 2) draws an SVG without them at 300×150; the CSS still sets the size everywhere it's shown.
    svg.setAttribute('width', '15');
    svg.setAttribute('height', '15');
    for (var k = 0; k < c.length; k++) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', c[k]);
      p.setAttribute('fill-rule', 'evenodd');
      svg.appendChild(p);
    }
    parent.appendChild(svg);
  }

  function hasClass(e, c) { return (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0; }
  function setClass(e, c, on) {
    if (!e) return;
    if (on && !hasClass(e, c)) e.className = (e.className + ' ' + c).replace(/^\s+/, '');
    else if (!on && hasClass(e, c)) e.className = (' ' + e.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }

  var stage = $('stage'), body = document.body;

  /**
   * The 1920 × 1080 stage fills the window (on the TV it already is 1920 × 1080). A TV's window only gets shorter for
   * the keyboard (Samsung's resizes it while the city or key field has focus): there the stage keeps its width and the
   * keyboard covers its bottom, as in other apps. Fitted to the short window, it shrank into the top left beside a white
   * band (#399).
   */
  function fit() {
    var s = TV.name !== 'browser' ? window.innerWidth / 1920 : Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.webkitTransform = stage.style.transform = s === 1 ? '' : 'scale(' + s + ')';
  }

  // MARK: - Right to left

  // In a right-to-left language (Arabic) the screen is mirrored: x is the distance from the start edge, which is the
  // left one in English and the right one in Arabic. The arrows follow it (move), and the stylesheet's .rtl rules
  // mirror what isn't placed here.
  var rtl = false;

  function direction() {
    rtl = I18N.rtl;
    setClass(body, 'rtl', rtl);
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  }

  /** x pixels in from the start edge. */
  function startAt(node, x) {
    node.style.left = rtl ? 'auto' : x + 'px';
    node.style.right = rtl ? x + 'px' : 'auto';
  }

  /** x pixels in from the end edge. */
  function endAt(node, x) {
    node.style.left = rtl ? x + 'px' : 'auto';
    node.style.right = rtl ? 'auto' : x + 'px';
  }

  /** The arrow of a row that goes on (Search, Save): it points the way forward, which is left when mirrored. */
  function forward(parent) {
    var arrow = sym('chevron_right', parent);
    if (rtl) arrow.style.webkitTransform = arrow.style.transform = 'scaleX(-1)';
    return arrow;
  }

  /** A slide of x pixels toward the end edge, as a transform. */
  function slide(node, x) {
    node.style.webkitTransform = node.style.transform = 'translateX(' + (rtl ? -x : x) + 'px)';
  }

  // MARK: - Apps on the shelf

  /** Shelf apps in this order when installed, like the Android app: key, LG app id, name on the TV, brand gradient. */
  var SHELF = [
    ['netflix', /^netflix$/, /netflix/i, ['#0A0A0A', '#000000']],
    ['youtube', /youtube/, /^youtube$/i, ['#1C1C1E', '#09090A']],
    ['prime', /^amazon$/, /prime video|amazon/i, ['#2AA8FF', '#0A68D4']],
    ['disney', /disney/, /disney/i, ['#173584', '#08143F']],
    ['max', /hbo|wbd/, /^(hbo )?max$|hbo max/i, ['#5C30E8', '#221684']],
    ['appletv', /appletv|apple\.tv/, /apple tv/i, ['#1C1C1E', '#000000']],
    ['hulu', /^hulu/, /hulu/i, ['#1CE783', '#0B8F4E']],
    ['paramount', /paramount|cbs/, /paramount/i, ['#0064FF', '#002A86']],
    ['peacock', /peacock/, /peacock/i, ['#1C1C1E', '#000000']],
    ['nfl', /nfl/, /^nfl/i, ['#013369', '#00163D']],
    ['globoplay', /globoplay/, /globoplay/i, ['#FF8A1F', '#FF2D5A']],
    ['jellyfin', /jellyfin/i, /jellyfin/i, ['#AA5CC3', '#00A4DC']],
    ['spotify', /spotify/, /spotify/i, ['#1DB954', '#0F7A36']]
  ];
  // Apps shown at once, as on Android: 8 (today's smallest tiles, 178 wide); the shelf scrolls for the rest. The
  // built-in list keeps 8 too.
  var SHELF_VISIBLE = 8, FEW_APPS = 8;

  function shelfKey(app) {
    for (var i = 0; i < SHELF.length; i++) if (SHELF[i][1].test(app.id) || SHELF[i][2].test(app.title)) return SHELF[i];
    return null;
  }

  function darken(hex, f) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#161618';
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.round(r * f) + ',' + Math.round(g * f) + ',' + Math.round(b * f) + ')';
  }

  /** A name that fits the tile on one line (the font shrinks for long names). */
  function wordFit(title, width, max) {
    return Math.max(18, Math.min(max, Math.floor(width * 0.8 / (Math.max(4, title.length) * 0.56))));
  }

  // MARK: - Logos

  // The TV's icons are small squares with their own background (white behind Netflix, black behind Max). Like the
  // Android app does with the TV art, the logo is lifted off it once: the background goes transparent and the rest is
  // cropped to the logo, which then fills the tile on the brand's color.
  var lifted = {};   // icon url -> {src, bg: [r, g, b], ink: luminance histogram} or false (keep the icon as it is)
  var LIFT_SIZE = 240;

  // sRGB (0-255) to linear light, computed once: lift() needs it for every pixel, and old TVs are slow at Math.pow.
  var LINEAR = [];
  for (var li = 0; li < 256; li++) LINEAR[li] = li <= 10 ? li / 255 / 12.92 : Math.pow((li / 255 + 0.055) / 1.055, 2.4);

  /** Relative luminance (0-1) of an sRGB color (whole numbers, as read from the canvas). */
  function luminance(r, g, b) {
    return 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];
  }

  function rgbOf(color) {
    var m = /^#?([0-9a-f]{6})$/i.exec(color || '');
    if (m) { var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color || '');
    return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
  }

  /**
   * The background of an icon whose edges change smoothly instead of being one color (Disney+'s and SkyShowtime's
   * gradients, Vodafone TV's vignette, Movistar Plus+'s grey to black on a 2019 Q70R): the colors along its four edges,
   * a little inside, for a Coons patch between them (patch()). null when an edge is clear or jumps: a picture, not a
   * background.
   */
  function ramp(px, w, h, inset) {
    var N = 16, x0 = inset, x1 = w - 1 - inset, y0 = inset, y1 = h - 1 - inset;
    if (x1 - x0 < N || y1 - y0 < N) return null;
    var sum = [0, 0, 0];
    function side(xa, ya, xb, yb) {   // N + 1 colors from (xa, ya) to (xb, yb)
      var out = [], prev = null;
      for (var s = 0; s <= N; s++) {
        var i = (Math.round(ya + s / N * (yb - ya)) * w + Math.round(xa + s / N * (xb - xa))) * 4;
        if (px[i + 3] < 250) return null;
        var c = [px[i], px[i + 1], px[i + 2]];
        if (prev && Math.max(Math.abs(c[0] - prev[0]), Math.abs(c[1] - prev[1]), Math.abs(c[2] - prev[2])) > 48) return null;
        sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
        out.push(prev = c);
      }
      return out;
    }
    var top = side(x0, y0, x1, y0), bottom = side(x0, y1, x1, y1), left = side(x0, y0, x0, y1), right = side(x1, y0, x1, y1);
    if (!top || !bottom || !left || !right) return null;
    // Each column's top and bottom colors, each row's left and right ones, and where it sits between the edges (0-1).
    function spread(edge, n, a, b) {
      var out = [], at = [];
      for (var z = 0; z < n; z++) {
        var t = Math.max(0, Math.min(1, (z - a) / (b - a))), f = t * N, s = Math.min(N - 1, Math.floor(f)), r = f - s;
        for (var c = 0; c < 3; c++) out.push(edge[s][c] + (edge[s + 1][c] - edge[s][c]) * r);
        at.push(t);
      }
      return {rgb: out, at: at};
    }
    var cols = spread(top, w, x0, x1), colsB = spread(bottom, w, x0, x1), rows = spread(left, h, y0, y1);
    var corners = [];
    for (var c = 0; c < 3; c++) {
      corners.push((top[0][c] + left[0][c]) / 2, (top[N][c] + right[0][c]) / 2,
        (bottom[0][c] + left[N][c]) / 2, (bottom[N][c] + right[N][c]) / 2);
    }
    var n = 4 * (N + 1);
    return {t: cols.rgb, b: colsB.rgb, l: rows.rgb, r: spread(right, h, y0, y1).rgb, u: cols.at, v: rows.at,
      corners: corners, mean: [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)]};
  }

  /** Channel c of ramp()'s background at (x, y): the edges blended in, less the corners counted twice. */
  function patch(g, x, y, c) {
    var u = g.u[x], v = g.v[y], k = c * 4;
    return (1 - v) * g.t[x * 3 + c] + v * g.b[x * 3 + c] + (1 - u) * g.l[y * 3 + c] + u * g.r[y * 3 + c] -
      ((1 - u) * (1 - v) * g.corners[k] + u * (1 - v) * g.corners[k + 1] + (1 - u) * v * g.corners[k + 2] +
        u * v * g.corners[k + 3]);
  }

  function lift(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return false;
    var f = Math.min(1, LIFT_SIZE / Math.max(w, h));
    w = Math.max(1, Math.round(w * f));
    h = Math.max(1, Math.round(h * f));
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var g = canvas.getContext('2d');
    var data;
    try {
      g.drawImage(img, 0, 0, w, h);
      data = g.getImageData(0, 0, w, h);
    } catch (e) {
      return false;   // a TV that doesn't let the page read its icons
    }
    var px = data.data;
    // The background: the most common color a little inside the edges (rounded icons have transparent corners).
    var votes = {}, best = null, bestN = 0, inset = Math.round(Math.min(w, h) * 0.08);
    for (var s = 0; s < 64; s++) {
      var t = s % 16 / 16, side = s >> 4;
      var x = side < 2 ? Math.round(inset + t * (w - 2 * inset)) : side === 2 ? inset : w - 1 - inset;
      var y = side < 2 ? (side === 0 ? inset : h - 1 - inset) : Math.round(inset + t * (h - 2 * inset));
      var i = (y * w + x) * 4;
      var key = px[i + 3] < 128 ? 'clear' : (px[i] >> 4) + ',' + (px[i + 1] >> 4) + ',' + (px[i + 2] >> 4);
      votes[key] = (votes[key] || 0) + 1;
      if (votes[key] > bestN) { bestN = votes[key]; best = key === 'clear' ? null : [px[i], px[i + 1], px[i + 2]]; }
    }
    // Not one color all along the edge: a gradient or a vignette, taken away pixel by pixel when it's smooth. Against
    // its near-black end, a pixel a few levels darker isn't ink (Movistar Plus+'s last rows, HBO Max's vignette).
    var grad = bestN < 64 ? ramp(px, w, h, inset) : null, under = [0, 0, 0], dark = grad ? 64 : 1;
    if (grad) best = grad.mean;
    var minX = w, minY = h, maxX = -1, maxY = -1, ink = [0, 0, 0, 0, 0, 0, 0, 0], inkSum = 0;
    for (var p = 0; p < w * h; p++) {
      var j = p * 4, a = px[j + 3] / 255;
      if (best) {
        // color to alpha: how far each channel is from the background, as a share of how far it could go, so the
        // anti-aliased edges come out as the logo's color, partly clear, without a fringe of the background
        var k = 0, c;
        for (c = 0; c < 3; c++) {
          var v = px[j + c], o = under[c] = grad ? patch(grad, p % w, (p / w) | 0, c) : best[c];
          k = Math.max(k, v > o ? (v - o) / Math.max(1, 255 - o) : (o - v) / Math.max(dark, o));
        }
        k = Math.max(0, Math.min(1, (k - 0.1) / 0.9));   // compression noise stays clear
        // Outside the edges a gradient was read on, it keeps going (Disney+'s brightens in its last rows): background.
        if (grad && (p % w < inset || p % w >= w - inset || p < inset * w || p >= (h - inset) * w)) k = 0;
        if (k > 0 && k < 1) {
          for (c = 0; c < 3; c++) px[j + c] = Math.max(0, Math.min(255, under[c] + (px[j + c] - under[c]) / k));
        }
        a *= k;
      }
      px[j + 3] = Math.round(a * 255);
      if (a > 0.3) {
        var px0 = p % w, py0 = (p / w) | 0;
        if (px0 < minX) minX = px0;
        if (px0 > maxX) maxX = px0;
        if (py0 < minY) minY = py0;
        if (py0 > maxY) maxY = py0;
        ink[Math.min(7, Math.floor(Math.sqrt(luminance(px[j], px[j + 1], px[j + 2])) * 8))] += a;
        inkSum += a;
      }
    }
    // Nothing left, or nothing taken away (a picture rather than a logo on a background): keep the icon.
    if (maxX < 0 || (maxX - minX > w * 0.96 && maxY - minY > h * 0.96)) return false;
    var crop = document.createElement('canvas');
    crop.width = maxX - minX + 1;
    crop.height = maxY - minY + 1;
    g.putImageData(data, 0, 0);
    crop.getContext('2d').drawImage(canvas, minX, minY, crop.width, crop.height, 0, 0, crop.width, crop.height);
    for (var b = 0; b < 8; b++) ink[b] /= inkSum;
    try {
      return {src: crop.toDataURL('image/png'), bg: best, ink: ink};
    } catch (e2) {
      return false;
    }
  }

  /**
   * Share of the logo that hardly shows on a tile of this luminance (YouTube's black type on a dark tile). Each bin
   * of the histogram holds the ink whose square-root luminance falls in it.
   */
  function unseen(ink, tileLum) {
    var share = 0;
    for (var b = 0; b < 8; b++) {
      var l = Math.pow((b + 0.5) / 8, 2);
      if ((Math.max(l, tileLum) + 0.05) / (Math.min(l, tileLum) + 0.05) < 1.8) share += ink[b];
    }
    return share;
  }

  function paint(box, top, bottom) {
    box.style.background = '-webkit-linear-gradient(top, ' + top + ', ' + bottom + ')';
    box.style.background = 'linear-gradient(' + top + ', ' + bottom + ')';
  }

  /** A color that is clearly a hue (Crunchyroll's orange), not black, white or a gray. */
  function colorful(rgb) {
    return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]) >= 96;
  }

  /**
   * The logo's box in its own proportions, as large as object-fit: contain draws it. Chrome 38 (webOS 3) ignores
   * object-fit while a tile next to it animates, and the logo stretched to its 70% x 50% box until the move ended.
   * Not laid out yet (a closed sheet): object-fit stays, and fitLogos() runs when the sheet opens.
   */
  function fitLogo(img) {
    var box = img.parentNode, bw = img.offsetWidth, bh = img.offsetHeight, nw = img.naturalWidth, nh = img.naturalHeight;
    if (!box || !bw || !bh || !nw || !nh || img.style.width) return;
    var s = Math.min(bw / nw, bh / nh);
    img.style.width = nw * s / box.offsetWidth * 100 + '%';
    img.style.height = nh * s / box.offsetHeight * 100 + '%';
  }

  function fitLogos(root) {
    var imgs = root.querySelectorAll('img.logo');
    for (var i = 0; i < imgs.length; i++) if (imgs[i].complete) fitLogo(imgs[i]);
  }

  /** own: the tile has the TV's color for the app, not one of SHELF's. */
  function showLogo(img, box, top, bottom, logo, own) {
    img.className = 'logo';
    img.onload = function () { img.onload = null; fitLogo(img); };
    img.src = logo.src;
    if (img.complete) fitLogo(img);
    var a = rgbOf(top), z = rgbOf(bottom);
    var tileLum = (luminance(a[0], a[1], a[2]) + luminance(z[0], z[1], z[2])) / 2;
    // The tile takes the icon's background when the logo only reads on it, and when that background is the brand's
    // color: LG's bgColor isn't always the icon's (Crunchyroll's is black, on an orange icon).
    if (logo.bg && ((own && colorful(logo.bg)) || unseen(logo.ink, tileLum) > 0.35)) {
      var bg = 'rgb(' + logo.bg.join(',') + ')';
      var hex = '#' + ((1 << 24) | (logo.bg[0] << 16) | (logo.bg[1] << 8) | logo.bg[2]).toString(16).slice(1);
      paint(box, bg, darken(hex, 0.93));
    }
  }

  /** An app's face: its logo on its brand color (or its name, when the icon can't be read). */
  function face(app, box, wordSize) {
    var k = shelfKey(app);
    var top = k ? k[3][0] : app.color ? darken(app.color, 0.92) : '#2A2A2E';
    var bottom = k ? k[3][1] : app.color ? darken(app.color, 0.62) : '#161618';
    paint(box, top, bottom);
    var word = el('div', 'word', box, I18N.name(app.title));
    if (wordSize) word.style.fontSize = wordSize + 'px';
    if (app.icon) {
      var img = el('img', '', box), url = app.icon;
      word.style.visibility = 'hidden';
      img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); word.style.visibility = ''; };
      if (lifted[url]) { showLogo(img, box, top, bottom, lifted[url], !k); return; }
      if (lifted[url] !== false) {
        img.onload = function () {
          img.onload = null;
          if (lifted[url] === undefined) lifted[url] = lift(img);
          if (lifted[url]) showLogo(img, box, top, bottom, lifted[url], !k);
        };
      }
      img.src = url;
    }
  }

  var apps = [], shelf = [], others = [], inputs = [];

  /** shelf_apps in config.properties: the shelf in that order, by id or name (part of it). */
  var WANTED = (CONFIG.shelfApps || []).map(function (s) { return s.toLowerCase(); });

  function pickShelf() {
    if (WANTED.length && Prefs.shelfConfig() !== WANTED.join(',')) {
      Prefs.set('shelf', null);
      Prefs.set('shelfConfig', WANTED.join(','));
    }
    var chosen = Prefs.shelf(), out = [];
    if (chosen) {
      for (var i = 0; i < chosen.length; i++) {
        for (var j = 0; j < apps.length; j++) if (apps[j].id === chosen[i]) out.push(apps[j]);
      }
    } else if (WANTED.length) {
      for (var w = 0; w < WANTED.length; w++) {
        for (var k = 0; k < apps.length; k++) {
          var id = apps[k].id.toLowerCase(), title = apps[k].title.toLowerCase();
          if ((id.indexOf(WANTED[w]) >= 0 || title.indexOf(WANTED[w]) >= 0) && out.indexOf(apps[k]) < 0) { out.push(apps[k]); break; }
        }
      }
      if (!out.length) out = apps.slice(0, FEW_APPS);
    } else {
      for (var s = 0; s < SHELF.length && out.length < FEW_APPS; s++) {
        for (var a = 0; a < apps.length; a++) {
          if ((SHELF[s][1].test(apps[a].id) || SHELF[s][2].test(apps[a].title)) && out.indexOf(apps[a]) < 0) { out.push(apps[a]); break; }
        }
      }
      if (!out.length) out = apps.slice(0, FEW_APPS);
    }
    shelf = out;
    others = apps.filter(function (x) { return shelf.indexOf(x) < 0; });
  }

  // MARK: - Focus

  var Z = {TOP: 'top', CARDS: 'cards', SHELF: 'shelf', DRAWER: 'drawer', APPS: 'apps', SETTINGS: 'settings', EDIT: 'edit', LANG: 'lang', CITY: 'city', KEY: 'key', ALBUM: 'album', ABOUT: 'about', TEXT: 'text'};
  var st = {zone: Z.SHELF, top: 0, tab: 0, card: 0, shelf: 0, drawer: 0, grid: 0, row: 0, edit: 0, lang: 0, city: 0, key: 0, album: 0, text: 0};
  var cards = [];

  function sheetOpen() { return st.zone === Z.APPS || st.zone === Z.SETTINGS || st.zone === Z.EDIT || st.zone === Z.LANG || st.zone === Z.CITY || st.zone === Z.KEY || st.zone === Z.ALBUM || st.zone === Z.ABOUT || st.zone === Z.TEXT; }

  function updateFocus() {
    var i, list;
    list = $('tabs').children;
    for (i = 0; i < list.length; i++) {
      setClass(list[i], 'on', i === st.tab);
      setClass(list[i], 'focus', st.zone === Z.TOP && st.top === i);
    }
    list = $('buttons').children;
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.TOP && st.top === 3 + i);
    setClass($('quotes'), 'hide', st.zone === Z.TOP && st.top >= 3);
    layoutCards();
    list = $('cards').children;
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.CARDS && st.card === i);
    list = $('tiles').children;
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.SHELF && st.shelf === i);
    revealShelf();
    list = document.querySelectorAll('#drawer .key');
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.DRAWER && st.drawer === i);
    list = document.querySelectorAll('#apps .cell');
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.APPS && st.grid === i);
    var rows = Math.max(1, Math.ceil(others.length / 5)), r = Math.floor(st.grid / 5), first = Math.max(0, Math.min(rows - 3, r - 1));
    $('apps').lastChild.style.webkitTransform = $('apps').lastChild.style.transform = 'translateY(' + (-first * 239) + 'px)';
    focusRows($('settings'), st.row, st.zone === Z.SETTINGS);
    focusRows($('shelfedit'), st.edit, st.zone === Z.EDIT);
    focusRows($('langpick'), st.lang, st.zone === Z.LANG);
    if (langHint) langHint.textContent = I18N.digits((st.lang + 1) + ' / ' + languageChoices().length) + '  ·  ' + tr('OK picks, Back cancels.');
    focusRows($('citypick'), st.city, st.zone === Z.CITY);
    focusRows($('keypick'), st.key, st.zone === Z.KEY);
    focusRows($('albumpick'), st.album, st.zone === Z.ALBUM);
    focusRows($('textpick'), st.text, st.zone === Z.TEXT);
    setClass(body, 'drawer-open', st.zone === Z.DRAWER);
    followSoon();
    reportStatus();
  }

  function focusRows(sheet, index, on) {
    var rows = sheet.querySelectorAll('.row');
    for (var i = 0; i < rows.length; i++) setClass(rows[i], 'focus', on && i === index);
    var holder = sheet.querySelector('.rows');
    if (!holder) return;
    var visible = 7, first = Math.max(0, Math.min(rows.length - visible, index - 3));
    holder.style.webkitTransform = holder.style.transform = 'translateY(' + (-first * 78) + 'px)';
  }

  function nearest(nodes, x) {
    var best = 0, bestD = 1e9;
    for (var i = 0; i < nodes.length; i++) {
      var r = nodes[i].getBoundingClientRect(), d = Math.abs((r.left + r.right) / 2 - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function centerX(node) {
    if (!node) return 960;
    var r = node.getBoundingClientRect();
    return (r.left + r.right) / 2;
  }

  // MARK: - Top: title, tabs, buttons, quotes

  var TAB_KIND = [null, 'movie', 'tv'];

  function renderTop() {
    $('title').textContent = tr('For You');
    var tabs = $('tabs');
    tabs.innerHTML = '';
    var names = [tr('Explore'), tr('Movies'), tr('Shows')];
    for (var i = 0; i < 3; i++) {
      var t = el('button', 'tab', tabs, names[i]);
      hover(t, Z.TOP, i);
    }
    var buttons = $('buttons');
    buttons.innerHTML = '';
    var own = Prefs.boxInput() !== 'live';
    var defs = [
      ['bedtime', tr('Ambient')],
      [own ? 'tv' : 'live_tv', own ? boxLabel() : tr('light|Live TV')],
      ['hdmi', tr('HDMI Inputs')],
      ['settings', tr('light|Settings')]
    ];
    for (var b = 0; b < defs.length; b++) {
      var r = el('button', 'round' + (b === defs.length - 1 ? ' last' : ''), buttons);
      startAt(r, 1508 + 88 * b);
      sym(defs[b][0], r);
      el('div', 'tip', r, defs[b][1]);
      hover(r, Z.TOP, 3 + b);
    }
    renderGlance();
    renderScenes();
    if (!currentTint && Prefs.tint()) applyTint(Glance.tintCss(document.body.className.indexOf('night') >= 0 ? 72 : 186, document.body.className.indexOf('night') >= 0 ? 118 : 196, document.body.className.indexOf('night') >= 0 ? 168 : 210));
  }

  function renderQuotes() {
    var q = $('quotes');
    if (q) q.innerHTML = '';
  }

  // MARK: - Picks and background

  function renderCards() {
    var picks = Data.picks(TAB_KIND[st.tab]);
    var list = resumeItems().concat(picks);
    var holder = $('cards');
    setClass(body, 'no-picks', !list.length);
    setClass(body, 'no-key', !Data.hasKey());   // as on Android: no title or tabs that could never show anything
    if (!Data.hasKey() && st.zone === Z.TOP && st.top < 3) st.top = 3;
    var same = list.length === cards.length;
    for (var i = 0; same && i < list.length; i++) same = list[i].id === cards[i].id && list[i].backdrop === cards[i].backdrop && list[i].meta === cards[i].meta;
    if (same && holder.children.length === list.length) return;
    cards = list;
    holder.innerHTML = '';
    for (var c = 0; c < list.length; c++) {
      var p = list[c], card = el('div', 'card', holder);
      var img = el('div', 'img', card);
      var poster = el('div', 'layer', img);
      if (p.resume) {
        setClass(card, 'resume', true);
        poster.style.background = '#243044';
      } else {
        poster.style.backgroundImage = 'url(' + (p.poster ? Data.image(p.poster, 'w342') : Data.image(p.backdrop, 'w780')) + ')';
      }
      el('div', 'layer back', img);
      el('div', 'name', card, I18N.name(p.title));
      if (p.meta) el('div', 'meta', card, p.meta);
      hover(card, Z.CARDS, c);
    }
    st.card = Math.min(st.card, Math.max(0, list.length - 1));
    if (!list.length && st.zone === Z.CARDS) st.zone = Z.SHELF;
    backdrop(list.length && list[st.card] && list[st.card].backdrop ? Data.image(list[st.card].backdrop, 'w300') : '');
    updateFocus();
  }

  /**
   * The card with focus (st.card, also while focus is elsewhere) is the wide one, the others narrow; past the third the
   * row scrolls a card at a time (the holder slides), and the cards at the edges lose their text. Only the holder's
   * transform and the backdrop's opacity animate: the widths change at once (older TVs).
   */
  function layoutCards() {
    var holder = $('cards'), nodes = holder.children, left = 80, scroll = Math.max(0, st.card - 2) * 360;
    for (var i = 0; i < nodes.length; i++) {
      var wide = i === st.card, w = wide ? 1040 : 320, n = nodes[i], at = left - scroll;
      startAt(n, left);
      n.style.width = w + 'px';
      setClass(n, 'wide', wide);
      setClass(n, 'edge', at < 0 || at > 1740);
      if (wide && !n.getAttribute('data-back') && cards[i] && cards[i].backdrop) {
        n.setAttribute('data-back', '1');
        n.querySelector('.back').style.backgroundImage = 'url(' + Data.image(cards[i].backdrop, 'w1280') + ')';
      }
      left += w + 40;
    }
    slide(holder, -scroll);
  }

  var bgUrl = null, bgFront = 'bgA';

  /**
   * The focused pick's photo as the background: drawn tiny and stretched, it's already as soft as a heavy blur.
   * `fit` is the album's framing (fill or the whole photo). Without it the picks draw as they always have.
   */
  function backdrop(url, fit) {
    var key = fit === undefined ? url : url + (fit ? '|fit' : '|fill');
    if (key === bgUrl) return;
    bgUrl = key;
    var next = bgFront === 'bgA' ? 'bgB' : 'bgA';
    if (!url) {
      setClass($('bgA'), 'on', false);
      setClass($('bgB'), 'on', false);
      return;
    }
    var img = new Image();
    img.onload = function () {
      if (bgUrl !== key) return;
      var canvas = $(next), ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
      if (fit === undefined) ctx.drawImage(img, 0, 0, w, h);
      else {
        var iw = img.width || 1, ih = img.height || 1;
        var scale = fit ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
        var dw = iw * scale, dh = ih * scale;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }
      setClass(canvas, 'on', true);
      setClass($(bgFront), 'on', false);
      bgFront = next;
      sampleTint(canvas);
    };
    if (fit !== undefined) img.onerror = function () { ICloud.noteBroken(); };
    img.src = url;
  }

  var homeTimer = 0, homeIndex = 0;

  /** The album, slowly, behind the shelf. The tiny canvas is the blur; the veil on top keeps the tiles readable. */
  function startAlbumBackground() {
    if (homeTimer || !Prefs.icloudHome() || !ICloud.count()) return;
    homeTimer = 1;
    function step() {
      if (!Prefs.icloudHome() || !ICloud.count()) { stopAlbumBackground(); return; }
      var list = ICloud.playlist();
      if (!list.length) { stopAlbumBackground(); return; }
      var photo = list[homeIndex % list.length];
      homeIndex++;
      backdrop(photo.url, Prefs.icloudFit());
      // The home screen turns more slowly than the screensaver: at least 15 seconds, so the shelf stays easy to read.
      homeTimer = setTimeout(step, Math.max(Prefs.icloudInterval(), 15) * 1000);
    }
    step();
  }

  function stopAlbumBackground() {
    clearTimeout(homeTimer);
    homeTimer = 0;
    bgUrl = '';
  }

  /** Framing changed while a photo is already up: draw that photo again the new way. */
  function redrawAlbumBackground() {
    if (!Prefs.icloudHome() || !ICloud.count()) return;
    var list = ICloud.playlist();
    if (!list.length) return;
    bgUrl = '';
    backdrop(list[(homeIndex + list.length - 1) % list.length].url, Prefs.icloudFit());
  }

  // As HomeView's bgFollow: the background follows the focused pick.
  var BG_FOLLOW_MS = 500, bgTimer = 0;

  /** The focused pick's photo as the background once the focus has rested on it: a quick run along the row fades once. */
  function followSoon() {
    clearTimeout(bgTimer);
    if (Prefs.icloudHome() && ICloud.count()) return;
    bgTimer = setTimeout(function () {
      if (Prefs.icloudHome() && ICloud.count()) return;
      if (cards.length) backdrop(Data.image(cards[Math.min(st.card, cards.length - 1)].backdrop, 'w300'));
    }, BG_FOLLOW_MS);
  }

  function renderClock() {
    var d = new Date(), c = $('clock');
    c.firstChild.textContent = formatDate('format|h:mm', d.getTime());
    c.lastChild.textContent = formatDate('format|EEEE, MMMM d', d.getTime());
    renderGlance();
  }

  function resumeItems() {
    if (!Prefs.resume() || typeof Glance === 'undefined') return [];
    return Glance.recent().map(function (r) {
      var mins = Math.max(1, Math.round((Date.now() - r.at) / 60000));
      return {id: 'recent:' + r.id, resume: true, appId: r.id, title: r.title, meta: trf('{n} min ago', {n: mins}), backdrop: '', poster: ''};
    });
  }

  function renderGlance() {
    var g = $('glance');
    if (!g || typeof Glance === 'undefined') return;
    g.innerHTML = '';
    el('div', 'when', g, formatDate('format|h:mm', Date.now()));
    var w = Data.weather;
    if (w) el('div', 'wx', g, Data.degrees(w.temp) + '  ·  ' + Data.condition(w.code, w.isDay));
    var ev = Glance.event();
    if (ev) el('div', 'ev', g, formatDate('format|h:mm', ev.start) + '  ' + ev.title);
    else if (Prefs.icalUrl() && Glance.eventProblem()) el('div', 'ev', g, tr("Couldn't read the calendar"));
    else if (Prefs.icalUrl()) el('div', 'ev', g, tr('Nothing coming up'));
  }

  function renderScenes() {
    var box = $('scenes');
    if (!box) return;
    box.innerHTML = '';
    if (!Prefs.wizUrl()) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    var scenes = [['movie', tr('Movie')], ['dim', tr('Dim')], ['warm', tr('Warm')], ['bright', tr('Bright')], ['off', tr('All off')]];
    for (var i = 0; i < scenes.length; i++) {
      (function (id, label) {
        var b = el('button', 'scene', box, label);
        b.onclick = function () { Glance.sendScene(id); };
      })(scenes[i][0], scenes[i][1]);
    }
  }

  var currentTint = '';

  function applyTint(color) {
    currentTint = color || '';
    setClass(body, 'tinted', !!currentTint && Prefs.tint());
    var wash = $('wash');
    if (wash) wash.style.backgroundColor = currentTint || 'transparent';
    var tiles = $('tiles') ? $('tiles').children : [], i;
    for (i = 0; i < tiles.length; i++) {
      if (!shelf[i] || !shelf[i].color || !currentTint || !Prefs.tint()) tiles[i].style.background = '';
      else tiles[i].style.background = Glance.mixCss(shelf[i].color, currentTint, 0.4);
    }
  }

  function sampleTint(canvas) {
    if (!Prefs.tint() || !canvas) { applyTint(''); return; }
    try {
      var ctx = canvas.getContext('2d'), data = ctx.getImageData(4, 4, 20, 14).data;
      var r = 0, g = 0, b = 0, n = 0, i;
      for (i = 0; i < data.length; i += 16) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
      if (n) applyTint(Glance.tintCss(r / n, g / n, b / n));
    } catch (e) {}
  }

  /** On the minute, so the clock never runs late (the 30-second refresh could, by up to 30 s). */
  function tickClock() {
    if (!resting()) renderClock();
    setTimeout(tickClock, 60000 - Date.now() % 60000 + 50);
  }

  // MARK: - Shelf

  var shelfFirst = 0, tileStep = 0, tileLeft = 0;

  function renderShelf() {
    var n = Math.min(shelf.length, SHELF_VISIBLE), gap = 48, pad = 40;
    // 16:9 tiles, as on Android: never taller than 126, and the glass keeps its bottom edge.
    var tw = Math.min(126 * 16 / 9, (1760 - Math.max(0, n - 1) * gap) / Math.max(1, n)), th = tw * 9 / 16;
    var width = n * tw + Math.max(0, n - 1) * gap, left = (1920 - width) / 2;
    var platter = $('platter');
    platter.style.display = n ? '' : 'none';
    platter.style.left = (left - pad) + 'px';
    platter.style.width = (width + 2 * pad) + 'px';
    platter.style.top = (814 + 126 - th) + 'px';
    platter.style.height = (th + 2 * pad) + 'px';
    endAt($('quotes'), 1920 - left - width);
    var tiles = $('tiles');
    tiles.innerHTML = '';
    tileStep = tw + gap;
    tileLeft = left;
    shelfFirst = Math.max(0, Math.min(shelfFirst, shelf.length - n));
    for (var i = 0; i < shelf.length; i++) {
      var t = el('div', 'tile', tiles);
      t.style.top = (854 + 126 - th) + 'px';
      t.style.width = tw + 'px';
      t.style.height = th + 'px';
      face(shelf[i], t, wordFit(shelf[i].title, tw, 30));
      hover(t, Z.SHELF, i);
    }
    // More apps than fit: a small arrow inside the glass's edge on each side that has more, where no tile reaches
    // even focused (inside the screen's safe area, as on Android).
    platter.innerHTML = '';
    for (var a = 0; a < 2; a++) {
      var arrow = sym('chevron_right', platter);
      arrow.className += (a === 1) === rtl ? ' more back' : ' more';   // the arrow at the start edge points out, toward it
      startAt(arrow, (a ? width + 2 * pad - 14 : 14) - 8.5);
      arrow.style.top = (pad + th / 2 - 8.5) + 'px';
    }
    st.shelf = Math.min(st.shelf, Math.max(0, shelf.length - 1));
    placeTiles();
    if (currentTint) applyTint(currentTint);
  }

  /** The row slides (a transform on #tiles, which old TVs animate), and the apps it takes past the glass fade out. */
  function placeTiles() {
    var row = $('tiles'), tiles = row.children, n = Math.min(shelf.length, SHELF_VISIBLE);
    for (var i = 0; i < shelf.length; i++) {
      var shown = i >= shelfFirst && i < shelfFirst + n;
      startAt(tiles[i], tileLeft + i * tileStep);
      tiles[i].style.opacity = shown ? '' : '0';
      tiles[i].style.pointerEvents = shown ? '' : 'none';
    }
    slide(row, -shelfFirst * tileStep);
    var arrows = $('platter').children;
    arrows[0].style.visibility = shelfFirst > 0 ? '' : 'hidden';
    arrows[1].style.visibility = shelfFirst + n < shelf.length ? '' : 'hidden';
  }

  /** Scrolls the shelf, one app at a time, so the focused app is shown. */
  function revealShelf() {
    var n = Math.min(shelf.length, SHELF_VISIBLE);
    var first = Math.max(0, Math.min(Math.max(shelfFirst, st.shelf - n + 1), Math.min(st.shelf, shelf.length - n)));
    if (first === shelfFirst || !shelf.length) return;
    shelfFirst = first;
    placeTiles();
  }

  // MARK: - Drawer

  var drawerItems = [], drawerInputs = 0;

  function renderDrawer() {
    var d = $('drawer');
    d.innerHTML = '';
    drawerItems = [];
    var shown = orderedInputs();
    for (var i = 0; i < shown.length; i++) {
      var x = shown[i];
      drawerItems.push({label: x.label || tr('Live TV'), symbol: x.symbol, off: !x.connected, run: launcher(x.id, x.label)});
    }
    drawerInputs = drawerItems.length;
    drawerItems.push({label: tr('All Apps'), symbol: 'apps', run: openApps});
    drawerItems.push({label: tr('Home Settings'), symbol: 'settings', run: openSettings});
    if (TV.canOpenSettings) drawerItems.push({label: tr('TV Settings'), symbol: 'tv_settings', run: tvSettings});
    if (Prefs.wizUrl()) {
      var lights = [['movie', tr('Movie')], ['dim', tr('Dim')], ['warm', tr('Warm')], ['bright', tr('Bright')], ['off', tr('All off')]];
      for (var L = 0; L < lights.length; L++) {
        (function (id, label) {
          drawerItems.push({label: label, symbol: 'lightbulb', run: function () { Glance.sendScene(id); }});
        })(lights[L][0], lights[L][1]);
      }
    }
    var n = drawerItems.length, gap = 18, groupGap = 56, groups = drawerInputs > 0 && drawerInputs < n ? 2 : 1;
    var tw = Math.min(230, (1760 - Math.max(0, n - groups) * gap - (groups - 1) * groupGap) / Math.max(1, n));
    var xPos = 80;
    for (var k = 0; k < n; k++) {
      if (k === drawerInputs && k > 0) {
        xPos += groupGap - gap;
        startAt(el('div', 'row-title', d, tr('Shortcuts')), xPos + 4);
      }
      if (k === 0 && drawerInputs) startAt(el('div', 'row-title', d, tr('Inputs')), 84);
      var item = drawerItems[k], key = el('div', 'key glass' + (item.off ? ' off' : ''), d);
      startAt(key, xPos);
      key.style.width = tw + 'px';
      sym(item.symbol, key);
      el('div', 'label', key, I18N.name(item.label));
      hover(key, Z.DRAWER, k);
      xPos += tw + gap;
    }
    renderPanels();
    updateFocus();
  }

  function renderPanels() {
    var d = $('drawer');
    var old = d.querySelectorAll('.panel');
    for (var o = 0; o < old.length; o++) d.removeChild(old[o]);
    var wx = Prefs.weather(), coins = Data.activeCoins(), qt = coins.length > 0;
    var split = 80 + 1760 * 0.585;
    if (wx) {
      var w = el('div', 'panel glass', d);
      w.id = 'weather';
      startAt(w, 80);
      w.style.width = ((qt ? split - 16 : 1840) - 80) + 'px';
      renderWeather(w);
    }
    if (qt) {
      var q = el('div', 'panel glass', d);
      q.id = 'prices';
      var left = wx ? split + 16 : 80;
      startAt(q, left);
      q.style.width = (1840 - left) + 'px';
      renderPrices(q, coins);
    }
  }

  function renderWeather(card) {
    el('div', 'head', card, Data.city || tr('Weather'));
    var w = Data.weather;
    if (!w) {
      el('div', 'cond', card, tr('No weather data right now.')).style.top = '96px';
      return;
    }
    var now = el('div', 'now', card);
    sym(Data.symbol(w.code, w.isDay), now);
    el('span', 'temp', now, Data.degrees(w.temp));
    el('div', 'cond', card, Data.condition(w.code, w.isDay));
    var parts = weatherParts(w);
    extraKey = parts.join(' · ');
    if (parts.length) extraShown = fitExtra(el('div', 'extra', card, extraKey), parts);
    else extraShown = '';
    setClass(card, 'with-extra', !!extraShown);   // the card grows the line only when it has one: otherwise, main's
    el('div', 'range', card, trf('H:{max}', {max: Data.degrees(w.max)}) + '   ' + trf('L:{min}', {min: Data.degrees(w.min)}));
    el('div', 'split', card);
    // Home Settings → Forecast: the next 6 hours or the next 5 days (the hours until a forecast has days).
    var days = Prefs.forecast() === 'days' && w.days && w.days.length > 0, list = days ? w.days : w.hours, n = days ? 5 : 6;
    var hours = el('div', 'hours', card), width = parseFloat(card.style.width) - 30 - 422, hw = width / n;
    for (var i = 0; list && i < list.length && i < n; i++) {
      var h = el('div', 'hour', hours), x = list[i];
      startAt(h, hw * i);
      h.style.width = hw + 'px';
      el('div', 't', h, days ? Data.weekday(x.at) : Data.hour(x.at));
      sym(Data.symbol(x.code, days || x.day), h);
      var t = el('div', 'd', h, Data.degrees(days ? x.max : x.temp));
      if (days) el('span', 'low', t, Data.degrees(x.min));
    }
    var sun = el('div', 'sun', card);
    if (w.sunrise) { var a = el('span', '', sun); sym('sunrise', a); a.appendChild(document.createTextNode(trf('Sunrise {time}', {time: Data.time(w.sunrise)}))); }
    if (w.sunset) { var b = el('span', '', sun); sym('sunset', b); b.appendChild(document.createTextNode(trf('Sunset {time}', {time: Data.time(w.sunset)}))); }
  }

  var extraShown = '', extraKey = '';

  /**
   * The line under the condition, part by part: rain in the next two hours, the UV index by day, the air quality from
   * moderate up. Empty when it has nothing to say (no rain coming, night, clean air): then the card is the one on main.
   */
  function weatherParts(w) {
    var parts = [], rain = Data.rainIn(Date.now());
    // 0: it rains now, which the line above says; -1: no rain in the two hours ahead; null: the forecast doesn't reach.
    if (rain > 0) parts.push(trf('Rain in ~{time}', {time: trf('{n} min', {n: Math.max(5, Math.round(rain / 5) * 5)})}));
    if (typeof w.feels === 'number' && Math.abs(w.feels - w.temp) >= 2) parts.push(trf('Feels like {temp}', {temp: Data.degrees(w.feels)}));
    if (w.uv >= 3 && w.isDay) parts.push(trf('UV {n}', {n: Math.round(w.uv)}));   // the day's highest, so not at night
    var air = Data.air;
    // 51 is where the US AQI says moderate: good air is what a weather card needn't spell out.
    if (air && air.aqi !== null && air.aqi !== undefined && air.aqi >= 51) parts.push(trf('AQI {n}', {n: Math.round(air.aqi)}));
    return parts;
  }

  /** Never a cut at the edge: the line is set smaller first, and then its last part goes (the air quality, then the UV). */
  function fitExtra(line, parts) {
    var sizes = [21, 19];
    for (var i = 0; i < sizes.length; i++) {
      line.style.fontSize = sizes[i] + 'px';
      if (line.scrollWidth <= line.clientWidth + 1) return line.textContent;
    }
    while (parts.length > 1 && line.scrollWidth > line.clientWidth + 1) {
      parts.pop();
      line.textContent = parts.join(' · ');
    }
    return line.textContent;
  }

  // "Rain in ~40 min" counts down between forecasts: the card is drawn again when its line would read otherwise.
  setInterval(function () {
    if (!resting() && Prefs.weather() && Data.weather && weatherParts(Data.weather).join(' · ') !== extraKey) renderPanels();
  }, 60000);

  function renderPrices(card, coins) {
    el('div', 'head', card, tr('Crypto'));
    var stale = Data.staleness(Data.pricesAt, 5 * 60000);
    el('div', 'side', card, stale ? trf('quotes|{ago}', {ago: stale}) : tr('24h change'));
    for (var j = 0; j < coins.length; j++) {
      var i = coins[j], row = el('div', 'coin', card);
      row.style.top = (86 + 52 * j) + 'px';
      coin(i, row);
      el('span', 'n', row, Data.coinName(i));
      el('span', 'p', row, Data.money(Data.prices[i]));
      var ch = Data.changes[i];
      if (!isNaN(ch)) el('span', 'c ' + (ch >= 0 ? 'up' : 'down'), row, Data.change(ch));
    }
  }

  function openDrawer() {
    if (!drawerItems.length) return;
    var tiles = $('tiles').children;
    st.zone = Z.DRAWER;
    st.drawer = Math.min(drawerItems.length - 1, nearest(document.querySelectorAll('#drawer .key'), centerX(tiles[st.shelf])));
    updateFocus();
  }

  function closeDrawer() {
    var keys = document.querySelectorAll('#drawer .key');
    st.zone = Z.SHELF;
    if (shelf.length) st.shelf = nearest($('tiles').children, centerX(keys[st.drawer]));
    updateFocus();
  }

  // MARK: - All Apps

  function renderApps() {
    var sheet = $('apps');
    sheet.firstChild.textContent = tr('All Apps');
    var grid = sheet.lastChild;
    grid.innerHTML = '';
    for (var i = 0; i < others.length; i++) {
      var r = Math.floor(i / 5), c = i % 5, cell = el('div', 'cell', grid);
      startAt(cell, 130 + c * 340);
      cell.style.top = (196 + r * 239) + 'px';
      face(others[i], el('div', 'face', cell), wordFit(others[i].title, 300, 34));
      el('div', 'label', cell, I18N.name(others[i].title));
      hover(cell, Z.APPS, i);
    }
  }

  function openApps() {
    renderApps();
    st.zone = Z.APPS;
    st.grid = 0;
    setClass($('apps'), 'open', true);
    fitLogos($('apps'));
    updateFocus();
  }

  function closeSheets() {
    setClass($('apps'), 'open', false);
    setClass($('settings'), 'open', false);
    setClass($('shelfedit'), 'open', false);
    setClass($('langpick'), 'open', false);
    setClass($('about'), 'open', false);
    closeField('citypick');
    closeField('keypick');
    closeField('albumpick');
    closeField('textpick');
    setClass($('citypick'), 'open', false);
    setClass($('keypick'), 'open', false);
    setClass($('albumpick'), 'open', false);
    setClass($('textpick'), 'open', false);
    langHint = null;
    st.zone = Z.SHELF;
    updateFocus();
    // Home weather is refused while a sheet is open. Leaving Settings is what turns it on.
    syncLive();
  }

  var textKind = 'ical';

  function textRows() { return textKind === 'wiz' ? 3 : 2; }

  function renderText() {
    var box = $('textpick').firstChild;
    box.innerHTML = '';
    el('div', 'title', box, textKind === 'wiz' ? tr('Lights') : tr('Calendar'));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = textRows() * 78 + 'px';
    if (textKind === 'wiz') {
      textField(holder, Z.TEXT, Prefs.wizUrl(), tr('Paste the bridge address'), tr('Lights'));
      var token = textField(holder, Z.TEXT, Prefs.wizToken(), tr('Bridge token'), tr('Bridge token'));
      token.type = 'password';
      hover(token.parentNode, Z.TEXT, 1);
    } else {
      textField(holder, Z.TEXT, Prefs.icalUrl(), tr('Paste the calendar link'), tr('Calendar'));
    }
    var save = el('div', 'row', holder, tr('Save'));
    hover(save, Z.TEXT, textRows() - 1);
    el('div', 'hint', box, tr('OK picks, Back cancels.'));
    updateFocus();
  }

  function openText(kind) {
    textKind = kind;
    setClass($('settings'), 'open', false);
    st.zone = Z.TEXT;
    st.text = 0;
    $('textpick').firstChild.innerHTML = '';
    renderText();
    setClass($('textpick'), 'open', true);
    openField('textpick');
  }

  function closeText() {
    closeField('textpick');
    setClass($('textpick'), 'open', false);
    openSettings();
    for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].text === textKind) st.row = i;
    updateFocus();
  }

  function saveText() {
    var fields = $('textpick').querySelectorAll('input');
    if (textKind === 'wiz') {
      Prefs.set('wizUrl', fields[0] ? String(fields[0].value || '').replace(/^\s+|\s+$/g, '') : '');
      Prefs.set('wizToken', fields[1] ? String(fields[1].value || '') : '');
      renderScenes();
      renderDrawer();
    } else {
      Prefs.set('icalUrl', fields[0] ? String(fields[0].value || '').replace(/^\s+|\s+$/g, '') : '');
      Glance.loadCalendar(Prefs.icalUrl(), renderGlance);
    }
    closeText();
  }

  // MARK: - Home Settings

  function settingRows() {
    var unit = Prefs.temperature(), theme = Prefs.theme(), clock = Prefs.clockFormat();
    var auto = tr('Automatic'), picked = pickedLanguage();
    var rows = [
      {label: tr('Language'), value: picked === 'auto' ? auto : I18N.languageName(picked), opens: true, language: true,
        step: function (d) { if (d >= 0) openLanguages(); }},
      {label: tr('Temperature'), value: unit === 'C' ? '°C' : unit === 'F' ? '°F' : tr('unit|Automatic'),
        step: function (d) { cycle('temperature', ['auto', 'C', 'F'], unit, d); renderPanels(); }},
      {label: tr('Theme'), value: theme === 'light' ? tr('Light') : theme === 'dark' ? tr('Dark') : auto,
        step: function (d) { cycle('theme', ['auto', 'light', 'dark'], theme, d); checkNight(); }},
      {label: tr('Clock'), value: clock === '24' ? tr('24 hours') : clock === '12' ? tr('12 hours') : auto,
        step: function (d) {
          cycle('clockFormat', ['auto', '24', '12'], clock, d);
          I18N.setClock(Prefs.clockFormat());
          renderClock();
          renderPanels();
        }},
      {label: tr('Dim'), value: dimName(),
        step: function (d) { cycle('dim', ['off', 'low', 'medium', 'high', 'auto'], Prefs.dim(), d); applyDim(); }},
      {label: tr('Screensaver'), value: saverLabel(),
        step: function (d) { cycle('saver', ['photos', 'clock', 'live'], saverMode(), d); syncLive(); }},
      {label: tr('Home weather'), toggle: Prefs.liveHome(),
        step: function () { Prefs.set('liveHome', !Prefs.liveHome()); syncLive(); }},
      {label: tr('Weather on photos'), toggle: Prefs.livePhotos(),
        step: function () { Prefs.set('livePhotos', !Prefs.livePhotos()); syncLive(); }},
      {label: tr('Weather detail'), value: liveQualityLabel(),
        step: function (d) { cycle('liveQuality', ['low', 'medium', 'high'], Prefs.liveQuality(), d); syncLive(); }},
      {label: tr('Thunder'), toggle: Prefs.liveSound(),
        step: function () { Prefs.set('liveSound', !Prefs.liveSound()); }},
      {label: tr('Preview weather'), value: liveForceLabel(),
        step: function (d) { cycle('liveForce', ['auto', 'clear', 'rain', 'storm', 'snow', 'fog', 'night'], Prefs.liveForce(), d); pushScene(); }},
      {label: tr('Home content'), value: homeShowLabel(),
        step: function (d) { cycle('homeShow', ['picks', 'weather', 'photos'], Prefs.homeShow(), d); applyHomeContent(); }},
      {label: tr('Ambient'), value: Prefs.ambient() === 'auto' ? tr('Automatic') : tr('Off'),
        step: function (d) { cycle('ambient', ['off', 'auto'], Prefs.ambient(), d); }},
      {label: tr('Morning from'), value: I18N.digits(Prefs.ambientHour('ambientMorning', 6)),
        step: function (d) { Prefs.set('ambientMorning', (Prefs.ambientHour('ambientMorning', 6) + (d || 1) + 24) % 24); }},
      {label: tr('Day from'), value: I18N.digits(Prefs.ambientHour('ambientDay', 11)),
        step: function (d) { Prefs.set('ambientDay', (Prefs.ambientHour('ambientDay', 11) + (d || 1) + 24) % 24); }},
      {label: tr('Evening from'), value: I18N.digits(Prefs.ambientHour('ambientEvening', 17)),
        step: function (d) { Prefs.set('ambientEvening', (Prefs.ambientHour('ambientEvening', 17) + (d || 1) + 24) % 24); }},
      {label: tr('Night from'), value: I18N.digits(Prefs.ambientHour('ambientNight', 22)),
        step: function (d) { Prefs.set('ambientNight', (Prefs.ambientHour('ambientNight', 22) + (d || 1) + 24) % 24); }},
      {label: tr('Calendar'), value: Prefs.icalUrl() ? tr('Save') : tr('Not set'), opens: true, text: 'ical',
        step: function (d) { if (d >= 0) openText('ical'); }},
      {label: tr('Match colors'), toggle: Prefs.tint(),
        step: function () { Prefs.set('tint', !Prefs.tint()); if (!Prefs.tint()) applyTint(''); }},
      {label: tr('Continue watching'), toggle: Prefs.resume(),
        step: function () { Prefs.set('resume', !Prefs.resume()); renderCards(); }},
      {label: tr('Lights'), value: Prefs.wizUrl() ? tr('Save') : tr('Not set'), opens: true, text: 'wiz',
        step: function (d) { if (d >= 0) openText('wiz'); }},
      {label: tr('iCloud photos'), value: icloudStatus(), opens: true, icloud: true,
        step: function (d) { if (d >= 0) openAlbum(); }},
      {label: tr('Picks per tab'), value: String(I18N.digits(Prefs.cards())),
        step: function (d) { Prefs.set('cards', 3 + (Prefs.cards() - 3 + (d || 1) + 4) % 4); renderCards(); }},
      {label: tr('Cartoons and anime'), toggle: !Prefs.hideAnimation(),
        step: function () { Prefs.set('hideAnimation', !Prefs.hideAnimation()); Data.refresh(); }},
      {label: tr('Watch from the screensaver'), toggle: Prefs.saverWatch(),
        step: function () { Prefs.set('saverWatch', !Prefs.saverWatch()); }},
      {label: tr('Weather widget'), toggle: Prefs.weather(),
        step: function () { Prefs.set('weather', !Prefs.weather()); renderPanels(); }},
      {label: tr('City'), value: Prefs.city() || '—', opens: true, city: true,
        step: function (d) { if (d >= 0) openCities(); }},
      {label: tr('Forecast'), value: Prefs.forecast() === 'days' ? tr('Next days') : tr('Next hours'),
        step: function (d) { cycle('forecast', ['hours', 'days'], Prefs.forecast(), d); renderPanels(); }},
      {label: tr('Quotes widget'), toggle: Prefs.quotes(),
        step: function () { Prefs.set('quotes', !Prefs.quotes()); Data.settingsChanged(); renderPanels(); }}
    ];
    var names = ['Bitcoin', 'Ethereum', 'Solana', tr('Dollar')];
    var count = Data.currency === 'BRL' ? 4 : 3;
    for (var i = 0; i < count; i++) {
      (function (i) {
        rows.push({label: names[i], toggle: Prefs.quotes() && Prefs.coin(i), dim: !Prefs.quotes(),
          step: function () { if (Prefs.quotes()) { Prefs.setCoin(i, !Prefs.coin(i)); Data.settingsChanged(); } }});
      })(i);
    }
    rows.push({label: tr('TMDB key'), value: Prefs.tmdbKey().length >= 4 ? '•••• ' + Prefs.tmdbKey().slice(-4) : tr('Not set'), opens: true, tmdb: true,
      step: function (d) { if (d >= 0) openKey(); }});
    var sv = Data.services();
    if (sv.length) {
      var someOff = false;   // only the services this TV has count
      for (var q = 0; q < sv.length; q++) someOff = someOff || Prefs.serviceOff(sv[q].key);
      rows.push({label: tr('Picks from'), value: someOff ? tr('services|Some') : tr('services|All'),
        step: function () { Prefs.set('servicesOff', []); Data.settingsChanged(); }});
      for (var j = 0; j < sv.length; j++) {
        (function (key, name) {
          rows.push({label: name, toggle: !Prefs.serviceOff(key),
            step: function () { Prefs.setServiceOff(key, !Prefs.serviceOff(key)); Data.refresh(); Data.settingsChanged(); }});
        })(sv[j].key, sv[j].name);
      }
    }
    if (nuvio()) {
      var open = Prefs.openPicks();
      rows.push({label: tr('Open picks in'), value: open === 'nuvio' ? 'Nuvio' : tr('Streaming apps'),
        step: function (d) { cycle('openPicks', ['apps', 'nuvio'], open, d); }});
    }
    rows.push({label: tr('Live TV button'), value: boxLabel(),
      step: function (d) { cycle('boxInput', ['live', 'hdmi1', 'hdmi2', 'hdmi3', 'hdmi4'], Prefs.boxInput(), d); renderTop(); }});
    rows.push({label: tr('Inputs'), value: '›', inputs: true, step: function (d) { if (d >= 0) openInputsEdit(); }});
    if (TV.canReturnHome) {
      rows.push({label: tr('Home button'), value: Prefs.homeReturns() ? 'Free My TV' : tr('home|TV home screen'),
        step: function () { Prefs.set('homeReturns', !Prefs.homeReturns()); TV.returnHome(Prefs.homeReturns()); }});
    }
    rows.push({label: tr('Shelf'), value: '›', shelf: true, step: function (d) { if (d >= 0) openShelfEdit(); }});
    rows.push({label: tr('About this TV'), value: '›', about: true, step: function (d) { if (d >= 0) openAbout(); }});
    if (TV.canOpenSettings) rows.push({label: tr('TV Settings'), value: '›', step: function (d) { if (d >= 0) tvSettings(); }});
    return rows;
  }

  function cycle(name, values, current, d) {
    var i = values.indexOf(current);
    Prefs.set(name, values[(i + (d || 1) + values.length) % values.length]);
  }

  var rowsNow = [];

  function renderSettings() {
    var box = $('settings').firstChild;
    box.innerHTML = '';
    var title = el('div', 'title', box);
    sym('settings', title);
    title.appendChild(document.createTextNode(tr('Home Settings')));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    rowsNow = settingRows();
    list.style.height = Math.min(rowsNow.length, 7) * 78 + 'px';
    for (var i = 0; i < rowsNow.length; i++) {
      var r = rowsNow[i], row = el('div', 'row' + (r.dim ? ' dim' : ''), holder, I18N.name(r.label));
      if (r.toggle !== undefined) setClass(el('div', 'toggle', row), 'on', r.toggle);
      else {
        var v = el('span', 'value', row);
        if (r.value === '›') v.textContent = '›';
        else if (r.opens) { v.appendChild(document.createTextNode(I18N.name(r.value))); el('span', 'chev', v, '›'); }
        else { el('span', 'chev', v, '‹'); v.appendChild(document.createTextNode(I18N.name(r.value))); el('span', 'chev', v, '›'); }
      }
      hover(row, Z.SETTINGS, i);
    }
    el('div', 'hint', box, tr('OK or the arrows change the value.'));
    updateFocus();
  }

  function openSettings() {
    st.zone = Z.SETTINGS;
    st.row = 0;
    renderSettings();
    setClass($('settings'), 'open', true);
    updateFocus();
  }

  // MARK: - Language: a list of every catalogue in its own name, as on Android (moving through it doesn't switch the app)

  var langHint = null;

  function languageChoices() {
    return ['auto'].concat(I18N.languages());
  }

  /** The language in use: "auto", or the catalogue the setting resolved to ("pt-BR" in config.properties is "pt"). */
  function pickedLanguage() {
    return Prefs.language() === 'auto' ? 'auto' : I18N.lang;
  }

  function renderLanguages() {
    var box = $('langpick').firstChild, choices = languageChoices(), current = choices.indexOf(pickedLanguage());
    box.innerHTML = '';
    el('div', 'title', box, tr('Language'));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = Math.min(choices.length, 7) * 78 + 'px';
    for (var i = 0; i < choices.length; i++) {
      var row = el('div', 'row', holder, choices[i] === 'auto' ? tr('Automatic') : I18N.languageName(choices[i]));
      if (i === current) sym('check', el('span', 'value', row));
      hover(row, Z.LANG, i);
    }
    langHint = el('div', 'hint', box);
    updateFocus();
  }

  function openLanguages() {
    setClass($('settings'), 'open', false);
    st.zone = Z.LANG;
    st.lang = Math.max(0, languageChoices().indexOf(pickedLanguage()));
    renderLanguages();
    setClass($('langpick'), 'open', true);
    updateFocus();
  }

  /** OK: the language under the focus; Back: none. Either way, back to Home Settings, on the Language row. */
  function closeLanguages(pick) {
    setClass($('langpick'), 'open', false);
    langHint = null;
    var code = languageChoices()[st.lang];
    if (pick && code !== pickedLanguage()) {
      Prefs.set('language', code);
      I18N.set(Prefs.language());
      direction();
      renderAll();
      Data.refresh();   // the picks' titles and genres come in the new language
    }
    openSettings();
    for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].language) st.row = i;
    updateFocus();
  }

  // MARK: - Text fields: typed with the TV's keyboard (the city, the TMDB key)

  /** A row with a text field; on the TV, the focus in it brings up the keyboard. */
  function textField(holder, zone, value, placeholder, label) {
    var field = el('input', '', el('div', 'row field', holder));
    field.type = 'text';
    field.value = value;
    field.placeholder = placeholder;
    field.setAttribute('aria-label', label);
    field.setAttribute('autocomplete', 'off');
    field.setAttribute('spellcheck', 'false');
    hover(field.parentNode, zone, 0);
    return field;
  }

  function fieldOf(sheet) { return $(sheet).querySelector('input'); }

  function typingIn(sheet) { var f = fieldOf(sheet); return !!f && document.activeElement === f; }

  /** Into the field: the TV shows its keyboard. */
  function openField(sheet) {
    var f = fieldOf(sheet);
    if (!f) return;
    f.focus();
    try { f.setSelectionRange(f.value.length, f.value.length); } catch (e) {}
  }

  function closeField(sheet) {
    if (typingIn(sheet)) fieldOf(sheet).blur();
  }

  // MARK: - City: typed with the TV's keyboard, found by Open-Meteo, as on Android (the weather is for its coordinates)

  var cityFound = [], cityStatus = '', cityTimer = 0, citySeq = 0;

  /** The field to type in, the Search row, then the places found. */
  function cityRows() { return 2 + cityFound.length; }

  function renderCities() {
    var box = $('citypick').firstChild, old = fieldOf('citypick'), typed = old ? old.value : '', inField = typingIn('citypick');
    box.innerHTML = '';
    el('div', 'title', box, tr('City'));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = Math.min(cityRows(), 7) * 78 + 'px';
    textField(holder, Z.CITY, typed, tr("Type the city's name"), tr('City'));
    var search = el('div', 'row', holder, tr('Search'));
    forward(el('span', 'value', search));
    hover(search, Z.CITY, 1);
    for (var i = 0; i < cityFound.length; i++) {
      var row = el('div', 'row', holder, cityFound[i].label);
      hover(row, Z.CITY, 2 + i);
    }
    el('div', 'hint', box, cityStatus || tr('OK picks, Back cancels.'));
    if (inField) openField('citypick');   // a message that went away while typing: the keyboard stays
    updateFocus();
  }

  function openCities() {
    setClass($('settings'), 'open', false);
    st.zone = Z.CITY;
    st.city = 0;
    cityFound = [];
    cityStatus = '';
    $('citypick').firstChild.innerHTML = '';
    renderCities();
    setClass($('citypick'), 'open', true);
    openField('citypick');
  }

  function setCityStatus(text) {
    cityStatus = text;
    clearTimeout(cityTimer);
    // Clears only the hint: a new render would rebuild the field and interrupt the TV's keyboard while someone types.
    if (text && text !== tr('Searching…')) cityTimer = setTimeout(function () {
      cityStatus = '';
      var hint = st.zone === Z.CITY && $('citypick').querySelector('.hint');
      if (hint) hint.textContent = tr('OK picks, Back cancels.');
    }, 4000);
    if (st.zone === Z.CITY) renderCities();
  }

  function searchCity() {
    var f = fieldOf('citypick'), name = f ? f.value : '';
    closeField('citypick');
    if (!name.trim()) { st.city = 0; openField('citypick'); updateFocus(); return; }
    if (cityStatus === tr('Searching…')) return;
    setCityStatus(tr('Searching…'));
    var mine = ++citySeq;   // an answer for a sheet already closed (and opened again) is dropped
    Data.findCity(name, function (err, found) {
      if (mine !== citySeq) return;
      if (st.zone !== Z.CITY) { cityStatus = ''; return; }
      cityFound = found || [];
      if (cityFound.length) st.city = 2;   // on the first place found
      setCityStatus(err ? trf("Couldn't search now: {error}", {error: err.message}) : cityFound.length ? '' : tr('No city with that name.'));
    });
  }

  /** OK on a place: the weather moves there. Back (pick false): nothing changes. Either way, back on the City row. */
  function closeCities(pick) {
    var place = pick && cityFound[st.city - 2];
    closeField('citypick');
    setClass($('citypick'), 'open', false);
    cityFound = [];
    citySeq++;
    clearTimeout(cityTimer);
    cityStatus = '';
    if (place) {
      Prefs.setCity(place.city, place.lat, place.lon);
      Data.cityChanged();
    }
    openSettings();
    for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].city) st.row = i;
    updateFocus();
  }

  function activateCity() {
    if (st.city === 0) openField('citypick');
    else if (st.city === 1) searchCity();
    else closeCities(true);
  }

  // MARK: - TMDB key: typed on the TV, so builds without one (the releases) get the picks too; TMDB checks it first

  var keyStatus = '', keyWarn = false, keyTimer = 0, keySeq = 0, keyAsking = false;

  function keyRows() { return keyAsking ? 2 : Prefs.tmdbKeyOnTV() ? 3 : 2; }

  function keySteps() {
    return tr("The key brings the picks: what's trending on your streaming apps, with their photos on the screensaver.") + '\n'
      + tr('Free, and it takes two minutes:') + '\n' + I18N.digits(1) + '. ' + tr('Create an account at themoviedb.org.')
      + '\n' + I18N.digits(2) + '. ' + tr('Open Settings → API and request a developer key.');
  }

  function renderKey() {
    var box = $('keypick').firstChild, old = fieldOf('keypick'), typed = old ? old.value : '', inField = typingIn('keypick');
    box.innerHTML = '';
    el('div', 'title', box, keyAsking ? tr('Remove the TMDB key?') : tr('TMDB key'));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = keyRows() * 78 + 'px';
    if (keyAsking) {
      hover(el('div', 'row', holder, tr('Cancel')), Z.KEY, 0);
      hover(el('div', 'row', holder, tr('Remove')), Z.KEY, 1);
      updateFocus();
      return;
    }
    var keyField = textField(holder, Z.KEY, typed, tr('API Read Access Token or API Key'), tr('TMDB key'));
    // A v3 key is lowercase hex: the TV's keyboard mustn't capitalize it (the city's field wants capitals).
    keyField.setAttribute('autocapitalize', 'none');
    keyField.setAttribute('autocorrect', 'off');
    var save = el('div', 'row', holder, tr('Save'));
    forward(el('span', 'value', save));
    hover(save, Z.KEY, 1);
    if (Prefs.tmdbKeyOnTV()) hover(el('div', 'row', holder, tr('Remove the key')), Z.KEY, 2);
    if (keyStatus) setClass(el('div', 'hint', box, keyStatus), 'warn', keyWarn);
    el('div', 'hint steps', box, keySteps());
    if (inField) openField('keypick');
    updateFocus();
  }

  function openKey() {
    setClass($('settings'), 'open', false);
    st.zone = Z.KEY;
    st.key = 0;
    keyStatus = '';
    keyAsking = false;
    $('keypick').firstChild.innerHTML = '';
    renderKey();
    setClass($('keypick'), 'open', true);
    openField('keypick');
  }

  function setKeyStatus(text, warn) {
    keyStatus = text;
    keyWarn = !!warn;
    clearTimeout(keyTimer);
    if (text && text !== tr('Checking the key with TMDB…')) keyTimer = setTimeout(function () {
      keyStatus = '';
      var line = st.zone === Z.KEY && $('keypick').querySelector('.hint:not(.steps)');
      if (line) line.parentNode.removeChild(line);
    }, 6000);
    if (st.zone === Z.KEY) renderKey();
  }

  function cleanKey(typed) {
    var key = typed.replace(/\s+/g, '');
    return /^[A-Za-z0-9._-]{16,1024}$/.test(key) ? key : '';
  }

  function saveKey() {
    var f = fieldOf('keypick'), typed = f ? f.value : '', key = cleanKey(typed);
    closeField('keypick');
    if (!typed.replace(/\s+/g, '')) { st.key = 0; openField('keypick'); updateFocus(); return; }
    if (keyStatus === tr('Checking the key with TMDB…')) return;
    if (!key) { setKeyStatus(tr("That doesn't look like a TMDB key."), true); return; }
    setKeyStatus(tr('Checking the key with TMDB…'));
    var mine = ++keySeq;   // an answer for a sheet already closed is dropped
    Data.checkKey(key, function (err) {
      if (mine !== keySeq || st.zone !== Z.KEY) return;
      if (err) { setKeyStatus(err.rejected ? tr('TMDB refused this key.') : trf("Couldn't reach TMDB: {error}", {error: err.message}), true); return; }
      Prefs.set('tmdbKey', key);
      if (fieldOf('keypick')) fieldOf('keypick').value = '';
      Data.keyChanged();
      setKeyStatus(tr('Saved. The picks arrive in a moment.'));
    });
  }

  /** Back to config.properties' key (none in the releases): the picks go. */
  function removeKey() {
    Prefs.set('tmdbKey', undefined);   // left out of the saved settings
    closeKey();
    Data.keyChanged();
  }

  /** Back on the TMDB key row of Home Settings. */
  function closeKey() {
    closeField('keypick');
    setClass($('keypick'), 'open', false);
    keySeq++;
    clearTimeout(keyTimer);
    keyStatus = '';
    keyAsking = false;
    var f = fieldOf('keypick');
    if (f) f.value = '';
    openSettings();
    for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].tmdb) st.row = i;
    updateFocus();
  }

  function askRemoveKey(on) {
    keyAsking = on;
    keyStatus = '';
    clearTimeout(keyTimer);
    st.key = on ? 0 : 2;
    renderKey();
  }

  function activateKey() {
    if (keyAsking) { if (st.key === 1) removeKey(); else askRemoveKey(false); }
    else if (st.key === 0) openField('keypick');
    else if (st.key === 1) saveKey();
    else askRemoveKey(true);
  }

  // MARK: - iCloud shared album: the link, and how the screensaver and the home background use it

  var albumRowsNow = [], albumStatus = '', albumWarn = false, albumTimer = 0, albumSeq = 0;
  var INTERVALS = [5, 10, 15, 30, 60];

  function icloudStatus() {
    if (!Prefs.icloudAlbum()) return tr('Not set');
    var err = ICloud.problem();
    if (err === 'offline') return tr('Offline');
    if (err === 'empty') return tr('No photos');
    if (err === 'refused' || err === 'invalid') return tr('Check the link');
    var title = ICloud.title();
    if (title.length > 28) title = title.substring(0, 27) + '…';
    return title || tr('Saved');
  }

  function icloudHint() {
    var err = ICloud.problem();
    if (albumStatus) return albumStatus;
    if (!Prefs.icloudAlbum()) return '';
    if (err === 'offline') return tr("Couldn't reach iCloud.");
    if (err === 'empty') return tr('This album has no photos.');
    if (err === 'refused' || err === 'invalid') return tr('iCloud refused this link.');
    return '';
  }

  function albumSteps() {
    return tr('On your iPhone, open the shared album, then Sharing Options, Anyone with the Link, and Copy Album Link.');
  }

  /** The field, Save, Remove when a link is kept, then the way the photos play. */
  function albumRows() {
    var rows = [{field: true}, {label: tr('Save'), save: true}];
    if (Prefs.icloudAlbum()) rows.push({label: tr('Remove the album'), remove: true});
    rows.push(
      {label: tr('iCloud screensaver'), toggle: Prefs.icloudSaver(), key: 'icloudSaver'},
      {label: tr('Home background'), toggle: Prefs.icloudHome(), key: 'icloudHome'},
      {label: tr('Photo every'), value: trf('{n} seconds', {n: Prefs.icloudInterval()}), interval: true},
      {label: tr('Shuffle'), toggle: Prefs.icloudShuffle(), key: 'icloudShuffle'},
      {label: tr('Transition'), value: Prefs.icloudKen() ? tr('Slow zoom') : tr('Crossfade'), transition: true},
      {label: tr('Framing'), value: Prefs.icloudFit() ? tr('Whole photo') : tr('Fill the screen'), framing: true},
      {label: tr('Clock'), toggle: Prefs.icloudClock(), key: 'icloudClock'}
    );
    return rows;
  }

  function renderAlbum() {
    var box = $('albumpick').firstChild, old = fieldOf('albumpick'), typed = old ? old.value : '', inField = typingIn('albumpick');
    box.innerHTML = '';
    el('div', 'title', box, tr('iCloud photos'));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    albumRowsNow = albumRows();
    list.style.height = Math.min(albumRowsNow.length, 7) * 78 + 'px';
    for (var i = 0; i < albumRowsNow.length; i++) {
      var r = albumRowsNow[i], row;
      if (r.field) {
        var field = textField(holder, Z.ALBUM, typed, tr('Paste the shared album link'), tr('iCloud photos'));
        field.setAttribute('autocapitalize', 'none');
        field.setAttribute('autocorrect', 'off');
        continue;
      }
      row = el('div', 'row', holder, r.label);
      if (r.toggle !== undefined) setClass(el('div', 'toggle', row), 'on', r.toggle);
      else if (r.value) {
        var v = el('span', 'value', row);
        el('span', 'chev', v, '‹');
        v.appendChild(document.createTextNode(r.value));
        el('span', 'chev', v, '›');
      } else forward(el('span', 'value', row));
      hover(row, Z.ALBUM, i);
    }
    var hint = icloudHint();
    if (hint) setClass(el('div', 'hint', box, hint), 'warn', albumWarn || (!albumStatus && !!ICloud.problem()));
    el('div', 'hint steps', box, albumSteps());
    if (inField) openField('albumpick');
    updateFocus();
  }

  function openAlbum() {
    setClass($('settings'), 'open', false);
    st.zone = Z.ALBUM;
    st.album = 0;
    albumStatus = '';
    albumWarn = false;
    $('albumpick').firstChild.innerHTML = '';
    renderAlbum();
    setClass($('albumpick'), 'open', true);
    openField('albumpick');
  }

  function setAlbumStatus(text, warn) {
    albumStatus = text;
    albumWarn = !!warn;
    clearTimeout(albumTimer);
    if (text && text !== tr('Checking the album…')) albumTimer = setTimeout(function () {
      albumStatus = '';
      if (st.zone === Z.ALBUM) renderAlbum();
    }, 6000);
    if (st.zone === Z.ALBUM) renderAlbum();
  }

  function closeAlbum() {
    closeField('albumpick');
    setClass($('albumpick'), 'open', false);
    albumSeq++;
    clearTimeout(albumTimer);
    albumStatus = '';
    albumWarn = false;
    var f = fieldOf('albumpick');
    if (f) f.value = '';
    openSettings();
    for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].icloud) st.row = i;
    updateFocus();
  }

  function saveAlbum() {
    var f = fieldOf('albumpick'), typed = f ? f.value : '';
    closeField('albumpick');
    if (!typed.replace(/^\s+|\s+$/g, '')) { st.album = 0; openField('albumpick'); updateFocus(); return; }
    if (!ICloud.parseLink(typed)) { setAlbumStatus(tr("That doesn't look like an iCloud album link."), true); return; }
    if (albumStatus === tr('Checking the album…')) return;
    setAlbumStatus(tr('Checking the album…'));
    var mine = ++albumSeq, previous = Prefs.icloudAlbum(), saverWas = Prefs.icloudSaver();
    var trimmed = typed.replace(/^\s+|\s+$/g, '');
    Prefs.set('icloudAlbum', trimmed);
    if (!previous) Prefs.set('icloudSaver', true);
    ICloud.sync(function () {
      if (mine !== albumSeq || st.zone !== Z.ALBUM) return;
      var err = ICloud.problem();
      // A link Apple doesn't know is put back, so a typo doesn't replace an album that was working.
      if (err === 'refused' || err === 'invalid') {
        Prefs.set('icloudAlbum', previous);
        Prefs.set('icloudSaver', saverWas);
        ICloud.sync();
        setAlbumStatus(tr('iCloud refused this link.'), true);
        return;
      }
      if (f) f.value = '';
      if (err === 'offline') setAlbumStatus(tr("Couldn't reach iCloud."), true);
      else if (err === 'empty') setAlbumStatus(tr('This album has no photos.'), true);
      else setAlbumStatus(tr('Saved. The screensaver can show these photos.'));
    });
  }

  function removeAlbum() {
    Prefs.set('icloudAlbum', '');
    Prefs.set('icloudSaver', false);
    Prefs.set('icloudHome', false);
    stopAlbumBackground();
    followSoon();
    ICloud.sync();
    closeAlbum();
  }

  function stepAlbum(row, d) {
    if (row.key) {
      Prefs.set(row.key, !Prefs[row.key]());
      if (row.key === 'icloudHome') { if (Prefs.icloudHome()) startAlbumBackground(); else { stopAlbumBackground(); followSoon(); } }
      if (row.key === 'icloudShuffle') ICloud.reframe();
      return;
    }
    if (row.interval) {
      var n = Prefs.icloudInterval(), i = INTERVALS.indexOf(n);
      if (i < 0) i = 1;
      Prefs.set('icloudInterval', INTERVALS[(i + (d || 1) + INTERVALS.length) % INTERVALS.length]);
      return;
    }
    if (row.transition) { Prefs.set('icloudTransition', Prefs.icloudKen() ? 'fade' : 'ken'); return; }
    if (row.framing) {
      Prefs.set('icloudAspect', Prefs.icloudFit() ? 'fill' : 'fit');
      redrawAlbumBackground();
    }
  }

  function activateAlbum() {
    var row = albumRowsNow[st.album];
    if (!row) return;
    if (row.field) openField('albumpick');
    else if (row.save) saveAlbum();
    else if (row.remove) removeAlbum();
    else { stepAlbum(row, 1); renderAlbum(); }
  }

  // MARK: - About this TV: what to quote when reporting a problem, without LG's or Samsung's slow menus

  function renderAbout(info) {
    var box = $('about').firstChild;
    box.innerHTML = '';
    el('div', 'title', box, tr('About this TV'));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    var rows = [
      [tr('Model'), info && info.model], [tr('Firmware'), info && info.firmware], [tr('System'), info && info.system],
      [tr('IP address'), info && info.ip], [tr('Time zone'), TV.zone()], ['Free My TV', info && info.version]
    ];
    for (var i = 0; i < rows.length; i++) {
      var row = el('div', 'row', holder), label = el('span', '', row, rows[i][0]);
      fitValue(row, label, el('span', 'value', row, info ? rows[i][1] || tr('Unavailable') : '…'));
    }
    el('div', 'hint', box, tr('Back closes.'));
  }

  /** A long value (Samsung's firmware) gets smaller instead of running over its label, and ends in "…" if even the smallest size is too wide. */
  function fitValue(row, label, value) {
    var room = row.clientWidth - label.offsetWidth - 2 * 24 - 24;   // the row's padding, and a gap after the label
    for (var size = 30; value.offsetWidth > room && size > 18; size -= 2) value.style.fontSize = size - 2 + 'px';
    if (value.offsetWidth > room) { value.style.maxWidth = room + 'px'; setClass(value, 'cut', true); }
  }

  function openAbout() {
    setClass($('settings'), 'open', false);
    st.zone = Z.ABOUT;
    renderAbout(null);
    setClass($('about'), 'open', true);
    updateFocus();
    TV.about(function (info) { if (st.zone === Z.ABOUT) renderAbout(info); });
  }

  function closeAbout() {
    setClass($('about'), 'open', false);
    openSettings();
    for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].about) st.row = i;
    updateFocus();
  }

  // MARK: - Shelf and inputs editors: which ones, in what order

  var editKind = 'shelf';   // which editor the sheet shows: 'shelf' (apps) or 'inputs'

  function editList() {
    var ids = shelf.map(function (a) { return a.id; });
    return {ids: ids, rows: apps.slice().sort(function (a, b) {
      var ia = ids.indexOf(a.id), ib = ids.indexOf(b.id);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1;
    })};
  }

  /** The inputs editor's rows: the shown ones in their order, then the hidden ones as the TV lists them. */
  function inputsEditList() {
    var shown = orderedInputs(), hidden = Prefs.inputsHidden(), rows = shown.slice();
    for (var i = 0; i < inputs.length; i++) if (hidden.indexOf(inputs[i].key) >= 0) rows.push(inputs[i]);
    return {keys: shown.map(function (x) { return x.key; }), rows: rows};
  }

  function renderEdit() {
    var forInputs = editKind === 'inputs';
    var box = $('shelfedit').firstChild, e = forInputs ? inputsEditList() : editList();
    box.innerHTML = '';
    var title = el('div', 'title', box);
    sym(forInputs ? 'hdmi' : 'apps', title);
    title.appendChild(document.createTextNode(forInputs ? tr('Inputs') : tr('Shelf')));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = Math.min(e.rows.length, 7) * 78 + 'px';
    for (var i = 0; i < e.rows.length; i++) {
      var item = e.rows[i], at = (forInputs ? e.keys : e.ids).indexOf(forInputs ? item.key : item.id);
      var row = el('div', 'row', holder, I18N.name(forInputs ? item.label || tr('Live TV') : item.title));
      var place = el('span', 'value', row, at >= 0 ? '#' + (at + 1) : tr('shelf|Off'));
      if (at >= 0) sym('check', place).style[rtl ? 'marginRight' : 'marginLeft'] = '16px';   // shown: a check, as in the pickers
      hover(row, Z.EDIT, i);
    }
    if (forInputs) el('div', 'hint', box, tr('OK shows or hides an input. ← → change the order.'));
    else el('div', 'hint', box, tr('OK adds or removes an app. ← → change the order.'));
    updateFocus();
  }

  function openEdit(kind) {
    setClass($('settings'), 'open', false);
    st.zone = Z.EDIT;
    st.edit = 0;
    editKind = kind;
    renderEdit();
    setClass($('shelfedit'), 'open', true);
    updateFocus();
  }

  function openShelfEdit() {
    openEdit('shelf');
  }

  function openInputsEdit() {
    openEdit('inputs');
  }

  function editShelf(dx) {
    var e = editList(), app = e.rows[st.edit];
    if (!app) return;
    var ids = e.ids.slice(), at = ids.indexOf(app.id);
    if (dx === 0) {
      if (at >= 0) ids.splice(at, 1);
      else ids.push(app.id);
    } else {
      if (at < 0) return;
      var to = Math.max(0, Math.min(ids.length - 1, at + dx));
      ids.splice(at, 1);
      ids.splice(to, 0, app.id);
    }
    Prefs.set('shelf', ids);
    pickShelf();
    renderShelf();
    var again = editList();
    for (var i = 0; i < again.rows.length; i++) if (again.rows[i].id === app.id) st.edit = i;
    renderEdit();
  }

  function editInputs(dx) {
    var e = inputsEditList(), x = e.rows[st.edit];
    if (!x) return;
    // The first change writes today's setup down, the Live TV switch's choice with it. So does every later one, for
    // an input the TV has started listing since: it's at the end, as the drawer shows it, and can then move or go.
    var order = (Prefs.inputsOrder() || []).slice(), hidden = Prefs.inputsHidden().slice();
    for (var k = 0; k < e.keys.length; k++) if (order.indexOf(e.keys[k]) < 0) order.push(e.keys[k]);
    if (dx === 0) {
      var at = order.indexOf(x.key);
      if (at >= 0) { order.splice(at, 1); hidden.push(x.key); }
      else {
        order.push(x.key);
        var h = hidden.indexOf(x.key);
        if (h >= 0) hidden.splice(h, 1);
      }
    } else {
      var at2 = e.keys.indexOf(x.key);
      if (at2 < 0) return;   // hidden inputs don't move
      var to = Math.max(0, Math.min(e.keys.length - 1, at2 + dx));
      if (to === at2) return;
      var at3 = order.indexOf(x.key);
      if (at3 >= 0) order.splice(at3, 1);
      var ni = order.indexOf(e.keys[to]);
      // An input the order doesn't know yet joins at the end, as the drawer shows it.
      if (ni < 0) order.push(x.key);
      else order.splice(dx > 0 ? ni + 1 : ni, 0, x.key);
    }
    Prefs.set('inputsOrder', order);
    Prefs.set('inputsHidden', hidden);
    renderDrawer();
    var again = inputsEditList();
    for (var i = 0; i < again.rows.length; i++) if (again.rows[i].key === x.key) st.edit = i;
    renderEdit();
  }

  // MARK: - Opening things

  /** Nuvio, when the TV has it: picks can open on its page there (Home Settings, Open picks in). LG only for now:
   *  Samsung's launch passes no data, so Nuvio would open on its Home. */
  function nuvio() {
    if (TV.name !== 'webos') return null;
    for (var i = 0; i < apps.length; i++) if (/nuvio/i.test(apps[i].id) || /^nuvio\b/i.test(apps[i].title)) return apps[i];
    return null;
  }

  function pickTarget(p) {
    if (!p) return null;
    if (p.resume) return {app: {id: p.appId, title: p.title}, params: null};
    var via = Prefs.openPicks() === 'nuvio' ? nuvio() : null;
    var app = via || Data.appFor(p.app);
    if (!app) return null;
    // Nuvio's own link for the title, as on Android (nuvio://tmdb/movie/603); webOS apps get links as contentTarget.
    return {app: app, params: via ? {contentTarget: 'nuvio://tmdb/' + (p.kind === 'tv' ? 'series' : 'movie') + '/' + p.id} : null};
  }

  /**
   * Opens a pick's target: in Nuvio as picked, else its app, on its title where this TV's app takes one and Watchmode
   * knows it (watchmode_key; on Samsung, Prime Video: TV.takesTitle). LG opens the app as before.
   */
  function openTarget(p, target) {
    if (!target) return;
    if (target.params || !p || !TV.takesTitle(p.app)) { launcher(target.app.id, target.app.title, target.params)(); return; }
    var mine = p.kind + ':' + p.id;
    if (lookingUp === mine) return;   // OK again while Watchmode answers (up to 4 s): one lookup, one launch
    lookingUp = mine;
    Data.titleLink(p, function (link) {
      if (lookingUp !== mine) return;   // something else was opened meanwhile: that one stays in front
      launcher(target.app.id, target.app.title, link ? {link: link, service: p.app} : null)();
    });
  }

  var lookingUp = '';   // the pick whose title Watchmode is being asked for, until something is opened

  function launcher(id, name, params) {
    return function () {
      lookingUp = '';
      if (typeof Glance !== 'undefined') Glance.noteLaunch(id, name);
      reportStatus();
      TV.launch(id, params || null, function (ok) {
        if (!ok) toast(trf("Couldn't open {app}.", {app: I18N.name(name || id)}));
      });
    };
  }

  function tvSettings() {
    TV.settings(function (ok) {
      if (!ok) toast(tr("Couldn't open TV Settings"));
    });
  }

  function inputByKey(key) {
    for (var i = 0; i < inputs.length; i++) if (inputs[i].key === key) return inputs[i];
    return null;
  }

  function liveTV() {
    return inputByKey('live');
  }

  /** The drawer's inputs: the person's order (Home Settings > Inputs), one the order doesn't know yet at the end,
   *  the hidden ones out. An input the TV no longer lists keeps its place in the saved order and is skipped here. */
  function orderedInputs() {
    var order = Prefs.inputsOrder(), hidden = Prefs.inputsHidden(), out = [], placed = {}, i, x;
    if (order) {
      for (i = 0; i < order.length; i++) {
        x = inputByKey(order[i]);
        if (x && !placed[x.key] && hidden.indexOf(x.key) < 0) { out.push(x); placed[x.key] = true; }
      }
    }
    for (i = 0; i < inputs.length; i++) {
      x = inputs[i];
      if (!placed[x.key] && hidden.indexOf(x.key) < 0) { out.push(x); placed[x.key] = true; }
    }
    return out;
  }

  /** Where the HDMI Inputs button lands in the drawer: the first HDMI port shown, wherever Home Settings > Inputs put
   *  it; with none shown, the drawer's first tile. */
  function firstPort() {
    var shown = orderedInputs();
    for (var i = 0; i < shown.length; i++) if (shown[i].key !== 'live') return i;
    return 0;
  }

  /** The input the first top button opens, picked in Home Settings > Live TV button: Live TV or an HDMI port. */
  function boxTV() {
    var want = Prefs.boxInput();
    for (var i = 0; i < inputs.length; i++) if (inputs[i].key === want) return inputs[i];
    return liveTV();
  }

  /** Its name, for the button's tip and the settings row: the TV's own ("HDMI 2", or a name the person gave the input). */
  function boxLabel() {
    var box = boxTV();
    return box && box !== liveTV() && box.label ? box.label : tr('Live TV');
  }

  function activate() {
    switch (st.zone) {
      case Z.TOP:
        if (st.top < 3) return;
        if (st.top === 3) startScreen();
        else if (st.top === 4) { var box2 = boxTV(); if (box2) launcher(box2.id, boxLabel())(); }
        else if (st.top === 5) { st.zone = Z.SHELF; openDrawer(); st.drawer = firstPort(); updateFocus(); }
        else openSettings();
        return;
      case Z.CARDS:
        openTarget(cards[st.card], pickTarget(cards[st.card]));
        return;
      case Z.SHELF:
        if (shelf[st.shelf]) launcher(shelf[st.shelf].id, shelf[st.shelf].title)();
        return;
      case Z.DRAWER:
        if (drawerItems[st.drawer]) drawerItems[st.drawer].run();
        return;
      case Z.APPS:
        if (others[st.grid]) launcher(others[st.grid].id, others[st.grid].title)();
        return;
      case Z.SETTINGS:
        if (rowsNow[st.row]) { rowsNow[st.row].step(1); if (st.zone === Z.SETTINGS) renderSettings(); }
        return;
      case Z.EDIT:
        if (editKind === 'inputs') editInputs(0);
        else editShelf(0);
        return;
      case Z.LANG:
        closeLanguages(true);
        return;
      case Z.CITY:
        activateCity();
        return;
      case Z.KEY:
        activateKey();
        return;
      case Z.ALBUM:
        activateAlbum();
        return;
      case Z.TEXT:
        if (st.text === textRows() - 1) saveText();
        else {
          var inputs = $('textpick').querySelectorAll('input');
          if (inputs[st.text]) inputs[st.text].focus();
        }
        return;
      case Z.ABOUT:
        closeAbout();
        return;
    }
  }

  function selectTab(i) {
    if (i === st.tab) return;
    st.tab = i;
    // A tab opens at its first pick, its row at the start: at once, as on Android, not sliding from the last tab's place.
    st.card = 0;
    var holder = $('cards');
    holder.style.webkitTransition = holder.style.transition = 'none';
    renderCards();
    layoutCards();   // renderCards returns early when this tab's picks are the same
    void holder.offsetWidth;   // the row is laid out where it lands before the slide comes back
    holder.style.webkitTransition = holder.style.transition = '';
  }

  function move(dx, dy) {
    var tiles = $('tiles').children, cardNodes = $('cards').children;
    // Mirrored, the screen's left is the way forward: ← goes to the next one, and in the shelf's and the inputs' editors
    // to a later place (the rows they order run from the right). Settings' values keep their arrows.
    if (rtl && (st.zone === Z.SHELF || st.zone === Z.CARDS || st.zone === Z.TOP || st.zone === Z.DRAWER || st.zone === Z.APPS || st.zone === Z.EDIT)) dx = -dx;
    switch (st.zone) {
      case Z.SHELF:
        if (dx) st.shelf = Math.max(0, Math.min(shelf.length - 1, st.shelf + dx));
        else if (dy > 0) { openDrawer(); return; }
        else if (dy < 0) {
          if (Prefs.homeShow() === 'picks' && cards.length) { st.zone = Z.CARDS; st.card = nearest(cardNodes, centerX(tiles[st.shelf])); }
          else { st.zone = Z.TOP; st.top = Data.hasKey() ? st.tab : 3; }
        }
        break;
      case Z.CARDS:
        if (dx) st.card = Math.max(0, Math.min(cards.length - 1, st.card + dx));
        else if (dy < 0) { st.zone = Z.TOP; st.top = st.tab; }
        else if (shelf.length) { st.zone = Z.SHELF; st.shelf = nearest(tiles, centerX(cardNodes[st.card])); }
        break;
      case Z.TOP:
        if (dx) {
          st.top = Math.max(Data.hasKey() ? 0 : 3, Math.min(6, st.top + dx));   // without the picks the tabs can't hold focus
          if (st.top < 3) selectTab(st.top);   // as on Apple TV: focusing a tab selects it
        } else if (dy > 0) {
          if (Prefs.homeShow() === 'picks' && cards.length) { st.zone = Z.CARDS; st.card = Math.min(cards.length - 1, st.top < 3 ? 0 : cards.length - 1); }
          else st.zone = Z.SHELF;
        }
        break;
      case Z.DRAWER:
        if (dx) st.drawer = Math.max(0, Math.min(drawerItems.length - 1, st.drawer + dx));
        else if (dy < 0) { closeDrawer(); return; }
        break;
      case Z.APPS:
        var g = st.grid + dx + dy * 5;
        if (g >= 0 && g < others.length && (dx === 0 || Math.floor(g / 5) === Math.floor(st.grid / 5))) st.grid = g;
        break;
      case Z.SETTINGS:
        if (dy) st.row = Math.max(0, Math.min(rowsNow.length - 1, st.row + dy));
        else if (dx && rowsNow[st.row]) {
          var r = rowsNow[st.row];
          // A row that opens a list opens toward its chevron, which points left when mirrored.
          if (r.value !== '›') { r.step(rtl && r.opens ? -dx : dx); if (st.zone === Z.SETTINGS) renderSettings(); }
        }
        break;
      case Z.EDIT:
        var editRows = editKind === 'inputs' ? inputsEditList().rows : editList().rows;
        if (dy) st.edit = Math.max(0, Math.min(editRows.length - 1, st.edit + dy));
        else if (dx) { if (editKind === 'inputs') editInputs(dx); else editShelf(dx); }
        break;
      case Z.LANG:
        if (dy) st.lang = Math.max(0, Math.min(languageChoices().length - 1, st.lang + dy));
        break;
      case Z.CITY:
        if (dy) st.city = Math.max(0, Math.min(cityRows() - 1, st.city + dy));
        break;
      case Z.KEY:
        if (dy) st.key = Math.max(0, Math.min(keyRows() - 1, st.key + dy));
        break;
      case Z.ALBUM:
        if (dy) st.album = Math.max(0, Math.min(albumRowsNow.length - 1, st.album + dy));
        else if (dx && albumRowsNow[st.album] && !albumRowsNow[st.album].field && !albumRowsNow[st.album].save && !albumRowsNow[st.album].remove) {
          stepAlbum(albumRowsNow[st.album], dx);
          renderAlbum();
        }
        break;
      case Z.TEXT:
        if (dy) st.text = Math.max(0, Math.min(textRows() - 1, st.text + dy));
        break;
    }
    updateFocus();
  }

  function back() {
    if (st.zone === Z.EDIT) {
      setClass($('shelfedit'), 'open', false);
      openSettings();
      // Back lands on the row that opened the editor, whatever follows it.
      for (var i = 0; i < rowsNow.length; i++) if (editKind === 'inputs' ? rowsNow[i].inputs : rowsNow[i].shelf) st.row = i;
      updateFocus();
      return;
    }
    if (st.zone === Z.LANG) { closeLanguages(false); return; }
    if (st.zone === Z.CITY) { closeCities(false); return; }
    if (st.zone === Z.KEY) { if (keyAsking) askRemoveKey(false); else closeKey(); return; }
    if (st.zone === Z.ALBUM) { closeAlbum(); return; }
    if (st.zone === Z.TEXT) { closeText(); return; }
    if (st.zone === Z.ABOUT) { closeAbout(); return; }
    if (sheetOpen()) { closeSheets(); return; }
    if (st.zone === Z.DRAWER) { closeDrawer(); return; }
    if (st.zone !== Z.SHELF && shelf.length) { st.zone = Z.SHELF; updateFocus(); return; }
    TV.back();
  }

  /** The pointer focuses what it's over (the Magic Remote, or a mouse when previewing). */
  function hover(node, zone, index) {
    node.onmouseover = function () {
      if (saverOn || (sheetOpen() !== (zone === Z.APPS || zone === Z.SETTINGS || zone === Z.EDIT || zone === Z.LANG || zone === Z.CITY || zone === Z.KEY || zone === Z.ALBUM || zone === Z.ABOUT || zone === Z.TEXT))) return;
      if (zone === Z.DRAWER && st.zone !== Z.DRAWER) return;
      if (zone !== Z.DRAWER && st.zone === Z.DRAWER && zone !== Z.SHELF) return;
      if (zone === Z.TOP && index < 3 && !Data.hasKey()) return;   // the tabs are hidden without the picks
      if (zone === Z.SHELF && st.zone === Z.DRAWER) closeDrawer();
      st.zone = zone;
      if (zone === Z.TOP) { st.top = index; if (index < 3) selectTab(index); }
      else if (zone === Z.CARDS) st.card = index;
      else if (zone === Z.SHELF) st.shelf = index;
      else if (zone === Z.DRAWER) st.drawer = index;
      else if (zone === Z.APPS) st.grid = index;
      else if (zone === Z.SETTINGS) st.row = index;
      else if (zone === Z.EDIT) st.edit = index;
      else if (zone === Z.LANG) st.lang = index;
      else if (zone === Z.CITY) st.city = index;
      else if (zone === Z.KEY) st.key = index;
      else if (zone === Z.ALBUM) st.album = index;
      updateFocus();
    };
    node.onclick = function () { node.onmouseover(); activate(); };
  }

  // MARK: - Toast

  var toastTimer = 0;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    setClass(t, 'on', true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { setClass(t, 'on', false); }, 6000);
  }

  // MARK: - Night, clock, screensaver

  var lastNight = null;

  function checkNight() {
    var night = Data.isNight(Date.now());
    setClass(body, 'night', night);
    if (night === lastNight) return;
    lastNight = night;
    document.documentElement.style.background = night ? '#0B0B0D' : '';
    try { localStorage.setItem('fmtv.night', night ? 'true' : 'false'); } catch (e) {}   // for index.html, next start
  }

  var saverOn = false, idleAt = Date.now(), saverIndex = 0, saverTimer = 0, saverPick = null, SAVER_AFTER = 5 * 60000;

  /** "photos" (the picks' photos, as it always was) or "clock": what the screen shows when nobody touches it. */
  function saverMode() { return Prefs.saver(); }

  function saverLabel() {
    var m = saverMode();
    return m === 'clock' ? tr('Clock') : m === 'live' ? tr('Live weather') : tr('Photos');
  }

  function liveQualityLabel() {
    var q = Prefs.liveQuality();
    return q === 'low' ? tr('dim|Low') : q === 'high' ? tr('dim|High') : tr('dim|Medium');
  }

  function homeShowLabel() {
    var m = Prefs.homeShow();
    return m === 'weather' ? tr('Live weather') : m === 'photos' ? tr('Photos') : tr('Recommendations');
  }

  function liveForceLabel() {
    var f = Prefs.liveForce();
    if (f === 'rain') return tr('Rain');
    if (f === 'storm') return tr('Thunderstorms');
    if (f === 'snow') return tr('Snow');
    if (f === 'fog') return tr('Fog');
    if (f === 'clear') return tr('Clear');
    if (f === 'night') return tr('Clear night');
    return tr('Automatic');
  }

  /** Dim, as the person picked it: off, low, medium, high, or automatic (medium from 22:00 to 07:00). */
  function dimName() {
    var v = Prefs.dim();
    return v === 'low' ? tr('dim|Low') : v === 'medium' ? tr('dim|Medium') : v === 'high' ? tr('dim|High')
      : v === 'auto' ? tr('Automatic') : tr('Off');
  }

  function dimLevel() {
    var v = Prefs.dim();
    if (v === 'auto') { var h = new Date().getHours(); return h >= 22 || h < 7 ? 2 : 0; }
    return v === 'low' ? 1 : v === 'medium' ? 2 : v === 'high' ? 3 : 0;
  }

  /** The panel's brightness is a private API: this is a black layer over the picture instead. */
  function applyDim() {
    var level = dimLevel();
    $('dim').className = 'layer' + (level ? ' d' + level : '');
  }

  /** The screensaver's photos: picks with an app on the TV. */
  function saverPhotos() {
    return Data.showcase().filter(function (p) { return p.backdrop && Data.usable(p.app); });
  }

  var saverGen = 0;

  /** A picture address safe to put in a CSS url(). Apple's are already escaped; anything odd is skipped. */
  function cssUrl(url) {
    if (!url || /["'()\\\s]/.test(url)) return '';
    return 'url("' + url + '")';
  }

  function resetSaverChrome() {
    var s = $('saver');
    setClass(s, 'album', false);
    setClass(s, 'fit', false);
    setClass(s, 'noclock', false);
  }

  /** The picks' photos, as the screensaver has always shown them. */
  function showPickSaver() {
    var photos = saverPhotos();
    saverOn = true;
    saverPick = null;
    var s = $('saver');
    s.innerHTML = '';
    resetSaverChrome();
    var a = el('div', 'photo', s), b = el('div', 'photo', s);
    el('div', 'shade', s);
    var clock = el('div', 'clock', s);
    el('div', 'time', clock);
    el('div', 'date', clock);
    el('div', 'title', clock);
    var hint = el('div', 'hint', clock);
    var front = a;
    function next() {
      if (!saverOn) return;
      var p = photos.length ? photos[saverIndex++ % photos.length] : null;
      var back = front === a ? b : a;
      if (p) {
        back.style.backgroundImage = 'url(' + Data.image(p.backdrop, 'original') + ')';
        back.style.webkitTransform = back.style.transform = 'scale(1.0)';
        clock.children[2].textContent = I18N.name(p.title);
        saverPick = p;
        // With Watch from the screensaver on, OK opens this title's app (any other key only closes).
        var target = Prefs.saverWatch() ? pickTarget(p) : null;
        hint.textContent = target ? trf('Press OK to watch on {app} · any other button to close', {app: I18N.name(target.app.title)}) : '';
        setTimeout(function () {
          setClass(back, 'on', true);
          setClass(front, 'on', false);
          back.style.webkitTransform = back.style.transform = 'scale(1.08) translateX(-1.5%)';
          front = back;
        }, 60);
      }
      tickSaverClock(clock);
      saverTimer = setTimeout(next, 12000);
    }
    setClass(s, 'on', true);
    next();
    syncLive();
  }

  /** Where a slow zoom starts and ends. Fill moves further; fit stays gentle so the letterbox isn't cropped away. */
  function kenAt(index, end, fit) {
    var odd = index % 2;
    if (fit) return end ? (odd ? 'scale(1.04) translate(-1%, 0)' : 'scale(1.04) translate(1%, 0)') : 'scale(1)';
    if (end) return odd ? 'scale(1.06) translate(-2%, -1%)' : 'scale(1.14) translate(1.5%, 1%)';
    return odd ? 'scale(1.12) translate(1.5%, 1%)' : 'scale(1.06) translate(-1%, -1%)';
  }

  /** The shared album, full screen: a crossfade, and a slow zoom when that transition is picked. */
  function showAlbumSaver() {
    var list = ICloud.playlist();
    if (!list.length) { showPickSaver(); return; }
    saverOn = true;
    saverPick = null;
    var s = $('saver'), gen = ++saverGen;
    s.innerHTML = '';
    setClass(s, 'album', true);
    setClass(s, 'fit', Prefs.icloudFit());
    setClass(s, 'noclock', !Prefs.icloudClock());
    var a = el('div', 'photo', s), b = el('div', 'photo', s);
    el('div', 'shade', s);
    var clock = el('div', 'clock', s);
    el('div', 'time', clock);
    el('div', 'date', clock);
    var front = a, index = 0, skips = 0;
    function fallback() {
      hideSaver();
      if (saverMode() === 'clock') showAmbient(); else showPickSaver();
    }
    function advance() {
      if (!saverOn || gen !== saverGen) return;
      list = ICloud.playlist();
      if (!list.length) { fallback(); return; }
      if (index > 0 && index % list.length === 0 && Prefs.icloudShuffle()) ICloud.reshuffle();
      list = ICloud.playlist();
      if (!list.length) { fallback(); return; }
      var photo = list[index % list.length], n = index++;
      shownPhoto = photo.url || '';
      reportStatus();
      var back = front === a ? b : a;
      var ken = Prefs.icloudKen(), fit = Prefs.icloudFit(), ms = Prefs.icloudInterval() * 1000;
      var shown = cssUrl(photo.url);
      var img = new Image();
      img.onload = function () {
        if (!saverOn || gen !== saverGen || !shown) return;
        skips = 0;
        back.style.backgroundImage = shown;
        back.style.webkitTransition = back.style.transition = 'none';
        back.style.webkitTransform = back.style.transform = ken ? kenAt(n, false, fit) : 'scale(1)';
        setTimeout(function () {
          if (!saverOn || gen !== saverGen) return;
          var fade = 'opacity 1.2s ease' + (ken ? ', -webkit-transform ' + ms + 'ms linear' : '');
          back.style.webkitTransition = fade;
          back.style.transition = 'opacity 1.2s ease' + (ken ? ', transform ' + ms + 'ms linear' : '');
          setClass(back, 'on', true);
          setClass(front, 'on', false);
          if (ken) back.style.webkitTransform = back.style.transform = kenAt(n, true, fit);
          front = back;
        }, 40);
      };
      img.onerror = function () {
        if (!saverOn || gen !== saverGen) return;
        ICloud.noteBroken();
        if (++skips >= list.length) { fallback(); return; }
        clearTimeout(saverTimer);
        advance();
      };
      saverTimer = setTimeout(advance, ms);
      tickSaverClock(clock);
      if (shown) img.src = photo.url;
      else img.onerror();
    }
    setClass(s, 'on', true);
    advance();
    syncLive();
  }

  var ambientGlass = false, ambientKind = '', calendarAt = 0, shownPhoto = '', statusSig = '';

  function showMorning() {
    ambientGlass = true;
    if (ICloud.count()) showAlbumSaver();
    else showLiveSaver();
  }

  function showSaver() {
    if (Prefs.icloudSaver() && ICloud.count()) showAlbumSaver();
    else showPickSaver();
  }

  function startScreen() {
    var ph = Glance.phase(new Date().getHours(), {
      morning: Prefs.ambientHour('ambientMorning', 6),
      day: Prefs.ambientHour('ambientDay', 11),
      evening: Prefs.ambientHour('ambientEvening', 17),
      night: Prefs.ambientHour('ambientNight', 22)
    });
    if (ph === 'morning') showMorning();
    else if (ph === 'evening') showAmbient('evening');
    else if (ph === 'night') showAmbient('night');
    else if (saverMode() === 'live') showLiveSaver();
    else if (Prefs.icloudSaver() && ICloud.count()) showAlbumSaver();
    else if (saverMode() === 'clock') showAmbient('clock');
    else showSaver();
  }

  function tickSaverClock(clock) {
    var d = new Date();
    clock.firstChild.textContent = formatDate('format|h:mm', d.getTime());
    clock.children[1].textContent = formatDate('format|EEEE, MMMM d', d.getTime());
  }

  function hideSaver() {
    saverOn = false;
    ambientGlass = false;
    shownPhoto = '';
    saverGen++;
    clearTimeout(saverTimer);
    setClass($('saver'), 'on', false);
    syncLive();
    reportStatus();
  }

  /** The forecast, as drops and a sky. Full screen when the screensaver is Live weather; otherwise only the drops. */
  function pushScene() {
    var w = Data.weather, force = Prefs.liveForce();
    var code = w ? w.code : 0, day = w ? w.isDay : true;
    var mm = w ? Data.nextHourMm() : null;
    if ((mm === null || mm === 0) && w && w.precip) mm = w.precip;
    LiveWeather.scene({
      kind: LiveWeather.kind(code, force),
      night: LiveWeather.night(day, force),
      rate: LiveWeather.rate(mm, LiveWeather.kind(code, force) === 'rain' || LiveWeather.kind(code, force) === 'storm' || LiveWeather.kind(code, force) === 'snow'),
      wind: w && w.wind || 0,
      dir: w && w.windDir || 0
    });
    renderLiveInfo();
  }

  function syncLive() {
    var full = saverOn && saverMode() === 'live';
    var over = !full && !ambientOn && !sheetOpen() && ((saverOn && Prefs.livePhotos()) || (!saverOn && Prefs.liveHome()));
    if (document.hidden || resting()) {
      LiveWeather.setMode('off');
      setClass($('liveinfo'), 'on', false);
      setClass(body, 'weather-home', false);
      return;
    }
    var row = !saverOn && !ambientOn && !sheetOpen() && Prefs.homeShow() === 'weather';
    if (full) LiveWeather.setMode('full', Prefs.liveQuality());
    else if (saverOn && (Prefs.livePhotos() || ambientGlass)) LiveWeather.setMode('glass', Prefs.liveQuality());
    else if (row) LiveWeather.setMode('row', Prefs.liveQuality());
    else if (!saverOn && !ambientOn && !sheetOpen() && Prefs.liveHome()) LiveWeather.setMode('overlay', Prefs.liveQuality());
    else LiveWeather.setMode('off');
    pushScene();
    setClass(body, 'weather-home', LiveWeather.mode() === 'overlay');
    setClass($('liveinfo'), 'on', full || row);
    setClass($('liveinfo'), 'tucked', row);
    if (full || over || row) LiveWeather.refreshAlert(Prefs.latitude(), Prefs.longitude());
    reportStatus();
  }

  function renderLiveInfo() {
    var box = $('liveinfo'), w = Data.weather;
    if (!box) return;
    box.innerHTML = '';
    if (!w) { el('div', 'cond', box, tr('No weather data right now.')); return; }
    el('div', 'temp', box, Data.degrees(w.temp));
    el('div', 'cond', box, Data.condition(w.code, w.isDay));
    var feels = typeof w.feels === 'number' ? trf('Feels like {temp}', {temp: Data.degrees(w.feels)}) : '';
    var meta = (feels ? feels + '   ' : '') + trf('H:{max}', {max: Data.degrees(w.max)}) + '   ' + trf('L:{min}', {min: Data.degrees(w.min)});
    el('div', 'meta', box, meta);
    var mm = Data.nextHourMm();
    if (mm > 0) el('div', 'meta', box, trf('{n} mm in the next hour', {n: Math.round(mm * 10) / 10}));
    var alert = LiveWeather.alert();
    if (alert) el('div', 'alert', box, alert);
    if (Prefs.liveForce() !== 'auto') el('div', 'meta', box, tr('Preview') + ' · ' + liveForceLabel());
  }

  var homePhotoTimer = 0, homePhotoAt = 0;

  function applyHomeContent() {
    var mode = Prefs.homeShow();
    setClass(body, 'content-weather', mode === 'weather');
    setClass(body, 'content-photos', mode === 'photos');
    if (mode !== 'picks' && st.zone === Z.CARDS) st.zone = Z.SHELF;
    if (mode === 'photos') startHomePhotos();
    else stopHomePhotos();
    syncLive();
    updateFocus();
  }

  function startHomePhotos() {
    if (homePhotoTimer) return;
    function step() {
      if (Prefs.homeShow() !== 'photos') { homePhotoTimer = 0; return; }
      var box = $('homephotos'), list = ICloud.playlist();
      if (!list.length) {
        box.style.backgroundImage = '';
        box.textContent = tr('No album yet');
      } else {
        var photo = list[homePhotoAt % list.length];
        homePhotoAt++;
        shownPhoto = photo.url || '';
        reportStatus();
        var shown = cssUrl(photo.url);
        box.textContent = '';
        if (shown) box.style.backgroundImage = shown;
      }
      homePhotoTimer = setTimeout(step, Math.max(Prefs.icloudInterval(), 8) * 1000);
    }
    step();
  }

  function stopHomePhotos() {
    clearTimeout(homePhotoTimer);
    homePhotoTimer = 0;
  }

  function showLiveSaver() {
    hideAmbient();
    saverOn = true;
    saverPick = null;
    var s = $('saver');
    s.innerHTML = '';
    resetSaverChrome();
    setClass(s, 'on', true);
    syncLive();
  }

  // MARK: - The clock screensaver: a clock, the date and the weather, drifting slowly for OLED panels

  var ambientOn = false, ambientTimer = 0;

  function showAmbient(kind) {
    kind = kind || 'clock';
    if (ambientOn && ambientKind === kind) return;
    if (ambientOn) { ambientOn = false; clearInterval(ambientTimer); }
    var a = $('ambient');
    a.innerHTML = '';
    var shift = el('div', 'shift', a);
    el('div', 'clock', shift);
    el('div', 'date', shift);
    var side = el('div', 'side', shift);
    el('div', 'temp', side);
    el('div', 'cond', side);
    if (kind === 'evening') el('div', 'event', shift);
    ambientKind = kind;
    setClass(a, 'late', kind === 'night');
    setClass(a, 'evening', kind === 'evening');
    ambientOn = true;
    setClass(a, 'on', true);
    ambientTimer = setInterval(tickAmbient, 30000);
    tickAmbient();
    syncLive();
    reportStatus();
  }

  function tickAmbient() {
    if (!ambientOn) return;
    var a = $('ambient'), d = new Date(), w = Prefs.weather() ? Data.weather : null;
    a.querySelector('.clock').textContent = formatDate('format|h:mm', d.getTime());
    a.querySelector('.date').textContent = formatDate('format|EEEE, MMMM d', d.getTime());
    // The forecast as it is now (a new one comes every 30 minutes), and only with the weather card on, as on Android.
    a.querySelector('.temp').textContent = w ? Data.degrees(w.temp) : '';
    a.querySelector('.cond').textContent = w ? Data.condition(w.code, w.isDay) : '';
    var ev = a.querySelector('.event'), item = Glance.event();
    if (ev) ev.textContent = item ? (formatDate('format|h:mm', item.start) + '  ' + item.title) : (Prefs.icalUrl() ? tr('Nothing coming up') : '');
    // A clock that never moves burns into an OLED: the drift of Android's clock without photos (40 × 26 px, 10 minutes).
    var phase = 2 * Math.PI * (d.getTime() / 1000 % 600) / 600, shift = a.querySelector('.shift');
    shift.style.webkitTransform = shift.style.transform =
      'translate(' + Math.round(40 * Math.sin(phase)) + 'px,' + Math.round(26 * Math.sin(2 * phase + 0.7)) + 'px)';
  }

  function reportStatus(force) {
    if (typeof Glance === 'undefined' || !Prefs.wizUrl() || resting()) return;
    var view = 'home';
    if (sheetOpen()) view = 'settings';
    else if (ambientOn) view = 'ambient';
    else if (saverOn) view = 'screensaver';
    var saverType = '';
    if (saverOn) {
      var saver = $('saver');
      if (saver && saver.className.indexOf('album') >= 0) saverType = 'album';
      else if (LiveWeather.mode() === 'full') saverType = 'live';
      else saverType = saverMode();
    }
    if (view === 'home' && Prefs.homeShow() === 'photos' && shownPhoto) saverType = 'album';
    else if (view === 'home' && Prefs.homeShow() === 'weather') saverType = 'live';
    var recent = Glance.recent(), last = recent.length ? recent[0] : null, w = Data.weather;
    var card = st.zone === Z.CARDS ? cards[st.card] : null;
    var app = (card && card.resume) ? {name: card.title, title: card.title} : (last ? {name: last.title, title: last.title} : null);
    var photo = saverType === 'album' ? shownPhoto : '';
    var sig = view + '|' + (ambientOn ? ambientKind : '') + '|' + saverType + '|' + photo + '|' +
      (app ? app.name : '') + '|' + (w ? Data.degrees(w.temp) + Data.condition(w.code, w.isDay) : '');
    if (!force && sig === statusSig) return;
    statusSig = sig;
    Glance.pushStatus({
      at: Date.now(),
      view: view,
      ambient: ambientOn ? (ambientKind || '') : '',
      saver: saverType,
      photo: photo,
      weather: w ? {temp: Data.degrees(w.temp), condition: Data.condition(w.code, w.isDay)} : null,
      app: app
    });
  }

  function hideAmbient() {
    ambientOn = false;
    ambientKind = '';
    clearInterval(ambientTimer);
    setClass($('ambient'), 'on', false);
    syncLive();
    reportStatus();
  }

  function poke(ok) {
    idleAt = Date.now();
    if (ambientOn) { hideAmbient(); return true; }
    if (!saverOn) return false;
    var target = ok && Prefs.saverWatch() ? pickTarget(saverPick) : null, watched = saverPick;
    hideSaver();
    openTarget(watched, target);
    return true;
  }

  // MARK: - Keys

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (poke(k === TV.keys.ok)) { e.preventDefault(); return; }   // the first press only wakes the screen (or OK watches)
    if (!saverOn && !ambientOn && !sheetOpen() && k === 403) { startScreen(); e.preventDefault(); return; }
    if (typing(k)) return;
    if (k === TV.keys.left) move(-1, 0);
    else if (k === TV.keys.right) move(1, 0);
    else if (k === TV.keys.up) move(0, -1);
    else if (k === TV.keys.down) move(0, 1);
    else if (k === TV.keys.ok) activate();
    else if (k === TV.keys.back || k === 27 || k === 8) back();
    else return;
    e.preventDefault();
  });
  document.addEventListener('mousemove', function () { poke(); });

  /**
   * In a text field, the keys type (← → move in the text, Delete erases). OK or the keyboard's Done searches (or saves); Back,
   * its Cancel or ↑ ↓ leave the field. Samsung's keyboard sends Done as 65376 and Cancel as 65385. True: handled here.
   */
  function typing(k) {
    var sheet = st.zone === Z.CITY ? 'citypick' : st.zone === Z.KEY ? 'keypick' : st.zone === Z.ALBUM ? 'albumpick' : st.zone === Z.TEXT ? 'textpick' : '';
    if (!sheet) return false;
    var inputs = $(sheet).querySelectorAll('input'), typingNow = false, i;
    for (i = 0; i < inputs.length; i++) if (document.activeElement === inputs[i]) typingNow = true;
    if (!typingNow) return false;
    if (k === TV.keys.ok || k === 65376) {
      if (st.zone === Z.CITY) searchCity();
      else if (st.zone === Z.KEY) saveKey();
      else if (st.zone === Z.TEXT) saveText();
      else saveAlbum();
    }
    else if (k === TV.keys.back || k === 27 || k === 65385) { closeField(sheet); updateFocus(); }
    else if (k === TV.keys.up || k === TV.keys.down) { closeField(sheet); move(0, k === TV.keys.up ? -1 : 1); }
    return true;
  }

  // MARK: - Start

  function renderAll() {
    renderTop();
    renderQuotes();
    cards = [];
    renderCards();
    renderShelf();
    renderDrawer();
    renderClock();
    checkNight();
    if (st.zone === Z.SETTINGS) renderSettings();
    updateFocus();
  }

  /** hide_apps in config.properties: left out of the shelf, All Apps and the picks, by id or name (part of it). */
  var HIDE = (CONFIG.hideApps || []).map(function (s) { return s.toLowerCase(); });
  function hidden(app) {
    var id = (app.id || '').toLowerCase(), title = (app.title || '').toLowerCase();
    for (var i = 0; i < HIDE.length; i++) if (id.indexOf(HIDE[i]) >= 0 || title.indexOf(HIDE[i]) >= 0) return true;
    return false;
  }

  function loadApps(done) {
    TV.returnHome(Prefs.homeReturns());
    TV.apps(function (list) {
      apps = list.filter(function (a) { return !hidden(a); });
      Data.setApps(apps);
      pickShelf();
      TV.inputs(function (list2) {
        inputs = list2;
        if (done) done();
      });
    });
  }

  /** Back to the home screen (the app was opened again): the shelf, everything closed, the first tab at its first pick. */
  function reset() {
    hideSaver();
    hideAmbient();
    closeSheets();
    st.zone = Z.SHELF;
    st.shelf = 0;
    st.card = 0;
    selectTab(0);
    updateFocus();
    restInDrawer();   // drawer_first: out again at once, not only after the TV lists its apps
  }

  Data.onChange(function () {
    renderQuotes();
    renderCards();
    renderPanels();
    checkNight();
  });

  /** drawer_first: the home screen rests with the drawer open (shelf in the middle, inputs and weather below). */
  function restInDrawer() {
    if (!CONFIG.drawerFirst || !drawerItems.length || st.zone !== Z.SHELF) return;
    st.zone = Z.DRAWER;
    st.drawer = 0;
    updateFocus();
  }

  /**
   * Samsung, behind another app: a build with samsung_home_button keeps the page running there (the others are paused
   * by the TV), and nothing is fetched or drawn for a screen nobody sees; coming back catches up (visibilitychange).
   */
  function resting() { return TV.name === 'tizen' && document.hidden; }

  function reopened() {
    // LG: with handlesRelaunch the app has to come to the front itself, or opening it again while it runs shows nothing.
    if (window.PalmSystem && window.PalmSystem.activate) window.PalmSystem.activate();
    reset();
    loadApps(function () { renderShelf(); renderDrawer(); restInDrawer(); Data.refresh(); });
  }

  window.addEventListener('resize', fit);
  document.addEventListener('webOSRelaunch', reopened);   // LG: opened again while running
  window.addEventListener('appcontrol', reopened);        // Samsung: the same
  document.addEventListener('visibilitychange', function () {
    // Going behind another app or coming back, the screensaver goes: coming back (Back from Netflix, say, which is no
    // relaunch) shows the home screen, never a screensaver that started while the app was out of sight.
    hideSaver();
    hideAmbient();
    if (document.hidden) { syncLive(); return; }
    idleAt = Date.now();
    TV.noteChannel();   // back from the viewer: the antenna channel it played, for Live TV
    if (TV.name === 'tizen') { renderClock(); checkNight(); applyDim(); }   // what resting() left as it was
    syncLive();   // a start that happened while the page was hidden never reached the weather
    loadApps(function () { renderShelf(); renderDrawer(); updateFocus(); Data.refresh(); });
  });

  I18N.set(Prefs.language());
  direction();
  I18N.setClock(Prefs.clockFormat());
  checkNight();   // now, from the last forecast: not after the TV lists its apps, with the day look until then
  // LG's screensaver waits only when ours will show: not under a sheet (ours waits there), and not without photos.
  TV.holdScreenSaver(function () {
    return !sheetOpen() && (saverMode() === 'clock' || saverMode() === 'live' || saverPhotos().length > 0 || (Prefs.icloudSaver() && ICloud.count() > 0));
  });
  ICloud.onChange(function () {
    if (st.zone === Z.SETTINGS) renderSettings();
    if (st.zone === Z.ALBUM && !typingIn('albumpick')) renderAlbum();
    if (Prefs.icloudHome() && ICloud.count()) startAlbumBackground();
  });
  ICloud.boot();
  LiveWeather.boot($('live'));
  try { if (window.tizen && window.tizen.tvinputdevice) window.tizen.tvinputdevice.registerKey('ColorF0Red'); } catch (e) {}
  if (Prefs.icalUrl()) Glance.loadCalendar(Prefs.icalUrl(), renderGlance);
  setInterval(function () {
    if (resting() || !Prefs.wizUrl()) return;
    reportStatus(true);
    Glance.pullWish(function (w) {
      if (!w) return;
      if ((w.homeShow === 'picks' || w.homeShow === 'weather' || w.homeShow === 'photos') && Prefs.homeShow() !== w.homeShow) {
        Prefs.set('homeShow', w.homeShow);
        applyHomeContent();
      }
      if (w.saver === 'photos' || w.saver === 'clock' || w.saver === 'live') Prefs.set('saver', w.saver);
      if (w.ambient === 'start' && !saverOn && !ambientOn) startScreen();
      if (w.ambient === 'off') { hideSaver(); hideAmbient(); }
    });
  }, 5000);
  applyHomeContent();
  Data.onChange(function () { if (LiveWeather.mode() !== 'off') pushScene(); });
  fit();
  renderTop();
  applyDim();
  tickClock();
  loadApps(function () {
    renderAll();
    restInDrawer();
    Data.refresh();
  });
  setInterval(function () {
    if (resting()) return;
    checkNight();
    Data.refresh();
    applyDim();   // automatic: medium from 22:00, off again at 07:00
    // Only on screen: behind another app nobody presses our keys, so idleAt grows old and the screensaver would start
    // there, turning photos every 12 s for nothing while Netflix or YouTube plays.
    if (!document.hidden && !saverOn && !ambientOn && !sheetOpen() && Date.now() - idleAt > SAVER_AFTER) {
      if (Prefs.ambient() === 'auto') startScreen();
      else if (saverMode() === 'live') showLiveSaver();
      else if (Prefs.icloudSaver() && ICloud.count()) showAlbumSaver();
      else if (saverMode() === 'clock') showAmbient('clock'); else showSaver();
    }
    if (Prefs.icalUrl() && Date.now() - calendarAt > 15 * 60000) {
      calendarAt = Date.now();
      Glance.loadCalendar(Prefs.icalUrl(), function () { renderGlance(); if (ambientOn) tickAmbient(); });
    }
    if (LiveWeather.mode() !== 'off') { pushScene(); LiveWeather.refreshAlert(Prefs.latitude(), Prefs.longitude()); }
    reportStatus();
    // New photos, and signed addresses that expire. A failure is asked again sooner than a list that arrived.
    if (!resting() && Prefs.icloudAlbum() && (Prefs.icloudSaver() || Prefs.icloudHome())) {
      var wait = ICloud.problem() ? 2 * 60000 : 30 * 60000;
      if (Date.now() - ICloud.fetchedAt() > wait) ICloud.sync();
    }
    if (saverOn) {
      var saverClock = $('saver').querySelector('.clock');
      if (saverClock) tickSaverClock(saverClock);
    }
    if (ambientOn) tickAmbient();
  }, 30000);

  // For the browser preview and tests.
  window.FreeMyTV = {state: st, move: move, activate: activate, back: back, showSaver: showSaver, hideSaver: hideSaver, toast: toast,
    showAmbient: showAmbient, hideAmbient: hideAmbient, applyDim: applyDim,     showLive: showLiveSaver, syncLive: syncLive,
    homeContent: applyHomeContent, startAmbient: startScreen, refresh: function () { renderTop(); renderCards(); renderScenes(); renderGlance(); }};
})();
