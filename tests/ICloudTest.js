/*
 * iCloud shared-album links, derivative choice and the asset list. Run by tools/test-web.sh.
 * The network is a fake transport, so nothing here calls Apple. ICLOUD_LIVE=1 also checks that a bad
 * token is still refused by the live hosts.
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), https = require('https');

var sandbox = {window: {}, console: console, Date: Date, Math: Math, JSON: JSON, encodeURIComponent: encodeURIComponent, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, String: String, Error: Error};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'icloud.js'), 'utf8'), sandbox, {filename: 'web/icloud.js'});
var ICloud = sandbox.ICloud;

var failures = 0;
function expect(actual, want, label) {
  var a = JSON.stringify(actual), w = JSON.stringify(want);
  if (a === w) return;
  failures++;
  console.error('FAIL ' + label + ':\n  got  ' + a + '\n  want ' + w);
}

function deriv(w, h, checksum) {
  return {checksum: checksum, width: String(w), height: String(h)};
}

// MARK: - Links

expect(ICloud.parseLink(''), null, 'empty');
expect(ICloud.parseLink('https://example.com/sharedalbum/#B12ABCDEF'), null, 'not icloud');
expect(ICloud.parseLink('https://www.icloud.com/sharedalbum/#B12ABCDEF'),
  {kind: 'legacy', token: 'B12ABCDEF'}, 'hash link');
expect(ICloud.parseLink('  https://www.icloud.com/sharedalbum/#B12ABCDEF  '),
  {kind: 'legacy', token: 'B12ABCDEF'}, 'trimmed');
expect(ICloud.parseLink('"https://www.icloud.com/sharedalbum/#B12ABCDEF"'),
  {kind: 'legacy', token: 'B12ABCDEF'}, 'quoted');
expect(ICloud.parseLink('https://www.icloud.com/sharedalbum/B12ABCDEF'),
  {kind: 'legacy', token: 'B12ABCDEF'}, 'no hash');
expect(ICloud.parseLink('www.icloud.com/sharedalbum/#B12ABCDEF'),
  {kind: 'legacy', token: 'B12ABCDEF'}, 'no scheme');
expect(ICloud.parseLink('https://www.icloud.com/sharedalbum/#B12ABCDEF;PHOTO1'),
  {kind: 'legacy', token: 'B12ABCDEF;PHOTO1'}, 'token with a photo guid');
expect(ICloud.parseLink('https://www.icloud.com/photo-stream/#A5OLDER'),
  {kind: 'legacy', token: 'A5OLDER'}, 'photo-stream');
expect(ICloud.parseLink('https://www.icloud.com/photostream/#C0OLDER'),
  {kind: 'legacy', token: 'C0OLDER'}, 'photostream');
expect(ICloud.parseLink('https://www.icloud.com/sharedalbum/%23B12ABCDEF'),
  {kind: 'legacy', token: 'B12ABCDEF'}, 'encoded hash');
expect(ICloud.parseLink('https://photos.icloud.com/shared/album/AbC-d_12'),
  {kind: 'cloudkit', token: 'AbC-d_12'}, 'photos.icloud.com');
expect(ICloud.parseLink('https://www.icloud.com/photos/shared/album/AbC-d_12'),
  {kind: 'cloudkit', token: 'AbC-d_12'}, 'icloud.com/photos/shared');
expect(ICloud.parseLink('https://www.icloud.com/shared/album/AbC-d_12?x=1'),
  {kind: 'cloudkit', token: 'AbC-d_12'}, 'query is not part of the token');
expect(ICloud.parseLink('https://www.icloud.com/sharedalbum/'), null, 'no token');
expect(ICloud.parseLink('not a link'), null, 'prose');

// Apple's page: token[0] === "A" uses one base62 digit, otherwise the next two. "12" is 1*62+2.
expect(ICloud.partition('B12ABCDEF'), 64, 'B-token partition');
expect(ICloud.partition('A5OLDER'), 5, 'A-token partition');
expect(ICloud.partition(''), 1, 'no token');

expect(ICloud.allowedHost('p64-sharedstreams.icloud.com'), true, 'stream host');
expect(ICloud.allowedHost('p42-ckdatabasews.icloud.com:443'), true, 'port stripped');
expect(ICloud.allowedHost('ckdatabasews.icloud.com'), true, 'generic cloudkit host');
expect(ICloud.allowedHost('evil.com'), false, 'other host');
expect(ICloud.allowedHost('p64-sharedstreams.icloud.com.evil.com'), false, 'suffix trick');
expect(ICloud.allowedUrl('https://p64-sharedstreams.icloud.com/B12/sharedstreams/webstream'), true, 'webstream url');
expect(ICloud.allowedUrl('https://p64-sharedstreams.icloud.com/B12/sharedstreams/webasseturls'), true, 'asset url');
expect(ICloud.allowedUrl('http://p64-sharedstreams.icloud.com/B12/sharedstreams/webstream'), false, 'not https');
expect(ICloud.allowedUrl('https://p64-sharedstreams.icloud.com/B12/sharedstreams/other'), false, 'other path');
expect(ICloud.allowedUrl('https://evil.com/sharedstreams/webstream'), false, 'webstream on the wrong host');

// MARK: - Derivatives and the asset list

var derivatives = {
  '2053': deriv(640, 480, 'small'),
  '2049': deriv(2048, 1536, 'med'),
  '2057': deriv(4032, 3024, 'big'),
  'PosterFrame': deriv(1920, 1080, 'poster')
};
expect(ICloud.pickDerivative(derivatives, 1920), {checksum: 'med', width: 2048, height: 1536}, '1080p picks the smallest that covers');
expect(ICloud.pickDerivative(derivatives, 3840), {checksum: 'big', width: 4032, height: 3024}, '4K picks the larger one');
expect(ICloud.pickDerivative({'2053': deriv(640, 480, 'small')}, 1920), {checksum: 'small', width: 640, height: 480}, 'nothing big enough: the largest');
expect(ICloud.pickDerivative({'PosterFrame': deriv(1920, 1080, 'poster')}, 1920), null, 'a poster frame is not a photo derivative');
expect(ICloud.pickDerivative(null, 1920), null, 'no derivatives');

var stream = {streamName: 'Holiday', photos: [
  {photoGuid: 'p1', dateCreated: '2024-01-02T00:00:00Z', derivatives: {'2049': deriv(2048, 1536, 'c1')}},
  {photoGuid: 'p2', mediaAssetType: 'video', dateCreated: '2024-01-03T00:00:00Z', derivatives: {'720p': deriv(1280, 720, 'vid'), PosterFrame: deriv(1920, 1080, 'poster')}},
  {photoGuid: 'p3', batchDateCreated: '2024-01-01T00:00:00Z', derivatives: {'2053': deriv(800, 600, 'c3')}},
  {photoGuid: '', derivatives: {'2049': deriv(2048, 1536, 'skip')}},
  {caption: 'no derivatives'}
]};
var photos = ICloud.photosFromStream(stream, 1920);
expect(photos.map(function (p) { return p.id; }), ['p1', 'p3'], 'videos and empties are skipped');
expect(photos[0].checksum, 'c1', 'first photo derivative');
expect(photos[1].date, '2024-01-01T00:00:00Z', 'batch date when there is no dateCreated');

var assets = ICloud.assetUrls({
  items: {
    c1: {url_location: 'cvws.icloud-content.com', url_path: '/S/one?e=1', url_expiry: '2099-01-01T00:00:00Z'},
    missing: {url_location: 'cvws.icloud-content.com'},
    c3: {url_location: 'cvws.icloud-content.com', url_path: '/S/three', url_expiry: '2000-01-01T00:00:00Z'}
  },
  locations: {'cvws.icloud-content.com': {scheme: 'https', hosts: ['p64-content.icloud.com', 'other.icloud.com']}}
}, Date.parse('2026-01-01T00:00:00Z'));
expect(assets.c1.url, 'https://p64-content.icloud.com/S/one?e=1', 'host from locations, not url_location');
expect(assets.missing, undefined, 'an item without a path is dropped');
expect(assets.c3.expiry > Date.parse('2026-01-01T00:00:00Z'), true, 'a past expiry is pushed forward');
expect(ICloud.assetUrls({items: {c: {url_location: 'cvws.icloud-content.com', url_path: '/S/x'}}, locations: {}}).c.url,
  'https://cvws.icloud-content.com/S/x', 'url_location when no hosts were given');

expect(ICloud.redirectHost({status: 330, text: '{"X-Apple-MMe-Host":"p70-sharedstreams.icloud.com"}'}),
  'p70-sharedstreams.icloud.com', '330 body');
expect(ICloud.redirectHost({status: 330, host: 'p71-sharedstreams.icloud.com', text: ''}),
  'p71-sharedstreams.icloud.com', '330 header');
expect(ICloud.redirectHost({status: 330, text: '{"X-Apple-MMe-Host":"evil.com"}'}), '', '330 to a host that is not Apple');
expect(ICloud.redirectHost({status: 200, text: '{"X-Apple-MMe-Host":"p70-sharedstreams.icloud.com"}'}), '', 'a 200 is not a redirect');

var ordered = ICloud.arrange([
  {id: 'b', date: '2024-02-01'}, {id: 'a', date: '2024-01-01'}, {id: 'c', date: ''}
], 'order');
expect(ordered.map(function (p) { return p.id; }), ['a', 'b', 'c'], 'in order by date, undated last');
var seq = 0;
var shuffled = ICloud.arrange([{id: 'a'}, {id: 'b'}, {id: 'c'}, {id: 'd'}], 'shuffle', function () { return (seq++ % 3) / 3; });
expect(shuffled.length, 4, 'shuffle keeps every photo');
expect(shuffled.map(function (p) { return p.id; }).sort().join(''), 'abcd', 'shuffle does not drop or duplicate');

// MARK: - CloudKit records

var records = [
  {recordType: 'CPLMaster', recordName: 'new', fields: {
    itemType: {value: 'public.jpeg'},
    resOriginalFileType: {value: 'public.jpeg'},
    resJPEGThumbRes: {value: {downloadURL: 'https://cdn.example/thumb${f}'}},
    resJPEGThumbWidth: {value: 360}, resJPEGThumbHeight: {value: 240},
    resJPEGMedRes: {value: {downloadURL: 'https://cdn.example/med${f}'}},
    resJPEGMedWidth: {value: 2048}, resJPEGMedHeight: {value: 1365},
    resOriginalRes: {value: {downloadURL: 'https://cdn.example/orig${f}'}},
    resOriginalWidth: {value: 4032}, resOriginalHeight: {value: 3024},
    resVidSmallRes: {value: {downloadURL: 'https://cdn.example/live.mov'}},
    resVidSmallWidth: {value: 1280}, resVidSmallHeight: {value: 720}
  }},
  {recordType: 'CPLAsset', recordName: 'asset', fields: {}},
  {recordType: 'CPLMaster', recordName: 'clip', fields: {
    itemType: {value: 'public.mpeg-4'},
    resVidMedRes: {value: {downloadURL: 'https://cdn.example/video'}},
    resVidMedWidth: {value: 1920}, resVidMedHeight: {value: 1080}
  }}
];
var ck = ICloud.photosFromCloudKit(records, 1920);
expect(ck.length, 1, 'a video master is skipped and a Live Photo stays');
expect(ck[0].id, 'new', 'the still master');
expect(ck[0].url, 'https://cdn.example/medphoto.jpg', '1080p JPEG, with ${f} filled in');
expect(ck[0].w, 2048, 'the chosen width');
expect(ICloud.photosFromCloudKit(records, 3840)[0].url, 'https://cdn.example/origphoto.jpg', '4K takes the original');

// MARK: - The two requests, including a 330 and a batch of asset URLs

function scripted(steps) {
  var i = 0, seen = [];
  function transport(url, body, done) {
    seen.push({url: url, body: body});
    var step = steps[i++] || {status: 500, text: ''};
    done(null, {status: step.status, text: JSON.stringify(step.json || {}), host: step.host || ''});
  }
  transport.seen = seen;
  return transport;
}

function run(link, transport, done) {
  ICloud.fetchAlbum(link, transport, {edge: 1920}, done);
}

var legacySteps = scripted([
  {status: 330, json: {'X-Apple-MMe-Host': 'p70-sharedstreams.icloud.com'}},
  {status: 200, json: {streamName: 'Holiday', photos: [
    {photoGuid: 'g1', dateCreated: '2024-05-01T00:00:00Z', derivatives: {'2049': deriv(2000, 1000, 'aa')}},
    {photoGuid: 'g2', mediaAssetType: 'video', derivatives: {'720p': deriv(1280, 720, 'vv')}}
  ]}},
  {status: 200, json: {
    items: {aa: {url_location: 'cvws.icloud-content.com', url_path: '/S/aa', url_expiry: '2099-01-01T00:00:00Z'}},
    locations: {'cvws.icloud-content.com': {scheme: 'https', hosts: ['p70-content.icloud.com']}}
  }}
]);
run('https://www.icloud.com/sharedalbum/#B12ABCDEF', legacySteps, function (err, album) {
  expect(err, null, 'legacy fetch error');
  expect(album.title, 'Holiday', 'album name');
  expect(album.photos.length, 1, 'one still');
  expect(album.photos[0].url, 'https://p70-content.icloud.com/S/aa', 'resolved url');
  expect(legacySteps.seen[0].url.indexOf('https://p64-sharedstreams.icloud.com/B12ABCDEF/sharedstreams/webstream') === 0, true, 'first host from the token');
  expect(legacySteps.seen[0].body, '{"streamCtag":null}', 'webstream body');
  expect(legacySteps.seen[1].url.indexOf('https://p70-sharedstreams.icloud.com/B12ABCDEF/sharedstreams/webstream') === 0, true, 'followed the 330');
  expect(legacySteps.seen[2].body, '{"photoGuids":["g1"]}', 'only the still photo is asked for');
});

run('https://www.icloud.com/sharedalbum/#B12ABCDEF', scripted([{status: 404, json: {}}]), function (err) {
  expect(err && err.code, 'refused', 'unknown token');
});
run('https://www.icloud.com/sharedalbum/#B12ABCDEF', scripted([{status: 0, json: {}}]), function (err) {
  expect(err && err.code, 'offline', 'no answer');
});
run('not a link', scripted([]), function (err) {
  expect(err && err.code, 'invalid', 'rejected before any request');
});
run('https://www.icloud.com/sharedalbum/#B12ABCDEF', scripted([{status: 200, json: {streamName: 'Empty', photos: []}}]), function (err, album) {
  expect(err, null, 'empty is not a transport error');
  expect(album.photos.length, 0, 'empty album');
});

var many = [], g, i;
for (i = 0; i < 30; i++) {
  g = 'g' + i;
  many.push({photoGuid: g, derivatives: {'2049': deriv(2000, 1000, 'c' + i)}});
}
var batches = scripted([
  {status: 200, json: {photos: many}},
  {status: 200, json: {items: itemsFor(0, 25), locations: {'cvws.icloud-content.com': {scheme: 'https', hosts: ['h.icloud.com']}}}},
  {status: 200, json: {items: itemsFor(25, 30), locations: {'cvws.icloud-content.com': {scheme: 'https', hosts: ['h.icloud.com']}}}}
]);
function itemsFor(from, to) {
  var items = {}, n;
  for (n = from; n < to; n++) items['c' + n] = {url_location: 'cvws.icloud-content.com', url_path: '/S/' + n};
  return items;
}
run('https://www.icloud.com/sharedalbum/#B12ABCDEF', batches, function (err, album) {
  expect(err, null, 'batched fetch');
  expect(album.photos.length, 30, 'both batches');
  expect(JSON.parse(batches.seen[1].body).photoGuids.length, 25, 'first batch is 25');
  expect(JSON.parse(batches.seen[2].body).photoGuids.length, 5, 'the rest follow');
});

var ckTransport = scripted([
  {status: 200, json: {results: [{
    serverErrorCode: '',
    zoneID: {zoneName: 'Album', ownerRecordName: 'owner', zoneType: 'REGULAR_CUSTOM_ZONE'},
    anonymousPublicAccess: {token: 'anon token', databasePartition: 'https://p42-ckdatabasews.icloud.com:443'},
    share: {fields: {'cloudkit.title': {value: 'Trip'}}}
  }]}},
  {status: 200, json: {records: [
    {recordType: 'CPLMaster', recordName: 'newer', fields: {
      resJPEGMedRes: {value: {downloadURL: 'https://cdn.example/new'}},
      resJPEGMedWidth: {value: 2000}, resJPEGMedHeight: {value: 1000},
      resOriginalFileType: {value: 'public.jpeg'}
    }},
    {recordType: 'CPLMaster', recordName: 'older', fields: {
      resJPEGMedRes: {value: {downloadURL: 'https://cdn.example/old'}},
      resJPEGMedWidth: {value: 2000}, resJPEGMedHeight: {value: 1000},
      resOriginalFileType: {value: 'public.jpeg'}
    }}
  ]}}
]);
run('https://www.icloud.com/shared/album/AbC-d_12', ckTransport, function (err, album) {
  expect(err, null, 'cloudkit fetch');
  expect(album.title, 'Trip', 'cloudkit title');
  expect(album.photos.map(function (p) { return p.id; }), ['older', 'newer'], 'newest-first page is shown oldest first');
  expect(ckTransport.seen[0].url.indexOf('/public/records/resolve') > 0, true, 'resolve url');
  expect(JSON.parse(ckTransport.seen[0].body).shortGUIDs[0].value, 'AbC-d_12', 'short guid');
  expect(ckTransport.seen[1].url.indexOf('https://p42-ckdatabasews.icloud.com/') === 0, true, 'partition host, port dropped');
  expect(ckTransport.seen[1].url.indexOf('publicAccessAuthToken=anon%20token') > 0, true, 'anonymous token is escaped');
});

run('https://www.icloud.com/shared/album/nope', scripted([{status: 200, json: {results: [{serverErrorCode: 'NOT_FOUND', reason: 'no'}]}}]), function (err) {
  expect(err && err.code, 'refused', 'cloudkit does not know the link');
});

function live(done) {
  function transport(url, body, next) {
    var u = new URL(url);
    var req = https.request({hostname: u.hostname, path: u.pathname + u.search, method: 'POST', timeout: 20000,
      headers: {'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body)}}, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        next(null, {status: res.statusCode, text: Buffer.concat(chunks).toString('utf8'),
          host: res.headers['x-apple-mme-host'] || ''});
      });
    });
    req.on('error', function () { next(null, {status: 0, text: '', host: ''}); });
    req.on('timeout', function () { req.destroy(); });
    req.end(body);
  }
  ICloud.fetchAlbum('https://www.icloud.com/sharedalbum/#B12NOTAREALBUM', transport, {edge: 1920}, function (err) {
    expect(err && err.code, 'refused', 'live legacy host refuses an unknown token');
    ICloud.fetchAlbum('https://www.icloud.com/shared/album/NotARealAlbum', transport, {edge: 1920}, function (err2) {
      expect(err2 && err2.code, 'refused', 'live cloudkit host refuses an unknown token');
      done();
    });
  });
}

function finish() {
  if (failures) {
    console.error(failures + ' failed');
    process.exit(1);
  }
  console.log('ICloudTest: all checks passed.');
}

if (process.env.ICLOUD_LIVE) live(finish);
else finish();
