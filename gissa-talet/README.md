# Guess the Number

A Roblox-style 3D number guessing game: two students at a school desk try to
work out each other's secret number (1–100). Modes:

| Mode | How it works |
|---|---|
| **PLAY** | You vs Sam, a bot that uses binary search |
| **2 PLAYERS** | Two people on the same screen |
| **ONLINE** | Quick match – you're paired with the next player who is looking for a game |
| **PARTY** | One player creates a room and gets a 4-character code, a friend types the code to join |

**Coins & shop:** every time *you* win (vs Sam, online or party) you earn 100
coins. Spend them in the 🛒 **SHOP** on victory dances that your student does
on the chair when you win: Chair Hop (free), Disco, Floss, Dab, Robot, Macarena,
Spin, Backflip and Headspin (every card plays its dance on repeat, locked ones
behind a padlock). Online, your opponent sees your dance too.

The expensive **finishers** happen to your *opponent* when you win: Anvil Drop
(1100), Trapdoor (1200), Balloon Pop (1300), Deep Freeze (1400), Lightning
(1500), Rocket Chair (1600), UFO Abduction (1800), Black Hole (2500) and Meteor
Strike (3000). Tap an equipped finisher to turn it off. Sam has no finisher, and
online your opponent sees yours. Coins, dances and finishers are saved in the
browser.

Online and party games have a **quick chat** (💬): 8 emotes that make your
student wave, cheer, laugh, think or cry, and 8 fixed phrases like "GG! 🤝" or
"Rematch? 🔁". There is no free text, the server only relays known ids and
allows one message per second, and players can hide the opponent's chat.

Online and party games have time limits so nobody can stall: 45 seconds to pick
a secret number and 30 seconds per guess. When time runs out the server picks a
random number / makes a random possible guess for that player.

## Start the game

ONLINE and PARTY need the game server. It only uses the Python standard
library, so there's nothing to install:

```bash
python server.py
```

Then open **http://localhost:8080**. The server prints the address friends on
the same Wi-Fi can use (for example `http://192.168.1.11:8080`). Windows may ask
whether Python is allowed through the firewall – allow it on private networks.

Use another port with `set PORT=3000` (Windows) or `PORT=3000 python server.py`.

PLAY and 2 PLAYERS also work from any static web server, but the page has to be
served over http(s) – opening `index.html` directly as a file doesn't work.
The game loads three.js and the Fredoka font from the internet.

## Play with friends over the internet

Friends outside your network can't reach `localhost`. Host the server online,
for example on [Render](https://render.com) (free tier):

1. Put this folder in a GitHub repository.
2. On Render: **New → Web Service**, pick the repository.
3. Runtime **Python 3**, build command `pip install -r requirements.txt` (the file is empty on purpose), start command `python server.py`.
4. Open the `https://…onrender.com` address and share it – invite links use that address automatically.

Render sets the `PORT` variable itself; the server reads it. On the free tier the
server falls asleep after a while without players; the game wakes it up and shows
"Waking up the game server…" (up to about a minute).

Player names are shown to the opponent, so the server swaps rude names for a guest
name (`Guest 123`).

## Publish on CrazyGames

CrazyGames only hosts the game's files, so ONLINE and PARTY use the server on
Render (see above) – deploy that first. Then build the files to upload, with your
server's address:

```bash
py -3 build_crazygames.py https://your-game.onrender.com
```

This makes the folder `dist/guess-the-number/` (index.html, style.css and js/, with
the address filled in to `js/config.js` and the CrazyGames SDK added to index.html).
In the CrazyGames developer portal, upload that folder's contents (they don't accept
zip files), write a description and the controls (mouse / touch), and add the
covers: 1920×1080, 800×1200 and 800×800 images (only the game's title as text) and
a 15–20 s silent preview video in both 16:9 and 2:3, 1080p.

On CrazyGames the game uses the SDK (`js/crazygames.js`) for:

- **Usernames** – a logged-in player's CrazyGames name is used (and can't be changed).
- **Invites** – a party room shows CrazyGames' invite link, the room is shown as
  joinable until the game starts, and a friend who opens the link (or clicks Join)
  goes straight into the room.
- **Instant multiplayer** – when CrazyGames asks for it, a party room opens right away.
- **Chat and sound settings** – CrazyGames can turn off the chat and mute the sound.
- **Gameplay start / stop and happytime** (when you win an online match).

To test it locally, run the built folder on localhost (e.g.
`py -3 -m http.server 8091 --directory dist/guess-the-number`); the SDK then runs in
test mode. Add `?instantJoin=true`, `?disableChat=true&muteAudio=true` or
`?czy_invite=true&room=CODE` to the address to try those parts.

## Files

| File | What it does |
|---|---|
| `index.html` | Page structure: home screen, HUD, number picker, lobby, settings |
| `style.css` | Roblox-style look (outlined text, Lego tiles, buttons) |
| `js/main.js` | Game rules and flow for every mode |
| `js/scene3d.js` | The 3D classroom, the students and their animations |
| `js/net.js` | WebSocket connection to the server |
| `js/config.js` | Where the game server is (empty = the same address as the game) |
| `js/crazygames.js` | CrazyGames SDK: usernames, invites, chat/sound settings (off outside CrazyGames) |
| `build_crazygames.py` | Makes the folder to upload to CrazyGames |
| `covers/` | Cover images for CrazyGames (1920×1080, 800×1200, 800×800) |
| `server.py` | Serves the files and runs ONLINE / PARTY. It keeps the secret numbers and decides Higher / Lower, so players can't cheat |
