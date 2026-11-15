#!/usr/bin/env python3
"""A small bridge on the Mac for Free My TV.

The TV cannot send UDP, so this speaks WiZ (UDP 38899, setPilot) and, if samsungtvws is
installed, the TV's own remote port (8002). The phone page and the TV talk to it over HTTP.

    python3 tools/wiz_bridge.py
    python3 tools/wiz_bridge.py --install-login --tv 192.168.86.69

Bulbs live in ~/.wiz/bulbs.txt, one "IP MAC" pair per line. A line "group Living" names the
bulbs that follow, until the next group. A token in ~/.wiz/token (or WIZ_TOKEN) is required
from anywhere except this computer. The token is never printed.
"""
import json
import os
import re
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.expanduser('~')
BULBS = os.path.join(HOME, '.wiz', 'bulbs.txt')
TOKEN_FILE = os.path.join(HOME, '.wiz', 'token')
PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'remote', 'index.html')
PORT = int(os.environ.get('WIZ_PORT', '8787'))
TV = os.environ.get('WIZ_TV', '')
TV_MAC = os.environ.get('WIZ_TV_MAC', '')
MAC_FILE = os.path.join(HOME, '.freemytv-bridge', 'tv_mac')
WISH = {'at': 0}
STATUS = {}
STATE_CACHE = {'at': 0.0, 'power': 'off'}

SCENES = {
    'movie': {'state': True, 'dimming': 18, 'temp': 2200},
    'dim': {'state': True, 'dimming': 28, 'temp': 2700},
    'warm': {'state': True, 'dimming': 55, 'temp': 2700},
    'bright': {'state': True, 'dimming': 100, 'temp': 4200},
    'off': {'state': False},
}


def token():
    env = os.environ.get('WIZ_TOKEN', '').strip()
    if env:
        return env
    try:
        with open(TOKEN_FILE, encoding='utf-8') as f:
            return f.read().strip()
    except OSError:
        return ''


def load_bulbs(path):
    groups = {'All': []}
    current = 'All'
    try:
        lines = open(path, encoding='utf-8')
    except OSError:
        return groups
    with lines as f:
        for raw in f:
            line = raw.split('#', 1)[0].strip()
            if not line:
                continue
            if line.lower().startswith('group '):
                current = line.split(None, 1)[1].strip() or 'All'
                groups.setdefault(current, [])
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            bulb = (parts[0], parts[1].replace(':', '').lower())
            if bulb not in groups['All']:
                groups['All'].append(bulb)
            if current != 'All':
                groups.setdefault(current, [])
                if bulb not in groups[current]:
                    groups[current].append(bulb)
    return groups


def pilot(ip, mac, params):
    body = {'method': 'setPilot', 'params': dict(params)}
    if mac:
        body['params']['mac'] = mac
    data = json.dumps(body).encode('utf-8')
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(0.6)
    try:
        sock.sendto(data, (ip, 38899))
        try:
            sock.recvfrom(4096)
        except socket.timeout:
            pass
    finally:
        sock.close()


_remote = None


def tv_remote():
    global _remote
    if _remote is not None:
        return _remote
    from samsungtvws import SamsungTVWS
    _remote = SamsungTVWS(TV, port=8002)
    return _remote


def send_key(name):
    global _remote
    if not TV:
        return False
    try:
        from samsungtvws import SamsungTVWS  # noqa: F401
    except ImportError:
        return False
    try:
        tv_remote().send_key(name)
        return True
    except Exception:
        _remote = None
        try:
            tv_remote().send_key(name)
            return True
        except Exception:
            _remote = None
            return False


def normalize_mac(text):
    compact = re.sub(r'[^0-9a-fA-F]', '', text or '')
    if len(compact) < 12:
        return ''
    pairs = [compact[i:i + 2] for i in range(0, 12, 2)]
    return ':'.join(p.lower() for p in pairs)


def read_mac_file():
    try:
        with open(MAC_FILE, encoding='utf-8') as f:
            return normalize_mac(f.read())
    except OSError:
        return ''


def write_mac(mac):
    mac = normalize_mac(mac)
    if not mac:
        return
    os.makedirs(os.path.dirname(MAC_FILE), exist_ok=True)
    with open(MAC_FILE, 'w', encoding='utf-8') as f:
        f.write(mac + '\n')


def arp_mac(ip):
    if not ip:
        return ''
    try:
        out = subprocess.check_output(['arp', '-n', ip], stderr=subprocess.DEVNULL, text=True, timeout=3)
    except Exception:
        return ''
    match = re.search(r'([0-9a-fA-F]{1,2}[:-]){5}[0-9a-fA-F]{1,2}', out)
    return normalize_mac(match.group(0) if match else '')


def tv_mac(refresh=False):
    if TV_MAC:
        return normalize_mac(TV_MAC)
    cached = read_mac_file()
    if cached and not refresh:
        return cached
    found = arp_mac(TV)
    if found:
        write_mac(found)
        return found
    return cached


def broadcasts(ip):
    found = ['255.255.255.255']
    parts = (ip or '').split('.')
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        found.append('.'.join(parts[:3] + ['255']))
    return found


def wake_on_lan(mac, ip):
    raw = bytes(int(part, 16) for part in mac.split(':'))
    packet = b'\xff' * 6 + raw * 16
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    try:
        for _ in range(5):
            for dest in broadcasts(ip):
                for port in (9, 7):
                    try:
                        sock.sendto(packet, (dest, port))
                    except Exception:
                        pass
            time.sleep(0.15)
    finally:
        sock.close()


def port_open(ip, port, timeout=0.4):
    if not ip:
        return False
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect((ip, port))
        return True
    except Exception:
        return False
    finally:
        sock.close()


def power_state(force=False):
    now = time.time()
    if not force and now - STATE_CACHE['at'] < 2:
        return STATE_CACHE['power']
    # The remote keys use 8002. A short miss on 8001 used to look like "off" and send a wake packet.
    on = port_open(TV, 8002, timeout=1.2) or port_open(TV, 8002, timeout=1.2) or port_open(TV, 8001, timeout=1.2) or api_answers()
    power = 'on' if on else 'off'
    STATE_CACHE['at'] = now
    STATE_CACHE['power'] = power
    if on:
        tv_mac(refresh=True)
    return power


def api_answers():
    if not TV:
        return False
    try:
        urllib.request.urlopen('http://%s:8001/api/v2/' % TV, timeout=1.5).close()
        return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False


def wait_awake(timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if api_answers():
            STATE_CACHE['at'] = time.time()
            STATE_CACHE['power'] = 'on'
            tv_mac(refresh=True)
            return True
        time.sleep(1)
    STATE_CACHE['at'] = time.time()
    STATE_CACHE['power'] = 'off'
    return False


def power_action(action):
    state = power_state(force=True)
    if action == 'toggle':
        action = 'off' if state == 'on' else 'on'
    if action == 'on':
        mac = tv_mac(refresh=state == 'on')
        if not mac:
            return {'power': state, 'ok': False, 'error': 'no mac'}
        wake_on_lan(mac, TV)
        awake = wait_awake(20)
        return {'power': 'on' if awake else 'off', 'ok': awake}
    if action == 'off':
        ok = send_key('KEY_POWER')
        STATE_CACHE['at'] = time.time()
        STATE_CACHE['power'] = 'off'
        return {'power': 'off', 'ok': ok}
    return {'power': state, 'ok': False, 'error': 'action'}



RADAR_COLORS = (
-6,111,107,95,-5,114,110,97,-4,117,112,98,-3,120,115,100,-2,124,117,101,-1,127,120,103,0,130,123,105,1,133,125,106,2,136,128,108,3,139,130,109,4,142,133,111,5,146,136,113,6,158,147,117,7,170,158,121,8,182,169,126,9,194,180,130,10,206,192,135,11,210,196,139,12,214,200,143,13,218,204,147,14,222,208,151,15,136,221,238,16,108,209,235,17,81,197,232,18,54,186,229,19,27,174,226,20,0,163,224,21,0,154,213,22,0,145,202,23,0,136,191,24,0,127,180,25,0,119,170,26,0,112,163,27,0,105,156,28,0,98,149,29,0,91,142,30,0,85,136,31,0,81,128,32,0,78,120,33,0,74,112,34,0,71,104,35,255,238,0,36,255,224,0,37,255,210,0,38,255,197,0,39,255,183,0,40,255,170,0,41,255,159,0,42,255,149,0,43,255,139,0,44,255,129,0,45,255,68,0,46,242,54,0,47,230,40,0,48,217,27,0,49,205,13,0,50,193,0,0,51,168,0,0,52,143,0,0,53,118,0,0,54,93,0,0,55,255,170,255,56,255,159,255,57,255,149,255,58,255,139,255,59,255,129,255,60,255,119,255,61,255,108,255,62,255,98,255,63,255,88,255,64,255,78,255,65,255,255,255,75,0,255,0,-6,203,255,255,-4,202,255,255,-3,201,255,255,-2,200,255,255,-1,199,255,255,1,198,255,255,2,197,255,255,3,196,255,255,4,195,255,255,6,194,255,255,7,193,255,255,8,192,255,255,9,191,255,255,11,184,248,255,12,178,242,255,13,171,235,255,14,165,229,255,15,159,223,255,16,152,216,255,17,146,210,255,18,139,203,255,19,133,197,255,20,127,191,255,21,120,184,255,22,114,178,255,23,107,171,255,24,101,165,255,25,95,159,255,26,91,155,255,27,88,152,255,28,85,149,255,29,82,146,255,30,79,143,255,31,75,139,255,32,72,136,255,33,69,133,255,34,66,130,255,35,63,127,255,36,59,123,255,37,56,120,255,38,53,117,255,39,50,114,255,40,47,111,255,41,43,107,255,42,40,104,255,43,37,101,255,44,34,98,255,45,31,95,255,46,27,91,255,47,24,88,255,48,21,85,255,49,18,82,255,50,15,79,255,51,12,75,255,52,9,72,255,53,6,69,255,54,2,66,255,55,0,63,255,56,0,59,255,57,0,56,255,58,0,53,255,59,0,50,255,60,0,47,255,61,0,43,255,62,0,40,255,63,0,37,255,64,0,34,255,65,0,31,255,66,0,27,255,67,0,24,255,68,0,21,255,69,0,18,255,70,0,15,255,71,0,12,255,72,0,9,255,73,0,6,255,74,0,2,255,75,0,0,255
)
RADAR_CACHE = {}


def dbz_from_pixel(r, g, b, a):
    if a < 16:
        return 0
    best, dbz, i = 1600, None, 0
    while i < len(RADAR_COLORS):
        dr = RADAR_COLORS[i + 1] - r
        dg = RADAR_COLORS[i + 2] - g
        db = RADAR_COLORS[i + 3] - b
        dist = dr * dr + dg * dg + db * db
        if dist < best:
            best, dbz = dist, RADAR_COLORS[i]
        i += 4
    return 0 if dbz is None else dbz


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def png_center(data):
    """RGBA of the center pixel. RainViewer tiles are 8-bit color, sometimes indexed."""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('png')
    i = 8
    idat = b''
    w = h = bit = ctype = None
    plte = trns = None
    while i + 8 <= len(data):
        ln = struct.unpack('>I', data[i:i + 4])[0]
        typ = data[i + 4:i + 8]
        chunk = data[i + 8:i + 8 + ln]
        if typ == b'IHDR':
            w, h, bit, ctype = struct.unpack('>IIBB', chunk[:10])
        elif typ == b'PLTE':
            plte = chunk
        elif typ == b'tRNS':
            trns = chunk
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
        i += 12 + ln
    raw = zlib.decompress(idat)
    if ctype == 6 and bit == 8:
        stride, bpp = w * 4, 4
    elif ctype == 2 and bit == 8:
        stride, bpp = w * 3, 3
    elif ctype == 3 and bit == 8:
        stride, bpp = w, 1
    elif ctype == 3 and bit == 4:
        stride, bpp = (w + 1) // 2, 1
    else:
        raise ValueError('png')
    pos = 0
    prev = bytearray(stride)
    rows = []
    for _y in range(h):
        filt = raw[pos]
        pos += 1
        row = bytearray(raw[pos:pos + stride])
        pos += stride
        if filt == 1:
            for k in range(stride):
                row[k] = (row[k] + (row[k - bpp] if k >= bpp else 0)) & 255
        elif filt == 2:
            for k in range(stride):
                row[k] = (row[k] + prev[k]) & 255
        elif filt == 3:
            for k in range(stride):
                left = row[k - bpp] if k >= bpp else 0
                row[k] = (row[k] + ((left + prev[k]) // 2)) & 255
        elif filt == 4:
            for k in range(stride):
                a = row[k - bpp] if k >= bpp else 0
                b = prev[k]
                c = prev[k - bpp] if k >= bpp else 0
                row[k] = (row[k] + _paeth(a, b, c)) & 255
        elif filt != 0:
            raise ValueError('png')
        prev = row
        rows.append(row)
    x, y = w // 2, h // 2
    if ctype == 6:
        o = x * 4
        return tuple(rows[y][o:o + 4])
    if ctype == 2:
        o = x * 3
        px = rows[y][o:o + 3]
        return (px[0], px[1], px[2], 255)
    if bit == 8:
        idx = rows[y][x]
    else:
        byte = rows[y][x // 2]
        idx = (byte >> 4) & 15 if x % 2 == 0 else byte & 15
    r, g, b = plte[idx * 3:idx * 3 + 3]
    a = trns[idx] if trns and idx < len(trns) else 255
    return (r, g, b, a)


def radar_sample(lat, lon):
    lat, lon = float(lat), float(lon)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError('place')
    key = '%.2f,%.2f' % (lat, lon)
    hit = RADAR_CACHE.get(key)
    if hit and time.time() - hit['at'] < 120:
        return hit['body']
    req = urllib.request.Request(
        'https://api.rainviewer.com/public/weather-maps.json',
        headers={'User-Agent': 'FreeMyTV'})
    with urllib.request.urlopen(req, timeout=8) as res:
        meta = json.loads(res.read().decode())
    frame = meta['radar']['past'][-1]
    url = '%s%s/256/7/%.4f/%.4f/2/0_0.png' % (meta['host'], frame['path'], lat, lon)
    req = urllib.request.Request(url, headers={'User-Agent': 'FreeMyTV'})
    with urllib.request.urlopen(req, timeout=8) as res:
        pixel = png_center(res.read())
    dbz = dbz_from_pixel(*pixel)
    if dbz < 20:
        intensity = 'none'
    elif dbz < 35:
        intensity = 'light'
    elif dbz < 45:
        intensity = 'moderate'
    else:
        intensity = 'heavy'
    body = {'dbz': dbz, 'intensity': intensity, 'frameTime': frame.get('time') or 0}
    RADAR_CACHE[key] = {'at': time.time(), 'body': body}
    return body


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Status only. The path can carry the token, so it is not written.
        code = args[1] if len(args) > 1 else ''
        sys.stderr.write('wiz-bridge %s\n' % code)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Token')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    def _authorized(self):
        expected = token()
        host = self.client_address[0]
        if host in ('127.0.0.1', '::1') and not expected:
            return True
        if not expected:
            return False
        got = self.headers.get('X-Bridge-Token', '')
        if not got:
            got = (parse_qs(urlparse(self.path).query).get('k') or [''])[0]
        return got == expected

    def _json(self, code, obj):
        raw = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read(self):
        n = int(self.headers.get('Content-Length', '0') or 0)
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode('utf-8'))
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/', '/remote'):
            try:
                with open(PAGE, 'rb') as f:
                    raw = f.read()
            except OSError:
                raw = b'phone page missing'
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if not self._authorized():
            self._json(401, {'error': 'token'})
            return
        if path == '/lights':
            groups = load_bulbs(BULBS)
            self._json(200, {'groups': sorted(groups), 'bulbs': len(groups.get('All', []))})
            return
        if path == '/tv/wish':
            self._json(200, WISH)
            return
        if path == '/tv/state':
            self._json(200, {'power': power_state()})
            return
        if path == '/tv/status':
            self._json(200, STATUS or {'at': 0})
            return
        if path == '/health':
            self._json(200, {'ok': True})
            return
        if path == '/weather/radar':
            qs = parse_qs(urlparse(self.path).query)
            try:
                self._json(200, radar_sample((qs.get('lat') or [''])[0], (qs.get('lon') or [''])[0]))
            except Exception:
                self._json(502, {'dbz': None, 'intensity': 'none', 'frameTime': 0})
            return
        self._json(404, {})

    def do_POST(self):
        path = urlparse(self.path).path
        if not self._authorized():
            self._json(401, {'error': 'token'})
            return
        body = self._read()
        if path == '/lights/scene':
            scene = SCENES.get(body.get('scene') or '')
            if not scene:
                self._json(400, {'error': 'scene'})
                return
            groups = load_bulbs(BULBS)
            name = body.get('group') or 'All'
            bulbs = groups.get(name) or groups.get('All') or []
            for ip, mac in bulbs:
                try:
                    pilot(ip, mac, scene)
                except Exception:
                    pass
            self._json(200, {'ok': True, 'count': len(bulbs)})
            return
        if path == '/tv/wish':
            for key in ('homeShow', 'saver', 'ambient'):
                if key in body:
                    WISH[key] = body[key]
            WISH['at'] = int(time.time() * 1000)
            self._json(200, WISH)
            return
        if path == '/tv/key':
            ok = send_key(str(body.get('key') or ''))
            self._json(200 if ok else 503, {'ok': ok})
            return
        if path == '/tv/power':
            action = body.get('action') or 'toggle'
            if action not in ('on', 'off', 'toggle'):
                self._json(400, {'error': 'action'})
                return
            self._json(200, power_action(action))
            return
        if path == '/tv/status':
            kept = {}
            for key in ('at', 'view', 'ambient', 'saver', 'photo', 'weather', 'app'):
                if key in body:
                    kept[key] = body[key]
            kept['received'] = int(time.time() * 1000)
            STATUS.clear()
            STATUS.update(kept)
            self._json(200, {'ok': True})
            return
        self._json(404, {})


def install_login(tv):
    plist = os.path.join(HOME, 'Library', 'LaunchAgents', 'io.freemytv.wizbridge.plist')
    os.makedirs(os.path.dirname(plist), exist_ok=True)
    script = os.path.abspath(__file__)
    env = ''
    if tv:
        env += '    <key>WIZ_TV</key><string>%s</string>\n' % tv
    extra = ''
    if TV_MAC:
        extra = '<string>--tv-mac</string><string>%s</string>' % TV_MAC
    body = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.freemytv.wizbridge</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/python3</string><string>%s</string>%s</array>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
%s  </dict>
</dict></plist>
''' % (script, extra, env)
    with open(plist, 'w', encoding='utf-8') as f:
        f.write(body)
    print('Wrote %s' % plist)
    print('Then: launchctl load -w ~/Library/LaunchAgents/io.freemytv.wizbridge.plist')


def main():
    global TV, PORT, TV_MAC
    args = sys.argv[1:]
    if '--tv' in args:
        TV = args[args.index('--tv') + 1]
    if '--tv-mac' in args:
        TV_MAC = normalize_mac(args[args.index('--tv-mac') + 1])
        if TV_MAC:
            write_mac(TV_MAC)
    if '--port' in args:
        PORT = int(args[args.index('--port') + 1])
    if '--install-login' in args:
        install_login(TV)
        return
    os.makedirs(os.path.dirname(BULBS), exist_ok=True)
    if not os.path.exists(BULBS):
        with open(BULBS, 'w', encoding='utf-8') as f:
            f.write('# group Living\n# 192.168.86.21 aabbccddeeff\n')
    httpd = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print('Free My TV bridge on port %s' % PORT)
    print('Phone: http://<this Mac>:8787/')
    httpd.serve_forever()


if __name__ == '__main__':
    main()
