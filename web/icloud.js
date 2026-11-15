/*
 * Photos from an iCloud shared album the person pasted on this TV (Home Settings). The link stays in Prefs, on the
 * device: it is never built in, and nothing here writes it to the log.
 *
 * Checked against Apple's shared-album page (build 2642, November 2026) and the live hosts:
 *  - a link https://www.icloud.com/sharedalbum/#<token> (and the older photo-stream forms) is the sharedstreams API.
 *    The token's first characters pick a partition, pNN-sharedstreams.icloud.com; a wrong one answers 330 with the
 *    right host in the body as X-Apple-MMe-Host. POST {"streamCtag":null} to .../webstream, then the photoGuids to
 *    .../webasseturls. A photo's URL is scheme://<locations[url_location].hosts[0]><url_path>. Videos are skipped.
 *  - https://www.icloud.com/shared/album/<token> (and photos.icloud.com/...) is the newer CloudKit share: POST the
 *    shortGUID to records/resolve, then page the zone. The same "Anyone with the Link" switch on iOS 26 can hand
 *    out either shape; both are accepted.
 * Apple only sends Access-Control-Allow-Origin for its own site, so a browser cannot read the JSON. The TV asks
 * with XMLHttpRequest (Samsung allows the host through config.xml's access origin; a 2021 Tizen 6 set does), and
 * on LG, where that answer is hidden, through the app's own service (webos/service, plain HTTPS, no browser).
 * The picture files themselves load as images, which need no such header. Signed URLs expire, so the list is
 * fetched again while the feature is on.
 */
var ICloud = (function () {
  'use strict';

  var B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  var BATCH = 25;
  var MAX_PHOTOS = 400;
  var CK = '/database/1/com.apple.photos.cloud/production/';

  function pad2(n) {
    n = String(n);
    return n.length < 2 ? '0' + n : n;
  }

  function base62(s) {
    var n = 0, i, d;
    for (i = 0; i < s.length; i++) {
      d = B62.indexOf(s.charAt(i));
      if (d < 0) return 0;
      n = n * 62 + d;
    }
    return n;
  }

  /** The partition Apple's page computes from the token. A wrong guess is corrected by the 330 answer. */
  function partition(token) {
    token = String(token || '');
    if (!token) return 1;
    var n = token.charAt(0) === 'A' ? base62(token.charAt(1)) : base62(token.substring(1, 3));
    return n > 0 ? n : 1;
  }

  function stripGuid(token) {
    var i = String(token || '').indexOf(';');
    return i >= 0 ? token.substring(0, i) : token;
  }

  /**
   * A pasted album link: {kind:'legacy'|'cloudkit', token}, or null.
   * Legacy: icloud.com/sharedalbum/#TOKEN, /sharedalbum/TOKEN, /photo-stream/#TOKEN, /photostream/#TOKEN.
   * CloudKit: icloud.com/shared/album/TOKEN or photos.icloud.com/shared/album/TOKEN.
   */
  function parseLink(input) {
    var s = String(input || '').replace(/^\s+|\s+$/g, '').replace(/^['"]+|['"]+$/g, '');
    if (!s) return null;
    if (s.indexOf('://') < 0 && /icloud\.com/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
    if (!/icloud\.com/i.test(s)) return null;
    var ck = /icloud\.com\/(?:photos\/)?shared\/album\/([A-Za-z0-9][A-Za-z0-9._-]*)/i.exec(s);
    if (ck) return {kind: 'cloudkit', token: ck[1]};
    if (!/sharedalbum|photo-?stream|photostream/i.test(s)) return null;
    var token = '([A-Za-z0-9][A-Za-z0-9._-]*(?:;[A-Za-z0-9][A-Za-z0-9._-]*)?)';
    var hash = new RegExp('#' + token).exec(s);
    if (!hash) hash = new RegExp('%23' + token, 'i').exec(s);
    if (hash) return {kind: 'legacy', token: hash[1]};
    var path = new RegExp('icloud\\.com/(?:sharedalbum|photo-stream|photostream)/' + token, 'i').exec(s);
    return path ? {kind: 'legacy', token: path[1]} : null;
  }

  /** Hosts the album calls may use. Anything else is refused, including by the LG service. */
  function allowedHost(host) {
    host = String(host || '').toLowerCase();
    var colon = host.indexOf(':');
    if (colon >= 0) host = host.substring(0, colon);
    if (host === 'sharedstreams.icloud.com' || host === 'ckdatabasews.icloud.com') return true;
    return /^p[0-9]{1,3}-sharedstreams\.icloud\.com$/.test(host) || /^p[0-9]{1,3}-ckdatabasews\.icloud\.com$/.test(host);
  }

  function allowedUrl(url) {
    var m = /^https:\/\/([^/?#]+)(\/[^?#]*)/i.exec(String(url || ''));
    if (!m || !allowedHost(m[1])) return false;
    var path = m[2];
    return path.indexOf('/sharedstreams/webstream') >= 0 || path.indexOf('/sharedstreams/webasseturls') >= 0
      || path.indexOf(CK + 'public/records/resolve') >= 0 || path.indexOf(CK + 'shared/records/query') >= 0;
  }

  function fail(code) {
    var e = new Error(code);
    e.code = code;
    return e;
  }

  function num(v) {
    var n = parseInt(v, 10);
    return n > 0 ? n : 0;
  }

  /**
   * The smallest derivative whose long edge still covers `target` pixels, else the largest.
   * Keys are Apple's rendition ids, not pixel sizes: width and height are the fields that count.
   * Returns {checksum, width, height} or null.
   */
  /**
   * A size for the screen, not the original. The smallest rendition that covers `target`, unless that jump is more
   * than about twice `target` and a smaller rendition exists: a 4K original takes more than a second to decode on
   * a 2021 Samsung, so the banner would rather use the thumbnail.
   */
  function pickCover(derivatives, target) {
    if (!derivatives) return null;
    target = target > 0 ? target : 1000;
    var over = null, overEdge = 0, under = null, underEdge = 0, key, d, edge;
    for (key in derivatives) {
      if (!derivatives.hasOwnProperty(key) || key === 'PosterFrame') continue;
      d = derivatives[key];
      if (!d || !d.checksum) continue;
      edge = Math.max(num(d.width), num(d.height));
      if (!edge) continue;
      if (edge >= target && (!over || edge < overEdge)) { over = d; overEdge = edge; }
      if (edge < target && edge > underEdge) { under = d; underEdge = edge; }
    }
    d = (over && overEdge <= target * 2.2) ? over : (under || over);
    if (!d) return null;
    return {checksum: String(d.checksum), width: num(d.width), height: num(d.height)};
  }

  /**
   * The smallest derivative whose long edge still covers `target` pixels, else the largest.
   * Keys are Apple's rendition ids, not pixel sizes: width and height are the fields that count.
   * Returns {checksum, width, height} or null.
   */
  function pickDerivative(derivatives, target) {
    if (!derivatives) return null;
    target = target > 0 ? target : 1920;
    var best = null, bestEdge = 0, fallback = null, fallbackEdge = 0, key, d, edge;
    for (key in derivatives) {
      if (!derivatives.hasOwnProperty(key) || key === 'PosterFrame') continue;
      d = derivatives[key];
      if (!d || !d.checksum) continue;
      edge = Math.max(num(d.width), num(d.height));
      if (!edge) continue;
      if (edge >= target && (!best || edge < bestEdge)) { best = d; bestEdge = edge; }
      if (edge > fallbackEdge) { fallback = d; fallbackEdge = edge; }
    }
    d = best || fallback;
    if (!d) return null;
    return {checksum: String(d.checksum), width: num(d.width), height: num(d.height)};
  }

  /** Still photos from a webstream body, in Apple's order. Videos (mediaAssetType "video") are left out. */
  function photosFromStream(stream, target) {
    var list = stream && stream.photos, out = [], i, p, d;
    if (!list || !list.length) return out;
    for (i = 0; i < list.length && out.length < MAX_PHOTOS; i++) {
      p = list[i];
      if (!p || p.mediaAssetType === 'video') continue;
      d = pickDerivative(p.derivatives, target);
      var homeD = pickCover(p.derivatives, 1000);
      var tinyD = pickCover(p.derivatives, 180);
      if (!d || !p.photoGuid) continue;
      out.push({id: String(p.photoGuid), checksum: d.checksum,
        homeChecksum: homeD ? homeD.checksum : '',
        homeEdge: homeD ? Math.max(homeD.width, homeD.height) : 0,
        tinyChecksum: tinyD ? tinyD.checksum : '',
        tinyEdge: tinyD ? Math.max(tinyD.width, tinyD.height) : 0,
        edge: Math.max(d.width, d.height),
        w: d.width, h: d.height,
        date: String(p.dateCreated || p.batchDateCreated || ''),
        caption: String(p.caption || '').replace(/^\s+|\s+$/g, '')});
    }
    return out;
  }

  /** url_expiry is a date or a number of ms. A missing or already-past one lasts twenty minutes, as Apple's page does. */
  function parseExpiry(value, now) {
    now = now || Date.now();
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(n)) {
      var t = Date.parse(value || '');
      n = isNaN(t) ? 0 : t;
    }
    if (!n || n < now) n = now + 20 * 60000;
    return n;
  }

  /**
   * checksum → {url, expiry} from a webasseturls body.
   * The URL is scheme://hosts[0] + url_path (Apple's page). url_location is only the fallback.
   */
  function assetUrls(response, now) {
    var items = response && response.items || {}, locations = response && response.locations || {}, out = {}, key, item, loc, host, scheme;
    for (key in items) {
      if (!items.hasOwnProperty(key)) continue;
      item = items[key];
      if (!item || !item.url_path || !item.url_location) continue;
      loc = locations[item.url_location] || {};
      scheme = loc.scheme || 'https';
      host = loc.hosts && loc.hosts.length ? loc.hosts[0] : item.url_location;
      if (!host || !item.url_path) continue;
      out[key] = {url: scheme + '://' + host + item.url_path, expiry: parseExpiry(item.url_expiry, now)};
    }
    return out;
  }

  /** The host named by a 330, from the header the transport saw or from the JSON body. '' if it isn't Apple's. */
  function redirectHost(res) {
    var host = res && (res.host || '');
    if (!host && res && res.status === 330) {
      try { host = JSON.parse(res.text || '')['X-Apple-MMe-Host'] || ''; } catch (e) { host = ''; }
    }
    host = String(host || '').replace(/:\d+$/, '');
    return allowedHost(host) ? host : '';
  }

  function streamTitle(stream) {
    var name = stream && stream.streamName;
    return name ? String(name) : '';
  }

  var MOVIE = { 'public.mpeg-4': 1, 'com.apple.quicktime-movie': 1, 'public.movie': 1, 'video/mp4': 1, 'video/quicktime': 1 };

  function fieldValue(fields, name) {
    var f = fields && fields[name];
    return f ? f.value : undefined;
  }

  function isMovieType(type) {
    type = String(type || '').toLowerCase();
    if (!type) return false;
    return !!MOVIE[type] || type.indexOf('video') >= 0 || type.indexOf('movie') >= 0;
  }

  /**
   * Still photos from CloudKit records (CPLMaster, in the order they arrived).
   * A Live Photo keeps its still and drops the movie renditions. A video master is skipped.
   * ${f} in a download URL becomes a file name; Apple substitutes it the same way.
   */
  function ckDate(fields) {
    var names = ['assetDate', 'dateCreated', 'addedDate'], i, v, ms;
    for (i = 0; i < names.length; i++) {
      v = fieldValue(fields, names[i]);
      if (typeof v === 'number' && v > 0) {
        ms = v < 100000000000 ? v * 1000 : v;
        try { return new Date(ms).toISOString(); } catch (e) { return ''; }
      }
      if (typeof v === 'string' && v) return v;
    }
    return '';
  }

  function ckCaption(fields) {
    var v = fieldValue(fields, 'caption');
    return v ? String(v).replace(/^\s+|\s+$/g, '') : '';
  }

  function masterId(fields) {
    var ref = fieldValue(fields, 'masterRef');
    if (!ref) return '';
    if (typeof ref === 'string') return ref;
    return ref.recordName ? String(ref.recordName) : '';
  }

  function photosFromCloudKit(records, target) {
    var out = [], i, rec, fields, itemType, originalType, key, name, type, url, width, height, edge;
    var best, bestEdge, fallback, fallbackEdge, dl, notes = {}, note, id;
    if (!records || !records.length) return out;
    target = target > 0 ? target : 1920;
    for (i = 0; i < records.length; i++) {
      rec = records[i];
      if (!rec || rec.recordType !== 'CPLAsset') continue;
      fields = rec.fields || {};
      id = masterId(fields);
      if (!id) continue;
      notes[id] = {date: ckDate(fields), caption: ckCaption(fields)};
    }
    for (i = 0; i < records.length && out.length < MAX_PHOTOS; i++) {
      rec = records[i];
      if (!rec || rec.recordType !== 'CPLMaster') continue;
      fields = rec.fields || {};
      itemType = String(fieldValue(fields, 'itemType') || '');
      originalType = String(fieldValue(fields, 'resOriginalFileType') || '');
      if (isMovieType(itemType) || isMovieType(originalType)) continue;
      best = null;
      bestEdge = 0;
      fallback = null;
      fallbackEdge = 0;
      var choices = [];
      for (key in fields) {
        if (!fields.hasOwnProperty(key)) continue;
        if (key.indexOf('res') !== 0 || key.indexOf('Res') !== key.length - 3) continue;
        if (key.indexOf('Vid') >= 0) continue;
        name = key.substring(3, key.length - 3);
        type = String(fieldValue(fields, 'res' + name + 'FileType') || '');
        if (isMovieType(type)) continue;
        dl = fieldValue(fields, key);
        url = dl && dl.downloadURL;
        if (!url) continue;
        width = num(fieldValue(fields, 'res' + name + 'Width'));
        height = num(fieldValue(fields, 'res' + name + 'Height'));
        edge = Math.max(width, height);
        url = String(url).replace(/\$\{f\}/g, 'photo.jpg');
        var choice = {url: url, w: width, h: height, edge: edge};
        if (edge >= target && (!best || edge < bestEdge)) { best = choice; bestEdge = edge; }
        if (!fallback || edge > fallbackEdge) { fallback = choice; fallbackEdge = edge; }
        choices.push(choice);
      }
      choice = best || fallback;
      if (!choice) continue;
      function nearEdge(want) {
        var over = null, under = null, n, c;
        for (n = 0; n < choices.length; n++) {
          c = choices[n];
          if (c.edge >= want && (!over || c.edge < over.edge)) over = c;
          if (c.edge < want && (!under || c.edge > under.edge)) under = c;
        }
        if (over && over.edge <= want * 2.2) return over;
        return under || over;
      }
      var homeChoice = nearEdge(1000), tinyChoice = nearEdge(180);
      note = notes[String(rec.recordName || '')] || {};
      if (!note.date) note.date = ckDate(fields);
      if (!note.caption) note.caption = ckCaption(fields);
      out.push({id: String(rec.recordName || i), url: choice.url,
        home: homeChoice ? homeChoice.url : '',
        homeEdge: homeChoice ? homeChoice.edge : 0,
        tiny: tinyChoice ? tinyChoice.url : '',
        tinyEdge: tinyChoice ? tinyChoice.edge : 0,
        edge: choice.edge,
        w: choice.w, h: choice.h,
        date: note.date || '', caption: note.caption || '', exp: Date.now() + 12 * 3600000});
    }
    return out;
  }

  function byDate(a, b) {
    if (a.date === b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : 1;
  }

  /** 'order' keeps dates ascending (album order). 'shuffle' is a copy in a random order; `rnd` defaults to Math.random. */
  function arrange(list, mode, rnd) {
    var a = (list || []).slice(), i, j, t;
    if (mode !== 'shuffle') {
      a.sort(byDate);
      return a;
    }
    rnd = rnd || Math.random;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(rnd() * (i + 1));
      t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function post(transport, url, body, done) {
    if (!allowedUrl(url)) { done(fail('refused')); return; }
    var text;
    try { text = typeof body === 'string' ? body : JSON.stringify(body); } catch (e) { done(fail('refused')); return; }
    transport(url, text, function (err, res) {
      if (err || !res) { done(fail('offline')); return; }
      done(null, res);
    });
  }

  function statusError(status) {
    if (!status) return fail('offline');
    if (status >= 500) return fail('offline');
    return fail('refused');
  }

  function legacyUrl(host, token, path) {
    return 'https://' + host + '/' + encodeURIComponent(stripGuid(token)) + '/sharedstreams/' + path;
  }

  function attach(photos, urls) {
    var out = [], i, u;
    for (i = 0; i < photos.length; i++) {
      u = urls[photos[i].checksum];
      if (!u || !u.url) continue;
      photos[i].url = u.url;
      photos[i].exp = u.expiry;
      if (photos[i].homeChecksum) {
        var homeUrl = urls[photos[i].homeChecksum];
        if (homeUrl && homeUrl.url) photos[i].home = homeUrl.url;
      }
      if (photos[i].tinyChecksum) {
        var tinyUrl = urls[photos[i].tinyChecksum];
        if (tinyUrl && tinyUrl.url) photos[i].tiny = tinyUrl.url;
      }
      out.push(photos[i]);
    }
    return out;
  }

  function fetchAssetBatches(host, token, guids, index, urls, transport, done) {
    if (index >= guids.length) { done(null, urls); return; }
    var batch = guids.slice(index, index + BATCH);
    post(transport, legacyUrl(host, token, 'webasseturls'), {photoGuids: batch}, function (err, res) {
      if (err) { done(err); return; }
      if (!res || res.status !== 200) { done(statusError(res && res.status)); return; }
      var body;
      try { body = JSON.parse(res.text || ''); } catch (e) { done(fail('refused')); return; }
      var more = assetUrls(body);
      var key;
      for (key in more) if (more.hasOwnProperty(key)) urls[key] = more[key];
      fetchAssetBatches(host, token, guids, index + BATCH, urls, transport, done);
    });
  }

  function finishStream(host, token, res, target, transport, done) {
    if (!res || res.status !== 200) { done(statusError(res && res.status)); return; }
    var stream;
    try { stream = JSON.parse(res.text || ''); } catch (e) { done(fail('refused')); return; }
    var photos = photosFromStream(stream, target);
    var title = streamTitle(stream);
    if (!photos.length) { done(null, {title: title, photos: []}); return; }
    var guids = [], i;
    for (i = 0; i < photos.length; i++) guids.push(photos[i].id);
    fetchAssetBatches(host, token, guids, 0, {}, transport, function (err, urls) {
      if (err) { done(err); return; }
      done(null, {title: title, photos: attach(photos, urls)});
    });
  }

  function fetchLegacy(token, transport, target, done) {
    var host = 'p' + pad2(partition(token)) + '-sharedstreams.icloud.com';
    function once(h, redirects, next) {
      post(transport, legacyUrl(h, token, 'webstream'), {streamCtag: null}, function (err, res) {
        if (err) { next(err); return; }
        var redir = res.status === 330 ? redirectHost(res) : '';
        if (redir && redirects < 2 && redir !== h) { once(redir, redirects + 1, next); return; }
        next(null, h, res);
      });
    }
    once(host, 0, function (err, h, res) {
      if (err) { done(err); return; }
      finishStream(h, token, res, target, transport, done);
    });
  }

  function ckPartition(access) {
    var raw = String(access && access.databasePartition || 'https://ckdatabasews.icloud.com');
    return raw.replace(/:\d+$/, '').replace(/\/$/, '');
  }

  function fetchCloudKit(token, transport, target, done) {
    var resolve = 'https://ckdatabasews.icloud.com' + CK + 'public/records/resolve?remapEnums=true';
    post(transport, resolve, {shortGUIDs: [{value: token}]}, function (err, res) {
      if (err) { done(err); return; }
      if (!res || res.status !== 200) { done(statusError(res && res.status)); return; }
      var body, row, access, zone, title;
      try { body = JSON.parse(res.text || ''); } catch (e) { done(fail('refused')); return; }
      row = body.results && body.results[0];
      if (!row || row.serverErrorCode || !row.zoneID) { done(fail('refused')); return; }
      access = row.anonymousPublicAccess;
      zone = row.zoneID;
      if (!access || !access.token || !zone.zoneName) { done(fail('refused')); return; }
      title = '';
      try { title = String(row.share.fields['cloudkit.title'].value || ''); } catch (e2) { title = ''; }
      var base = ckPartition(access);
      var host = base.replace(/^https:\/\//, '');
      if (!allowedHost(host)) { done(fail('refused')); return; }
      var queryUrl = base + CK + 'shared/records/query?remapEnums=true&publicAccessAuthToken=' + encodeURIComponent(access.token);
      var records = [];
      function page(marker, left) {
        var payload = {
          query: {recordType: 'CPLAssetAndMasterByAssetDateWithoutHiddenOrDeleted',
            filterBy: [{fieldName: 'direction', comparator: 'EQUALS', fieldValue: {value: 'DESCENDING', type: 'STRING'}}]},
          zoneID: {zoneName: zone.zoneName, ownerRecordName: zone.ownerRecordName || '', zoneType: zone.zoneType || 'REGULAR_CUSTOM_ZONE'},
          resultsLimit: 200
        };
        if (marker) payload.continuationMarker = marker;
        post(transport, queryUrl, payload, function (err2, res2) {
          if (err2) { done(err2); return; }
          if (!res2 || res2.status !== 200) { done(statusError(res2 && res2.status)); return; }
          var pageBody;
          try { pageBody = JSON.parse(res2.text || ''); } catch (e3) { done(fail('refused')); return; }
          var chunk = pageBody.records || [];
          var i;
          for (i = 0; i < chunk.length; i++) records.push(chunk[i]);
          if (pageBody.continuationMarker && left > 1 && records.length < MAX_PHOTOS * 2) page(pageBody.continuationMarker, left - 1);
          else done(null, {title: title, photos: photosFromCloudKit(records, target)});
        });
      }
      page('', 8);
    });
  }

  /**
   * done(err, {title, photos}). err.code is 'offline' or 'refused'. An album with no still photos is a result
   * with an empty list, not an error. `opts.edge` is the long edge to cover (1920, or 3840 on a 4K UI).
   * `transport(url, jsonText, done)` does one POST.
   */
  function fetchAlbum(link, transport, opts, done) {
    var parsed = parseLink(link);
    if (!parsed) { done(fail('invalid')); return; }
    var edge = opts && opts.edge;
    if (!(edge > 0)) edge = 1920;
    var run = parsed.kind === 'cloudkit' ? fetchCloudKit : fetchLegacy;
    run(parsed.token, transport, edge, function (err, album) {
      if (err) { done(err); return; }
      if (parsed.kind === 'cloudkit' && album.photos && album.photos.length) album.photos.reverse();
      done(null, album);
    });
  }

  function screenEdge() {
    var w = 1920, h = 1080;
    try {
      if (window.screen) {
        w = window.screen.width || w;
        h = window.screen.height || h;
      }
    } catch (e) {}
    var edge = w > h ? w : h;
    if (edge >= 3000) return 3840;
    if (edge >= 1600) return 1920;
    return 1280;
  }

  // The album kept for the screensaver and the home background. The link itself lives in Prefs.
  var state = {photos: [], title: '', error: '', at: 0, hash: '', play: [], loading: false};
  var listeners = [], brokenAt = 0;

  function hashToken(token) {
    var h = 5381, i;
    for (i = 0; i < token.length; i++) h = ((h * 33) + token.charCodeAt(i)) | 0;
    return String(h);
  }

  function readCache() {
    try {
      var raw = localStorage.getItem('fmtv.icloud');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeCache(hash, album) {
    setTimeout(function () {
      var t0 = Date.now();
      try {
        localStorage.setItem('fmtv.icloud', JSON.stringify({h: hash, at: Date.now(), title: album.title || '', photos: album.photos}));
      } catch (e) {}
      if (typeof Pace !== 'undefined') Pace.note('icloud-store', Date.now() - t0);
    }, 0);
  }

  function clearCache() {
    try { localStorage.removeItem('fmtv.icloud'); } catch (e) {}
  }

  function alive(photos, now) {
    var i, n = 0;
    now = now || Date.now();
    for (i = 0; i < photos.length; i++) if (!photos[i].exp || photos[i].exp > now + 60000) n++;
    return n;
  }

  function emit() {
    var i;
    for (i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) {}
    }
  }

  function rebuild(mode) {
    var shuffle = mode === 'shuffle' || (mode !== 'order' && typeof Prefs !== 'undefined' && Prefs.icloudShuffle && Prefs.icloudShuffle());
    state.play = arrange(state.photos, shuffle ? 'shuffle' : 'order');
  }

  function applyAlbum(hash, album) {
    state.photos = album.photos || [];
    state.title = album.title || '';
    state.error = state.photos.length ? '' : 'empty';
    state.at = Date.now();
    state.hash = hash;
    if (state.photos.length) writeCache(hash, album);
    else clearCache();
    rebuild();
    emit();
  }

  function xhrPost(url, body, done) {
    var x, over = false;
    try { x = new XMLHttpRequest(); } catch (e) { done(null, {status: 0, text: '', host: ''}); return; }
    try { x.open('POST', url, true); } catch (e2) { done(null, {status: 0, text: '', host: ''}); return; }
    x.timeout = 20000;
    try { x.setRequestHeader('Content-Type', 'text/plain'); } catch (e3) {}
    function finish(status, text, host) {
      if (over) return;
      over = true;
      done(null, {status: status || 0, text: text || '', host: host || ''});
    }
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var host = '';
      try { host = x.getResponseHeader('X-Apple-MMe-Host') || ''; } catch (e4) {}
      finish(x.status, x.responseText, host);
    };
    x.ontimeout = x.onerror = function () { finish(0, '', ''); };
    try { x.send(body); } catch (e5) { finish(0, '', ''); }
  }

  function appTransport(url, body, done) {
    xhrPost(url, body, function (err, res) {
      if (res && res.status) { done(null, res); return; }
      if (typeof TV !== 'undefined' && TV.name === 'webos' && TV.applePost) {
        TV.applePost(url, body, function (err2, res2) {
          if (err2 || !res2 || !res2.status) { done(fail('offline')); return; }
          done(null, res2);
        });
        return;
      }
      done(fail('offline'));
    });
  }

  /** Ask again. Keeps photos already on the TV when the network fails and their URLs have not expired. */
  function sync(done) {
    var link = '', parsed = null;
    try { link = typeof Prefs !== 'undefined' && Prefs.icloudAlbum ? Prefs.icloudAlbum() : ''; } catch (e) { link = ''; }
    parsed = parseLink(link);
    if (!link) {
      state.photos = [];
      state.title = '';
      state.error = '';
      state.hash = '';
      state.play = [];
      clearCache();
      emit();
      if (done) done();
      return;
    }
    if (!parsed) {
      state.photos = [];
      state.title = '';
      state.error = 'invalid';
      state.play = [];
      emit();
      if (done) done();
      return;
    }
    var hash = hashToken(parsed.token);
    if (state.hash !== hash) {
      var cached = readCache();
      state.photos = [];
      state.play = [];
      state.title = '';
      state.error = '';
      if (cached && cached.h === hash && cached.photos && alive(cached.photos) > 0) {
        state.photos = cached.photos;
        state.title = cached.title || '';
        state.hash = hash;
        rebuild();
      }
    }
    if (state.loading) { if (done) done(); return; }
    state.loading = true;
    fetchAlbum(link, appTransport, {edge: screenEdge()}, function (err, album) {
      state.loading = false;
      if (!parseLink(Prefs.icloudAlbum()) || hashToken(parseLink(Prefs.icloudAlbum()).token) !== hash) {
        if (done) done();
        return;
      }
      if (err) {
        state.at = Date.now();
        if (!state.photos.length || state.hash !== hash) state.error = err.code || 'offline';
        emit();
        if (done) done();
        return;
      }
      applyAlbum(hash, album);
      if (done) done();
    });
  }

  function boot(done) {
    var link = '';
    try { link = Prefs.icloudAlbum(); } catch (e) { link = ''; }
    var parsed = parseLink(link);
    if (parsed) {
      var cached = readCache();
      var hash = hashToken(parsed.token);
      if (cached && cached.h === hash && cached.photos && alive(cached.photos) > 0) {
        state.photos = cached.photos;
        state.title = cached.title || '';
        state.error = '';
        state.hash = hash;
        state.at = cached.at || 0;
        rebuild();
        emit();
      }
    }
    sync(done);
  }

  return {
    parseLink: parseLink,
    partition: partition,
    allowedHost: allowedHost,
    allowedUrl: allowedUrl,
    pickDerivative: pickDerivative,
    pickCover: pickCover,
    photosFromStream: photosFromStream,
    photosFromCloudKit: photosFromCloudKit,
    assetUrls: assetUrls,
    parseExpiry: parseExpiry,
    redirectHost: redirectHost,
    arrange: arrange,
    fetchAlbum: fetchAlbum,
    screenEdge: screenEdge,
    hashToken: hashToken,
    onChange: function (fn) { listeners.push(fn); },
    boot: boot,
    sync: sync,
    count: function () { return state.photos.length; },
    title: function () { return state.title || ''; },
    problem: function () { return state.error || ''; },
    fetchedAt: function () { return state.at || 0; },
    /** The order the screensaver and the home background walk. Rebuilt when the album or Shuffle changes. */
    playlist: function () {
      if (!state.play.length && state.photos.length) rebuild();
      return state.play;
    },
    reshuffle: function () { rebuild('shuffle'); },
    reframe: function () { rebuild(); emit(); },
    /** An image that failed to load: refresh once a minute, so an expired URL is replaced and a dead one is skipped. */
    noteBroken: function () {
      var now = Date.now();
      if (now - brokenAt < 60000) return;
      brokenAt = now;
      state.at = 0;
      sync();
    },
    /** Browser preview only: show these photos without asking iCloud. */
    preview: function (photos, title) {
      state.photos = photos || [];
      state.title = title || '';
      state.error = state.photos.length ? '' : 'empty';
      state.at = Date.now();
      state.hash = 'preview';
      rebuild();
      emit();
    }
  };
})();
