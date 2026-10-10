#!/usr/bin/env python3
"""
Guess the Number - game server.

Serves the game files and runs the ONLINE (quick match) and PARTY (room code)
modes over WebSockets. Uses only the Python standard library.

    python server.py             -> http://localhost:8080
    set PORT=3000 & python server.py   (Windows)  /  PORT=3000 python server.py

The server is authoritative: it keeps both secret numbers, checks every guess
and decides Higher / Lower, so nobody can cheat from the browser.
"""

import asyncio
import base64
import hashlib
import json
import os
import random
import re
import socket
import struct
import time
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))

# Only these files are served (never server.py or anything else in the folder)
STATIC_PATH = re.compile(r"^/(index\.html|style\.css|js/[a-z0-9-]+\.js)$")
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
}

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_MESSAGE = 4096
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no I/O/0/1, they're easy to mix up
ALLOWED_MAX = (50, 100, 1000)
ONLINE_MAX = 100

# Time limits so nobody can stall a game (seconds). When time runs out the
# server picks a random secret number / a random possible guess for that player.
CHOOSE_TIME = 45
TURN_TIME = 30

# Quick chat: only these ids are relayed (no free text), at most one per second per player.
# The browser turns the ids into text / emojis.
CHAT_IDS = {
    "phrase": {"gg", "gl", "nice", "close", "hmm", "wow", "hurry", "rematch"},
    "emote": {"wave", "laugh", "cool", "think", "cry", "love", "fire", "party"},
}
CHAT_COOLDOWN = 1.0

# Victory dances from the shop – the opponent sees yours when you win
DANCE_IDS = {"hop", "disco", "floss", "dab", "robot", "macarena", "spin", "flip", "headspin"}
# Finishers from the shop – what happens to the opponent when you win ("" = none)
FINISHER_IDS = {"anvil", "trapdoor", "balloon", "freeze", "lightning", "rocket", "ufo", "blackhole", "meteor"}

# Same pacing as the single-player game (seconds)
START_DELAY = 0.5
ANSWER_DELAY = 1.2
NEXT_TURN_DELAY = 1.7


# ================= WebSocket (RFC 6455, text frames only) =================
class WebSocket:
    def __init__(self, reader, writer):
        self.reader = reader
        self.writer = writer
        self.closed = False
        self._lock = asyncio.Lock()

    async def _send_frame(self, opcode, payload=b""):
        if self.closed:
            return
        header = bytearray([0x80 | opcode])
        size = len(payload)
        if size < 126:
            header.append(size)
        elif size < 65536:
            header += bytes([126]) + struct.pack("!H", size)
        else:
            header += bytes([127]) + struct.pack("!Q", size)
        async with self._lock:
            try:
                self.writer.write(bytes(header) + payload)
                await self.writer.drain()
            except (ConnectionError, OSError):
                self.closed = True

    async def send_json(self, message):
        await self._send_frame(0x1, json.dumps(message, separators=(",", ":")).encode())

    async def ping(self):
        await self._send_frame(0x9)

    async def recv(self):
        """Return the next text message, or None when the connection closes."""
        parts = []
        total = 0
        while True:
            b0, b1 = await self.reader.readexactly(2)
            fin, opcode = b0 & 0x80, b0 & 0x0F
            length = b1 & 0x7F
            if length == 126:
                (length,) = struct.unpack("!H", await self.reader.readexactly(2))
            elif length == 127:
                (length,) = struct.unpack("!Q", await self.reader.readexactly(8))
            if not b1 & 0x80 or length > MAX_MESSAGE:   # clients must mask; keep messages small
                await self.close(1009)
                return None
            mask = await self.reader.readexactly(4)
            data = bytes(b ^ mask[i % 4] for i, b in enumerate(await self.reader.readexactly(length)))
            if opcode == 0x8:          # close
                await self.close()
                return None
            if opcode == 0x9:          # ping -> pong
                await self._send_frame(0xA, data)
                continue
            if opcode == 0xA:          # pong
                continue
            total += length
            if total > MAX_MESSAGE:
                await self.close(1009)
                return None
            parts.append(data)
            if fin:
                return b"".join(parts).decode("utf-8", errors="replace")

    async def close(self, code=1000):
        if self.closed:
            return
        await self._send_frame(0x8, struct.pack("!H", code))
        self.closed = True
        try:
            self.writer.close()
        except Exception:
            pass


# ================= Players and rooms =================
class Player:
    _next_id = 0

    def __init__(self, ws):
        Player._next_id += 1
        self.id = Player._next_id
        self.ws = ws
        self.name = clean_name("")
        self.room = None
        self.dance = "hop"
        self.finisher = ""
        self.last_chat = 0.0
        self.outbox = asyncio.Queue()

    def send(self, **message):
        if not self.ws.closed:
            self.outbox.put_nowait(message)

    async def pump(self):
        # One sender per player keeps the messages in order
        while True:
            message = await self.outbox.get()
            await self.ws.send_json(message)


# Names are shown to the other player, so rude ones are swapped for a guest name (game portals
# like CrazyGames require player-written text to be moderated). Checked without accents and
# number-for-letter tricks, so "F u c k" or "5h1t" don't slip through. Long words count anywhere
# in the name (spaces ignored); short ones only on their own, so names like Bogdan are fine.
BLOCKED_ANYWHERE = (
    "fuck", "shit", "bitch", "cunt", "pussy", "whore", "slut", "nigg", "nazi", "hitler", "penis",
    "vagina", "porn", "retard", "asshole", "bastard", "wank", "twat", "fitta", "javla", "helvete",
    "neger", "knull",
)
BLOCKED_WORDS = {"fag", "rape", "dick", "cock", "kuk", "bog", "hora", "jude", "sex", "ass"}
LEET = str.maketrans("0134578@$!|", "oieastbasii")


def is_rude(name):
    plain = unicodedata.normalize("NFKD", name.lower()).encode("ascii", "ignore").decode().translate(LEET)
    words = re.findall(r"[a-z]+", plain)
    joined = "".join(words)
    return any(bad in joined for bad in BLOCKED_ANYWHERE) or any(word in BLOCKED_WORDS for word in words)


def clean_name(raw):
    name = "".join(ch for ch in str(raw or "") if ch.isprintable()).strip()[:16]
    if not name or is_rude(name):
        return f"Guest {random.randint(100, 999)}"
    return name


class Room:
    def __init__(self, kind, max_n):
        self.kind = kind            # 'online' | 'party'
        self.max = max_n
        self.code = None
        self.players = []
        self.phase = "lobby"        # 'lobby' | 'choose' | 'guess' | 'over'
        self.task = None            # the running sequence (answer -> next turn ...)
        self.timer = None           # the time limit for the current choice / turn
        self.reset()

    def reset(self):
        self.secrets = [None, None]
        self.ranges = [[1, self.max], [1, self.max]]   # ranges[i] = what player i knows about the opponent's number
        self.turn = 0
        self.busy = False
        self.rematch = [False, False]

    def index(self, player):
        return self.players.index(player)

    def other(self, player):
        return self.players[1 - self.index(player)]

    def broadcast(self, **message):
        for p in self.players:
            p.send(**message)

    def run(self, coro):
        self.cancel()
        self.task = asyncio.create_task(coro)

    def cancel(self):
        self.cancel_timer()
        if self.task and not self.task.done():
            self.task.cancel()
        self.task = None

    def set_timer(self, seconds, on_timeout):
        self.cancel_timer()

        async def wait_then_act():
            await asyncio.sleep(seconds)
            self.timer = None
            on_timeout()

        self.timer = asyncio.create_task(wait_then_act())

    def cancel_timer(self):
        # Never cancel the timer from inside itself (that's how it acts on a timeout)
        if self.timer and self.timer is not asyncio.current_task() and not self.timer.done():
            self.timer.cancel()
        self.timer = None

    def valid(self, n):
        return isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= self.max

    # ----- PHASE 1: both pick a secret number -----
    def start(self):
        self.cancel()
        self.reset()
        self.phase = "choose"
        names = [p.name for p in self.players]
        dances = [p.dance for p in self.players]
        finishers = [p.finisher for p in self.players]
        for i, p in enumerate(self.players):
            p.send(t="start", you=i, names=names, dances=dances, finishers=finishers,
                   max=self.max, kind=self.kind, code=self.code, time=CHOOSE_TIME)
        self.set_timer(CHOOSE_TIME, self.choose_timeout)

    def on_secret(self, player, n):
        i = self.index(player)
        if self.phase != "choose" or self.secrets[i] is not None or not self.valid(n):
            return player.send(t="error", msg="You can't pick that number right now.")
        self.lock_secret(i, n)
        return None

    def lock_secret(self, i, n, auto=False):
        self.secrets[i] = n
        self.players[i].send(t="secretOk", n=n, auto=auto)
        self.players[1 - i].send(t="oppReady")
        if None not in self.secrets:
            self.run(self.begin_turns())

    def choose_timeout(self):
        # Time's up: pick a random number for whoever hasn't chosen yet
        if self.phase != "choose":
            return
        for i in (0, 1):
            if self.secrets[i] is None:
                self.lock_secret(i, random.randint(1, self.max), auto=True)

    async def begin_turns(self):
        await asyncio.sleep(START_DELAY)
        self.phase = "guess"
        self.start_turn(random.randint(0, 1))

    # ----- PHASE 2: take turns guessing -----
    def start_turn(self, i):
        self.turn = i
        self.busy = False
        self.broadcast(t="turn", who=i, time=TURN_TIME)
        self.set_timer(TURN_TIME, self.turn_timeout)

    def turn_timeout(self):
        # Time's up: guess a random number from what's still possible
        if self.phase == "guess" and not self.busy:
            low, high = self.ranges[self.turn]
            self.make_guess(self.turn, random.randint(low, high), auto=True)

    def on_guess(self, player, n):
        i = self.index(player)
        low, high = self.ranges[i]
        if self.phase != "guess" or self.busy or self.turn != i or not self.valid(n) or not low <= n <= high:
            return player.send(t="error", msg="That guess isn't allowed right now.")
        self.make_guess(i, n)
        return None

    def make_guess(self, i, n, auto=False):
        self.cancel_timer()
        self.busy = True
        self.broadcast(t="guess", by=i, n=n, auto=auto)
        self.run(self.resolve(i, n))

    async def resolve(self, i, n):
        await asyncio.sleep(ANSWER_DELAY)
        secret = self.secrets[1 - i]
        rng = self.ranges[i]
        if n == secret:
            answer = "correct"
        elif secret > n:
            answer = "higher"
            rng[0] = n + 1
        else:
            answer = "lower"
            rng[1] = n - 1
        self.broadcast(t="answer", by=i, n=n, answer=answer)

        # PHASE 3: only a correct guess wins. With one number left the turn still passes,
        # and that number has to be guessed on the next turn.
        if answer == "correct":
            return self.finish(i)

        await asyncio.sleep(NEXT_TURN_DELAY)
        self.start_turn(1 - i)

    def finish(self, winner):
        self.cancel_timer()
        self.phase = "over"
        self.busy = False
        self.rematch = [False, False]
        self.broadcast(t="over", winner=winner, secrets=self.secrets)

    def on_chat(self, player, kind, chat_id):
        if len(self.players) < 2 or not isinstance(kind, str) or not isinstance(chat_id, str):
            return
        if chat_id not in CHAT_IDS.get(kind, ()):
            return
        now = time.monotonic()
        if now - player.last_chat < CHAT_COOLDOWN:
            return
        player.last_chat = now
        self.broadcast(t="chat", by=self.index(player), kind=kind, id=chat_id)

    def on_rematch(self, player):
        if self.phase != "over" or len(self.players) < 2:
            return
        self.rematch[self.index(player)] = True
        if all(self.rematch):
            self.start()
        else:
            self.other(player).send(t="oppRematch")


rooms = {}       # code -> Room (party rooms)
waiting = None   # player waiting for a quick match


def new_code():
    while True:
        code = "".join(random.choice(CODE_CHARS) for _ in range(4))
        if code not in rooms:
            return code


def stop_waiting(player):
    global waiting
    if waiting is player:
        waiting = None


def leave_room(player):
    room = player.room
    if room is None:
        return
    player.room = None
    room.cancel()
    if player in room.players:
        room.players.remove(player)
    for p in room.players:
        p.room = None
        p.send(t="oppLeft")
    room.players.clear()
    if room.code:
        rooms.pop(room.code, None)


def quick_match(player):
    global waiting
    leave_room(player)
    if waiting is player:
        return player.send(t="queued")
    if waiting is not None and not waiting.ws.closed:
        opponent, waiting = waiting, None
        room = Room("online", ONLINE_MAX)
        for p in (opponent, player):
            room.players.append(p)
            p.room = room
        room.start()
    else:
        waiting = player
        player.send(t="queued")


def create_room(player, max_n):
    stop_waiting(player)
    leave_room(player)
    room = Room("party", max_n if max_n in ALLOWED_MAX else 100)
    room.code = new_code()
    rooms[room.code] = room
    room.players.append(player)
    player.room = room
    player.send(t="room", code=room.code, max=room.max, lan=LAN_URLS)


def join_room(player, raw_code):
    code = str(raw_code or "").strip().upper()
    room = rooms.get(code)
    if room is None:
        return player.send(t="error", msg="There's no room with that code.", where="join")
    if player in room.players:
        return None
    if len(room.players) >= 2 or room.phase != "lobby":
        return player.send(t="error", msg="That room is already full.", where="join")
    stop_waiting(player)
    leave_room(player)
    room.players.append(player)
    player.room = room
    room.start()
    return None


def handle_message(player, message):
    kind = message.get("t")
    if "name" in message:
        player.name = clean_name(message.get("name"))
    dance = message.get("dance")
    if isinstance(dance, str) and dance in DANCE_IDS:
        player.dance = dance
    if "finisher" in message:
        finisher = message.get("finisher")
        player.finisher = finisher if isinstance(finisher, str) and finisher in FINISHER_IDS else ""
    if kind == "quick":
        quick_match(player)
    elif kind == "create":
        create_room(player, message.get("max"))
    elif kind == "join":
        join_room(player, message.get("code"))
    elif kind in ("cancel", "leave"):
        stop_waiting(player)
        leave_room(player)
    elif player.room is not None:
        if kind == "secret":
            player.room.on_secret(player, message.get("n"))
        elif kind == "guess":
            player.room.on_guess(player, message.get("n"))
        elif kind == "rematch":
            player.room.on_rematch(player)
        elif kind == "chat":
            player.room.on_chat(player, message.get("kind"), message.get("id"))


class RateLimit:
    def __init__(self, rate=10, burst=30):
        self.rate, self.burst, self.tokens, self.last = rate, burst, burst, time.monotonic()

    def allow(self):
        now = time.monotonic()
        self.tokens = min(self.burst, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True


async def keep_alive(ws):
    # Some hosts drop idle connections, so ping every 25 seconds
    while not ws.closed:
        await asyncio.sleep(25)
        await ws.ping()


async def run_player(ws):
    player = Player(ws)
    pump = asyncio.create_task(player.pump())
    pinger = asyncio.create_task(keep_alive(ws))
    limit = RateLimit()
    try:
        while True:
            text = await ws.recv()
            if text is None:
                break
            if not limit.allow():
                await ws.close(1008)
                break
            try:
                message = json.loads(text)
            except ValueError:
                continue
            if isinstance(message, dict):
                handle_message(player, message)
    except (asyncio.IncompleteReadError, ConnectionError, OSError):
        pass
    finally:
        stop_waiting(player)
        leave_room(player)
        pump.cancel()
        pinger.cancel()
        await ws.close()


# ================= HTTP (static files + WebSocket upgrade) =================
async def respond(writer, status, body, content_type="text/plain; charset=utf-8", head_only=False):
    reason = {200: "OK", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed"}[status]
    head = (
        f"HTTP/1.1 {status} {reason}\r\n"
        f"Content-Type: {content_type}\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Cache-Control: no-cache\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "Connection: close\r\n\r\n"
    )
    try:
        writer.write(head.encode() + (b"" if head_only else body))
        await writer.drain()
    except (ConnectionError, OSError):
        pass
    finally:
        writer.close()


async def handle_client(reader, writer):
    try:
        raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=10)
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError, OSError):
        writer.close()
        return

    lines = raw.decode("latin-1").split("\r\n")
    try:
        method, target, _ = lines[0].split(" ", 2)
    except ValueError:
        return await respond(writer, 400, b"Bad request")
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            key, value = line.split(":", 1)
            headers[key.strip().lower()] = value.strip()
    path = target.split("?", 1)[0]

    if path == "/ws":
        key = headers.get("sec-websocket-key")
        if headers.get("upgrade", "").lower() != "websocket" or not key:
            return await respond(writer, 400, b"Expected a WebSocket upgrade")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        writer.write(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode()
        )
        try:
            await writer.drain()
        except (ConnectionError, OSError):
            return None
        return await run_player(WebSocket(reader, writer))

    if method not in ("GET", "HEAD"):
        return await respond(writer, 405, b"Method not allowed")
    if path == "/":
        path = "/index.html"
    if not STATIC_PATH.match(path):
        return await respond(writer, 404, b"Not found")
    file = ROOT / path.lstrip("/")
    try:
        body = file.read_bytes()
    except OSError:
        return await respond(writer, 404, b"Not found")
    return await respond(writer, 200, body, MIME[file.suffix], head_only=(method == "HEAD"))


def lan_urls():
    # Find this computer's address on the local network (no packets are sent)
    ips = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    return [f"http://{ip}:{PORT}" for ip in sorted(ips) if not ip.startswith("127.")]


LAN_URLS = lan_urls()


async def main():
    server = await asyncio.start_server(handle_client, HOST, PORT)
    print("Guess the Number server is running!", flush=True)
    print(f"  On this computer:      http://localhost:{PORT}", flush=True)
    for url in LAN_URLS:
        print(f"  Friends on your Wi-Fi: {url}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer stopped.")
