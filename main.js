import { createScene, PANEL_SLIDE_MS, panelEaseCss } from './scene3d.js';
import { createConnection } from './net.js';
import { GAME_SERVER } from './config.js';
import { crazy, initCrazyGames } from './crazygames.js';

// ================= Settings =================
const SETTING_OPTIONS = {
  sound: [true, false],
  level: ['easy', 'medium', 'smart'],     // Sam's level
  first: ['player', 'bot', 'random'],     // who guesses first
  max: [50, 100, 1000],                   // number range 1–max
  speed: ['slow', 'normal', 'fast'],
};
const DEFAULT_SETTINGS = { sound: true, level: 'smart', first: 'player', max: 100, speed: 'normal' };
const SPEED_FACTOR = { slow: 1.35, normal: 1, fast: 0.6 };
const LEVEL_JITTER = { easy: 1, medium: 0.5, smart: 0 }; // 0 = pure binary search, 1 = fully random within the range

const TIMING = {
  botChooseMs: [1400, 2400],   // how long Sam "picks" his number
  botThinkMs: [1300, 2200],    // how long Sam "thinks" before guessing
  answerDelayMs: 1200,         // pause between a guess and the answer
  nextTurnDelayMs: 1700,       // pause before the turn passes
};

const SERVER_HELP = GAME_SERVER
  ? "Can't reach the game server right now. Try again in a minute."
  : "Can't reach the game server. Start it with  python server.py  and open the address it shows.";

const settings = loadSettings();

function loadSettings() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('gissa-talet-settings') || '{}'); } catch { /* no storage */ }
  const result = { ...DEFAULT_SETTINGS };
  for (const [key, options] of Object.entries(SETTING_OPTIONS)) {
    if (options.includes(stored[key])) result[key] = stored[key];
  }
  return result;
}

function saveSettings() {
  try { localStorage.setItem('gissa-talet-settings', JSON.stringify(settings)); } catch { /* no storage */ }
}

let crazyName = null;   // the player's CrazyGames username (when logged in there)

function loadName() {
  let name = '';
  try { name = localStorage.getItem('gissa-talet-name') || ''; } catch { /* no storage */ }
  return name || `Player ${Math.floor(100 + Math.random() * 900)}`;
}

function saveName(name) {
  try { localStorage.setItem('gissa-talet-name', name); } catch { /* no storage */ }
}

// Text above the heads (exactly as in the spec)
const TEXT = {
  choosing: 'Choosing number...',
  ready: 'Ready!',
  guessing: 'Guessing...',
  waiting: 'Waiting...',
  guess: n => `I guess your number is ${n}`,
  higher: 'Higher',
  lower: 'Lower',
  correct: 'Correct!',
  winner: 'Winner!',
  lost: 'Lost',
};
const STATUS_EMOJI = { choosing: ' 🤔', ready: ' ✅', guessing: ' 💭', winner: ' 🏆', lost: ' 😭' };

// Quick chat (online). The server only relays these ids, so nobody can type anything mean.
const CHAT_PHRASES = {
  gg: 'GG! 🤝',
  gl: 'Good luck! 🍀',
  nice: 'Nice guess! 👍',
  close: 'So close! 😬',
  hmm: 'Hmm... 🤔',
  wow: 'Wow! 😮',
  hurry: 'Your turn! ⏰',
  rematch: 'Rematch? 🔁',
};
// emoji + the gesture the student makes (see scene3d.js) + the face meanwhile
const CHAT_EMOTES = {
  wave: { emoji: '👋', gesture: 'wave', face: 'smile' },
  laugh: { emoji: '😂', gesture: 'bounce', face: 'happy' },
  cool: { emoji: '😎', gesture: 'nod', face: 'smile' },
  think: { emoji: '🤔', gesture: 'think', face: 'think' },
  cry: { emoji: '😭', gesture: 'slump', face: 'sad' },
  love: { emoji: '😍', gesture: 'bounce', face: 'happy' },
  fire: { emoji: '🔥', gesture: 'cheer', face: 'happy' },
  party: { emoji: '🎉', gesture: 'cheer', face: 'happy' },
};
const CHAT_COOLDOWN_MS = 1200;

// ================= Coins & shop =================
const WIN_REWARD = 100;
// Victory dances (the moves themselves live in scene3d.js)
const SHOP_DANCES = [
  { id: 'hop', name: 'Chair Hop', price: 0, rarity: 'common' },
  { id: 'disco', name: 'Disco', price: 100, rarity: 'rare' },
  { id: 'floss', name: 'Floss', price: 200, rarity: 'rare' },
  { id: 'dab', name: 'Dab', price: 250, rarity: 'epic' },
  { id: 'robot', name: 'Robot', price: 300, rarity: 'epic' },
  { id: 'macarena', name: 'Macarena', price: 350, rarity: 'epic' },
  { id: 'spin', name: 'Spin', price: 400, rarity: 'legendary' },
  { id: 'flip', name: 'Backflip', price: 600, rarity: 'legendary' },
  { id: 'headspin', name: 'Headspin', price: 800, rarity: 'legendary' },
];
const DANCE_IDS = SHOP_DANCES.map(d => d.id);
// Finishers: something happens to your OPPONENT when you win (the effects live in scene3d.js)
const SHOP_FINISHERS = [
  { id: 'anvil', name: 'Anvil Drop', price: 1100, rarity: 'mythic' },
  { id: 'trapdoor', name: 'Trapdoor', price: 1200, rarity: 'mythic' },
  { id: 'balloon', name: 'Balloon Pop', price: 1300, rarity: 'mythic' },
  { id: 'freeze', name: 'Deep Freeze', price: 1400, rarity: 'mythic' },
  { id: 'lightning', name: 'Lightning', price: 1500, rarity: 'mythic' },
  { id: 'rocket', name: 'Rocket Chair', price: 1600, rarity: 'mythic' },
  { id: 'ufo', name: 'UFO Abduction', price: 1800, rarity: 'godly' },
  { id: 'blackhole', name: 'Black Hole', price: 2500, rarity: 'godly' },
  { id: 'meteor', name: 'Meteor Strike', price: 3000, rarity: 'godly' },
];
const FINISHER_IDS = SHOP_FINISHERS.map(f => f.id);
const SHOP_ITEMS = [...SHOP_DANCES.map(d => ({ ...d, kind: 'dance' })), ...SHOP_FINISHERS.map(f => ({ ...f, kind: 'finisher' }))];

const wallet = loadWallet();

function loadWallet() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('gissa-talet-wallet') || '{}'); } catch { /* no storage */ }
  const known = [...DANCE_IDS, ...FINISHER_IDS];
  const owned = Array.isArray(stored.owned) ? stored.owned.filter(id => known.includes(id)) : [];
  if (!owned.includes('hop')) owned.unshift('hop');
  return {
    coins: Number.isFinite(stored.coins) && stored.coins >= 0 ? Math.floor(stored.coins) : 0,
    owned,
    equipped: owned.includes(stored.equipped) && DANCE_IDS.includes(stored.equipped) ? stored.equipped : 'hop',
    finisher: owned.includes(stored.finisher) && FINISHER_IDS.includes(stored.finisher) ? stored.finisher : null,
  };
}

function saveWallet() {
  try { localStorage.setItem('gissa-talet-wallet', JSON.stringify(wallet)); } catch { /* no storage */ }
}
const SIDES = ['player', 'bot'];   // left and right student in the classroom
const other = side => (side === 'player' ? 'bot' : 'player');

// ================= DOM =================
const $ = id => document.getElementById(id);
const ui = {
  app: $('app'),
  menuPanel: $('menuPanel'),
  menuLogo: $('menuLogo'),
  menuButtons: $('menuButtons'),
  tagline: $('tagline'),
  picker: $('picker'),
  pickerTitle: $('pickerTitle'),
  pickerSub: $('pickerSub'),
  pickerInfo: $('pickerInfo'),
  pickerClose: $('pickerClose'),
  tilesWrap: $('tilesWrap'),
  tiles: $('tiles'),
  veil: $('veil'),
  confirm: $('confirmBtn'),
  mode: $('modeText'),
  phase: $('phaseText'),
  timer: $('turnTimer'),
  listBtn: $('listBtn'),
  soundBtn: $('soundBtn'),
  toast: $('toast'),
  result: $('result'),
  resultTitle: $('resultTitle'),
  resultText: $('resultText'),
  resultButtons: $('resultButtons'),
  againBtn: $('againBtn'),
  confetti: $('confetti'),
  announcer: $('announcer'),
  loading: $('loading'),
  settingsModal: $('settingsModal'),
  rulesModal: $('rulesModal'),
  lobbyModal: $('lobbyModal'),
  lobby: $('lobby'),
  lobbyTitle: $('lobbyTitle'),
  lobbyError: $('lobbyError'),
  nameInput: $('nameInput'),
  codeInput: $('codeInput'),
  roomCode: $('roomCode'),
  connectText: $('connectText'),
  copyBtn: $('copyBtn'),
  inviteLink: $('inviteLink'),
  chatBtn: $('chatBtn'),
  chatPanel: $('chatPanel'),
  chatEmotes: $('chatEmotes'),
  chatPhrases: $('chatPhrases'),
  chatMute: $('chatMute'),
  shopModal: $('shopModal'),
  shopGrid: $('shopGrid'),
  shopCoins: $('shopCoins'),
  menuCoins: $('menuCoins'),
  reward: $('reward'),
  rewardText: $('rewardText'),
};
const labels = Object.fromEntries(SIDES.map(side => {
  const root = $(side === 'player' ? 'ohPlayer' : 'ohBot');
  return [side, {
    root,
    msg: root.querySelector('.oh-msg'),
    status: root.querySelector('.oh-status'),
    name: root.querySelector('.oh-name-text'),
    tag: root.querySelector('.bot-tag'),
    chat: root.querySelector('.oh-chat'),
    emote: root.querySelector('.oh-emote'),
    chatTimer: 0,
    emoteTimer: 0,
  }];
}));

// Wait (at most 2.5 s) for the font so the text in the 3D world is drawn with the right typeface
await Promise.race([
  document.fonts.load('700 100px Fredoka').catch(() => {}),
  new Promise(resolve => setTimeout(resolve, 2500)),
]);
const world = createScene($('scene'), { player: labels.player.root, bot: labels.bot.root });
const net = createConnection({ onMessage: onNetMessage, onClose: onNetClose });

// ================= Game state =================
let MIN = 1;
let MAX = settings.max;

const newSide = () => ({ secret: null, range: { low: MIN, high: MAX } });

const state = {
  screen: 'menu',     // 'menu' | 'game'
  mode: 'bot',        // 'bot' = vs Sam, 'local' = 2 players on one screen, 'online' = vs a player on the server
  round: 0,           // bumped every new round -> cancels old timers
  phase: 'choose',    // 'choose' | 'guess' | 'over'
  turn: null,         // whose turn it is to guess
  chooser: 'player',  // who is picking a secret number right now (phase 1)
  handoff: false,     // 2 players: waiting for the device to be handed over
  busy: false,        // true while a guess/animation is in progress
  selected: null,
  sides: { player: newSide(), bot: newSide() }, // range = what that side knows about the OPPONENT's number
  botReadyAt: 0,
  lastGuess: { player: null, bot: null },
  winner: null,
  reward: 0,          // coins earned this round
  // Online / party
  net: {
    kind: null,         // 'online' (quick match) | 'party' (room code)
    you: 0,             // our player index on the server
    oppName: '',
    oppDance: 'hop',    // the opponent's victory dance
    oppFinisher: null,  // ...and what happens to you if they win
    max: 100,
    code: null,
    expecting: false,   // true while we're searching / waiting in a room
    inviteBase: '',
    oppReady: false,
    rematchMe: false,
    rematchOpp: false,
    oppLeft: false,
    leftText: '',
    deadline: null,     // when the server will pick / guess for the slow player (performance.now() ms)
  },
};

// ================= Helpers =================
const CANCELLED = Symbol('cancelled');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const timing = key => TIMING[key] * SPEED_FACTOR[settings.speed];
const timingBetween = key => {
  const [a, b] = TIMING[key];
  return (a + Math.random() * (b - a)) * SPEED_FACTOR[settings.speed];
};

// Waits, but aborts the flow if a new round (or the menu) was started in the meantime
async function pause(ms, token) {
  await sleep(ms);
  if (token !== state.round) throw CANCELLED;
}

function run(flow) {
  flow().catch(err => {
    if (err !== CANCELLED) console.error(err);
  });
}

// What the opponent answers to a guess
function answerFor(guess, secret) {
  if (guess === secret) return 'correct';
  return secret > guess ? 'higher' : 'lower';
}

// Narrows what the guesser knows after a Higher / Lower answer
function narrow(range, guess, answer) {
  if (answer === 'higher') range.low = guess + 1;
  else if (answer === 'lower') range.high = guess - 1;
}

// Sam's guess: binary search (middle of what's left), with some randomness on lower levels
function botPick({ low, high }) {
  const jitter = LEVEL_JITTER[settings.level];
  let guess = Math.floor((low + high) / 2);
  if (jitter > 0) {
    const spread = Math.floor(((high - low) * jitter) / 2);
    guess += randInt(-spread, spread);
  }
  return Math.min(high, Math.max(low, guess));
}

const inRange = (n, { low, high }) => n >= low && n <= high;
const rangeSize = ({ low, high }) => high - low + 1;
const isVersus = () => state.mode !== 'local';   // one human on this screen vs Sam or an online player
const isHuman = side => state.mode === 'local' || side === 'player';
const sideOf = index => (index === state.net.you ? 'player' : 'bot');
const possessive = name => (name === 'You' ? 'Your' : `${name}'s`);
// Keeps ranges like "1–100" on one line (word joiners around the dash)
const keepRanges = text => text.replace(/(\d)–(\d)/g, '$1⁠–⁠$2');

function nameOf(side) {
  if (state.mode === 'local') return side === 'player' ? 'Player 1' : 'Player 2';
  if (side === 'player') return 'You';
  return state.mode === 'online' ? state.net.oppName : 'Sam';
}

// Whose knowledge the number grid is showing right now
function viewer() {
  if (state.phase === 'choose') return state.chooser;
  if (state.mode === 'local') return state.turn ?? state.winner ?? 'player';
  return 'player';
}

// ================= Sound (simple beeps) =================
const audio = { ctx: null };
// CrazyGames can turn the sound off for the whole site (its setting wins over ours)
let crazyMuted = false;
const soundOn = () => settings.sound && !crazyMuted;

// The sound system. Creating it can freeze the page for a moment (about 0.7 s on some PCs),
// so it's made while the loading screen is still up instead of in the middle of the first
// PLAY. Browsers only let it play after a click, so it's woken up on the first touch/key.
function soundCtx() {
  audio.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => { /* needs a click first */ });
  return audio.ctx;
}

function tone(seq, type = 'square', vol = 0.06) {
  if (!soundOn()) return;
  try {
    const ctx = soundCtx();
    let t = ctx.currentTime;
    for (const [freq, dur] of seq) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur * 0.9;
    }
  } catch { /* sound not supported */ }
}
const SFX = {
  click: () => tone([[880, 0.05]], 'square', 0.03),
  pop: () => tone([[520, 0.07], [780, 0.09]], 'triangle', 0.08),
  higher: () => tone([[440, 0.09], [660, 0.14]], 'triangle', 0.09),
  lower: () => tone([[660, 0.09], [440, 0.14]], 'triangle', 0.09),
  correct: () => tone([[660, 0.08], [880, 0.14]], 'square', 0.05),
  turn: () => tone([[784, 0.1], [1046, 0.18]], 'sine', 0.09),
  win: () => tone([[523, 0.12], [659, 0.12], [784, 0.12], [1046, 0.35]], 'square', 0.05),
  lose: () => tone([[392, 0.2], [370, 0.2], [349, 0.2], [330, 0.45]], 'triangle', 0.08),
};

// ================= Text above the heads =================
function setStatus(side, key) {
  const el = labels[side].status;
  el.textContent = key ? TEXT[key] + (STATUS_EMOJI[key] || '') : '';
  el.dataset.variant = key || '';
}

function say(side, text, variant = 'guess', talk = true) {
  const el = labels[side].msg;
  el.textContent = text;
  el.dataset.variant = variant;
  el.hidden = false;
  el.classList.remove('pop');
  void el.offsetWidth; // restart the pop animation
  el.classList.add('pop');
  if (talk) {
    world.talk(side, variant === 'guess' ? 1.1 : 0.5);
    ui.announcer.textContent = `${nameOf(side)}: ${text}`;
  }
}

function hush(side) {
  labels[side].msg.hidden = true;
}

function renderNames() {
  for (const side of SIDES) labels[side].name.textContent = nameOf(side);
  const tag = labels.bot.tag;
  tag.hidden = state.mode === 'local';
  tag.textContent = state.mode === 'online' ? (state.net.kind === 'party' ? 'FRIEND' : 'ONLINE') : 'BOT';
  tag.dataset.kind = state.mode;
}

function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.remove('show');
  void ui.toast.offsetWidth;
  ui.toast.classList.add('show');
}

// The same moments look the same in every mode
function showGuess(side, n) {
  world.setView('game'); // the camera pulls back to show both students
  world.setPose(side, 'raise');
  say(side, TEXT.guess(n), 'guess');
  SFX.pop();
}

function showAnswer(side, n, answer) {
  const opp = other(side);
  narrow(state.sides[side].range, n, answer);
  state.lastGuess[side] = n;
  world.nod(opp);
  say(opp, TEXT[answer], answer);
  SFX[answer]();
  world.setPose(side, 'idle');
  render(); // crosses out every number that is now impossible
}

// ================= Number tiles =================
let tiles = [];
let shownViewer = null;

function buildTiles() {
  ui.tiles.innerHTML = '';
  tiles = [];
  for (let n = MIN; n <= MAX; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile';
    b.dataset.n = n;
    b.innerHTML = `<span class="tile-num outline">${n}</span><i class="x"></i>`;
    ui.tiles.append(b);
    tiles[n] = b;
  }
  ui.tiles.dataset.digits = String(String(MAX).length);
  shownViewer = null;
}

function canPick() {
  if (state.screen !== 'game' || state.busy || state.handoff) return false;
  if (state.phase === 'choose') return isHuman(state.chooser) && state.sides[state.chooser].secret == null;
  return state.phase === 'guess' && isHuman(state.turn);
}

function onTileClick(n) {
  if (!canPick()) return;
  if (state.phase === 'guess' && !inRange(n, state.sides[state.turn].range)) return;
  // Clicking the already selected tile = confirm
  if (state.selected === n) return confirmSelection();
  state.selected = n;
  SFX.click();
  render();
}

function confirmSelection() {
  const n = state.selected;
  if (n == null || !canPick()) return;
  if (state.phase === 'choose') run(() => lockSecret(n));
  else if (state.phase === 'guess') run(() => humanGuess(n));
}

ui.tiles.addEventListener('click', e => {
  const b = e.target.closest('.tile');
  if (b) onTileClick(Number(b.dataset.n));
});

// Arrow keys move between the tiles
ui.tiles.addEventListener('keydown', e => {
  const b = e.target.closest('.tile');
  const cols = getComputedStyle(ui.tiles).gridTemplateColumns.split(' ').length;
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
  if (!b || !step) return;
  e.preventDefault();
  let m = Number(b.dataset.n) + step;
  while (m >= MIN && m <= MAX && tiles[m].disabled) m += step;
  if (m >= MIN && m <= MAX) tiles[m].focus();
});

// ================= Number panel =================
// The phone layout (same media query as in style.css): narrow or upright screens. Everything
// else – also wide but low ones, like the game's box on CrazyGames – gets the big-screen layout.
const narrowMQ = window.matchMedia('(max-width: 599px), (max-width: 899px) and (max-aspect-ratio: 5/4)');
const isWide = () => !narrowMQ.matches;
let pickerOpen = false;
let tilesHold = false;      // wait until the panel has slid in before animating the crosses
let listRequested = false;  // phone: the player opened the list themselves
let minimized = false;      // phone: the player closed the list during their own turn

function wantPickerOpen() {
  if (state.screen !== 'game') return false;
  if (state.handoff) return true;
  // Big screens: the panel is up unless the numbers button hid it (until the next turn starts)
  if (isWide()) return !minimized;
  // While picking (and waiting for the first turn) the sheet stays up, so it doesn't drop
  // and pop straight back up – and drag the camera along – just as the game starts
  if (canPick() || state.phase === 'choose') return !minimized;
  return listRequested;
}

function syncPicker() {
  const open = wantPickerOpen();
  if (open !== pickerOpen) {
    pickerOpen = open;
    ui.picker.dataset.open = String(open);
    if (open) {
      tilesHold = true;
      setTimeout(() => {
        tilesHold = false;
        renderTiles();
        scrollToRange();
      }, PANEL_SLIDE_MS + 20);
    }
  }
  updateInsets();
}

// Tells the 3D camera how much of the screen the menus and panels take up
function updateInsets(instant = false) {
  const wide = isWide();
  let left = 0;
  let right = 0;
  let bottom = 0;
  let top = 64;
  if (state.screen === 'menu') {
    if (wide) {
      left = ui.menuPanel.offsetLeft + ui.menuPanel.offsetWidth + 16;
      top = 24;
    } else {
      top = ui.menuLogo.offsetTop + ui.menuLogo.offsetHeight + 8;
      bottom = window.innerHeight - ui.menuButtons.getBoundingClientRect().top + 8;
    }
  } else {
    if (pickerOpen) {
      if (wide) right = ui.picker.offsetWidth + 32;
      else bottom = ui.picker.offsetHeight;
    }
    if (state.phase === 'over') top = 170;
    else if (!wide && window.innerWidth < 400) top = 124;   // very narrow: the info box sits under the buttons (style.css)
  }
  world.setInsets({ left, right, bottom, top }, instant);
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--inset-l', `${left}px`);
  rootStyle.setProperty('--inset-r', `${right}px`);
  rootStyle.setProperty('--inset-b', `${bottom}px`);
}

function scrollToRange() {
  if (state.phase !== 'guess') return;
  const first = tiles[state.sides[viewer()].range.low];
  if (!first) return;
  ui.tilesWrap.scrollTo({ top: Math.max(0, first.offsetTop - 8), behavior: reduceMotion ? 'auto' : 'smooth' });
}

function renderTiles() {
  if (!pickerOpen || tilesHold) return;
  const v = viewer();
  const range = state.sides[v].range;
  const showOut = state.phase !== 'choose';
  // Switching whose grid is shown (2 players) happens instantly, without the sweep
  const instant = v !== shownViewer;
  if (instant && state.phase === 'guess') requestAnimationFrame(scrollToRange);
  shownViewer = v;
  const origin = state.lastGuess[v] ?? Math.round((MIN + MAX) / 2);
  const revealed = state.phase === 'over' ? state.sides[other(v)].secret : null;
  ui.tiles.classList.toggle('locked', !canPick());
  ui.veil.hidden = !state.handoff;
  ui.tiles.classList.toggle('veiled', state.handoff);

  for (let n = MIN; n <= MAX; n++) {
    const b = tiles[n];
    const out = showOut && !inRange(n, range);
    if (out !== b.classList.contains('out')) {
      // The crosses "sweep" outwards from the guessed number
      b.style.setProperty('--d', instant || !out ? '0ms' : `${Math.min(Math.abs(n - origin), 30) * 14}ms`);
    }
    b.classList.toggle('out', out);
    b.disabled = out;
    b.classList.toggle('sel', n === state.selected);
    b.classList.toggle('secret', n === revealed);
    b.setAttribute('aria-pressed', String(n === state.selected));
    b.setAttribute('aria-label', out ? `${n}, ruled out` : String(n));
  }
}

function pickerCopy() {
  const { phase, turn, busy, selected, mode } = state;
  const vs = isVersus();
  const opponent = nameOf('bot');
  if (mode === 'online' && state.net.oppLeft) return ['Game over 👋', state.net.leftText, '', ''];
  if (state.handoff) {
    return ['Switch players 🔄', `Hand over to ${nameOf('bot')}`, `${nameOf('player')} – look away now! 🙈`, `I'M ${nameOf('bot').toUpperCase()} – READY`];
  }
  if (phase === 'choose') {
    const lockText = selected != null ? `LOCK IN ${selected}` : 'PICK A NUMBER';
    if (vs && state.sides.player.secret != null) {
      return [`Waiting for ${opponent}… ⏳`, `${opponent} is picking a secret number`, `Your number: ${state.sides.player.secret}`, 'WAITING…'];
    }
    if (vs) {
      const ready = mode === 'online' && state.net.oppReady ? `${opponent} has picked a number ✅` : '';
      return ['Pick your secret number 🤔', `${opponent} will try to guess it`, ready, lockText];
    }
    const c = state.chooser;
    return [`${nameOf(c)}: pick your number 🤔`, `${nameOf(other(c))} – look away! 🙈`, '', lockText];
  }

  const v = viewer();
  const opp = other(v);
  const r = state.sides[v].range;
  const left = `${possessive(nameOf(opp))} number: ${r.low}–${r.high} · ${rangeSize(r)} left`;
  const or = state.sides[opp].range;
  const oppKnows = vs
    ? `${opponent} knows your number (${state.sides.player.secret}) is ${or.low}–${or.high}`
    : `${nameOf(opp)} knows your number is ${or.low}–${or.high}`;

  if (phase === 'guess') {
    if (isHuman(turn) && !busy) {
      const title = vs ? `Guess ${possessive(opponent)} number 🤔` : `${nameOf(turn)}: guess! 🤔`;
      return [title, left, oppKnows, selected != null ? `GUESS ${selected}!` : 'PICK A NUMBER'];
    }
    if (isHuman(turn)) {
      return [vs ? 'Guessing… 🤞' : `${nameOf(turn)} is guessing… 🤞`, left, oppKnows, 'WAITING FOR ANSWER…'];
    }
    return [`${possessive(opponent)} turn ${mode === 'bot' ? '🤖' : '⏳'}`, left, oppKnows, `${opponent.toUpperCase()} IS GUESSING…`];
  }
  return [`${nameOf(state.winner)} won! 🏆`, `${possessive(nameOf(opp))} number was ${state.sides[opp].secret}`, '', ''];
}

function renderPicker() {
  const [title, sub, info, action] = pickerCopy();
  ui.pickerTitle.textContent = title;
  ui.pickerSub.textContent = keepRanges(sub);
  ui.pickerInfo.textContent = keepRanges(info);
  ui.confirm.textContent = action;
  ui.confirm.hidden = state.phase === 'over';
  ui.confirm.disabled = state.handoff ? false : !canPick() || state.selected == null;
}

function resultCopy() {
  const { winner, mode } = state;
  if (mode === 'online' && state.net.oppLeft) return ['GAME OVER 👋', state.net.leftText];
  const loser = other(winner);
  const w = nameOf(winner);
  const loserSecret = state.sides[loser].secret;
  const winnerSecret = state.sides[winner].secret;
  if (isVersus()) {
    const opp = nameOf('bot');
    let lines;
    if (winner === 'player') {
      lines = ['YOU WIN! 🏆', `You guessed it – ${possessive(opp)} number was ${loserSecret}.`];
    } else {
      lines = [`${opp.toUpperCase()} WINS! ${mode === 'bot' ? '🤖' : '🏆'}`,
        `${opp} guessed your number ${loserSecret}. ${possessive(opp)} number was ${winnerSecret}.`];
    }
    if (mode === 'online' && state.net.rematchOpp && !state.net.rematchMe) lines[1] += ` ${opp} wants a rematch!`;
    return lines;
  }
  return [`${w.toUpperCase()} WINS! 🏆`, `${w} guessed ${loserSecret}. ${possessive(w)} number was ${winnerSecret}.`];
}

function renderHud() {
  const { phase, turn, busy, mode } = state;
  const vs = isVersus();
  ui.app.dataset.mode = mode;
  ui.mode.textContent = `1–${MAX} ${MAX >= 1000 ? '😈' : '🎯'}`;
  let text = '';
  if (state.handoff) text = 'Switch players';
  else if (phase === 'choose') {
    if (vs) text = state.sides.player.secret != null ? `${nameOf('bot')} is picking a number…` : 'Pick your number';
    else text = `${nameOf(state.chooser)} is picking`;
  } else if (phase === 'guess') {
    text = vs && turn === 'player' ? (busy ? 'Guessing…' : 'Your turn!') : `${possessive(nameOf(turn))} turn`;
  } else text = 'Round over';
  ui.phase.textContent = text;

  const over = state.screen === 'game' && phase === 'over';
  ui.result.hidden = !over;
  ui.resultButtons.hidden = !over;
  if (over) {
    const [title, body] = resultCopy();
    ui.resultTitle.textContent = title;
    ui.resultTitle.classList.toggle('lost', vs && state.winner !== 'player');
    ui.resultText.textContent = body;
    const online = mode === 'online';
    ui.againBtn.hidden = online && state.net.oppLeft;
    ui.againBtn.disabled = online && state.net.rematchMe;
    ui.againBtn.textContent = online && state.net.rematchMe ? 'WAITING…' : online && state.net.rematchOpp ? 'REMATCH!' : 'PLAY AGAIN';
  }
  ui.reward.hidden = !(over && state.reward > 0);
  ui.rewardText.textContent = `+${state.reward}`;
  ui.listBtn.setAttribute('aria-pressed', String(pickerOpen));
  ui.soundBtn.dataset.on = String(soundOn());
  ui.soundBtn.setAttribute('aria-pressed', String(soundOn()));
}

function renderWorld() {
  const over = state.phase === 'over';
  for (const side of SIDES) {
    const secret = state.sides[side].secret;
    let paper = '';
    if (state.screen === 'game' && secret != null) {
      // You always see your own number. Two players on one screen: both papers stay hidden.
      paper = over || (isVersus() && side === 'player') ? secret : '?';
    } else if (state.screen === 'game' && state.mode === 'online' && side === 'bot' && (state.net.oppReady || state.phase !== 'choose')) {
      paper = '?';
    }
    world.setPaper(side, paper);
  }
}

function render() {
  syncPicker();
  renderTiles();
  renderPicker();
  renderHud();
  renderWorld();
  renderTimer();
}

// ================= Home screen =================
function showMenu() {
  if (state.mode === 'online') {
    net.send({ t: 'leave' });
    crazy.leftRoom();
  }
  crazy.gameplayStop();
  state.net.expecting = false;
  state.round++;
  state.screen = 'menu';
  state.mode = 'bot';
  state.handoff = false;
  ui.app.dataset.screen = 'menu';
  closeModals();
  clearChat();
  world.resetFinishers();
  ui.confetti.innerHTML = '';
  renderNames();
  for (const side of SIDES) {
    hush(side);
    setStatus(side, null);
    world.setPose(side, 'think');
    world.look(side, false);
    world.setPaper(side, '');
  }
  world.setView('menu');
  render();
  run(() => menuThoughts(state.round));
}

// The students "think out loud" in the background of the home screen
async function menuThoughts(token) {
  let side = 'player';
  for (;;) {
    await pause(1500, token);
    const n = randInt(MIN, MAX);
    const thoughts = [`Is it ${n}? 🤔`, 'Hmm... 🤔', `${n}...? 💭`, 'Higher? Lower? 💭'];
    say(side, thoughts[randInt(0, thoughts.length - 1)], 'guess', false);
    await pause(1900, token);
    hush(side);
    side = other(side);
  }
}

function enterGame(mode) {
  state.mode = mode;
  state.screen = 'game';
  ui.app.dataset.screen = 'game';
  world.setView('game');
  SFX.pop();
  newGame();
}

// ================= Game flow =================

// PHASE 1: both pick a secret number
function newGame() {
  state.round++;
  crazy.gameplayStart();
  const max = state.mode === 'online' ? state.net.max : settings.max;
  if (max !== MAX) {
    MAX = max;
    buildTiles();
    world.setBoard(`1 – ${MAX}`);
  }
  Object.assign(state, {
    phase: 'choose',
    turn: null,
    chooser: 'player',
    handoff: false,
    busy: false,
    selected: null,
    sides: { player: newSide(), bot: newSide() },
    lastGuess: { player: null, bot: null },
    winner: null,
  });
  Object.assign(state.net, { oppReady: false, rematchMe: false, rematchOpp: false, oppLeft: false, leftText: '', deadline: null });
  if (state.mode === 'bot') {
    state.sides.bot.secret = randInt(MIN, MAX);
    state.botReadyAt = performance.now() + timingBetween('botChooseMs');
  }
  listRequested = false;
  minimized = false;
  tiles.forEach(b => b && b.style.setProperty('--d', '0ms'));
  ui.confetti.innerHTML = '';
  renderNames();
  for (const side of SIDES) {
    hush(side);
    setStatus(side, 'choosing');
    world.setPose(side, 'think');
    world.look(side, false);
  }
  world.setView('game');
  world.resetFinishers();   // bring back whoever fell through the floor last round
  ui.tilesWrap.scrollTop = 0;
  render();
  if (state.mode === 'bot') run(() => botChooses(state.round));
}

// Sam "picks" his number for a moment, then shows Ready!
async function botChooses(token) {
  await pause(Math.max(0, state.botReadyAt - performance.now()), token);
  if (state.phase !== 'choose') return;
  setStatus('bot', 'ready');
  world.setPose('bot', 'idle');
  SFX.click();
}

async function lockSecret(n) {
  const token = state.round;
  const chooser = state.chooser;
  state.sides[chooser].secret = n;
  state.selected = null;
  SFX.pop();
  setStatus(chooser, 'ready');
  world.setPose(chooser, 'idle');

  if (state.mode === 'online') {
    // The server waits for both players and then says whose turn it is
    net.send({ t: 'secret', n });
    render();
    return;
  }

  if (state.mode === 'local' && chooser === 'player') {
    // Player 1 is done – hand over to Player 2 without showing the number
    state.handoff = true;
    ui.tilesWrap.scrollTop = 0;
    render();
    return;
  }

  state.busy = true;
  render();
  if (state.mode === 'bot') {
    // Sam needs a moment to "pick"
    const wait = state.botReadyAt - performance.now();
    if (wait > 0) await pause(wait, token);
    world.setPose('bot', 'idle');
  }
  await pause(500, token);

  // PHASE 2: taking turns
  state.phase = 'guess';
  let first = settings.first;
  if (first === 'random') first = Math.random() < 0.5 ? 'player' : 'bot';
  await startTurn(first);
}

function endHandoff() {
  state.handoff = false;
  state.chooser = 'bot';
  ui.tilesWrap.scrollTop = 0;
  SFX.click();
  render();
}

async function startTurn(side) {
  state.turn = side;
  hush('player');
  hush('bot');
  setStatus(side, 'guessing');
  setStatus(other(side), 'waiting');
  world.setPose(side, 'think');
  world.setPose(other(side), 'idle');
  world.look(side, false);
  world.look(other(side), true);
  // Like the Roblox game: the camera moves in on whoever is guessing
  world.setView(side === 'player' ? 'focusPlayer' : 'focusBot');

  if (isHuman(side)) {
    state.busy = false;
    state.selected = null;
    listRequested = false;
    minimized = false;
    render();
    toast(state.mode === 'local' ? `${possessive(nameOf(side)).toUpperCase()} TURN!` : 'YOUR TURN!');
    SFX.turn();
  } else if (state.mode === 'bot') {
    await botTurn();
  } else {
    render(); // online: wait for the opponent's guess from the server
  }
}

async function humanGuess(n) {
  const token = state.round;
  const side = state.turn;
  state.busy = true;
  state.selected = null;
  if (state.mode === 'online') {
    // The server checks the guess and sends it back to both players
    net.send({ t: 'guess', n });
    render();
    return;
  }
  showGuess(side, n);
  render();
  await resolveGuess(side, n, token);
}

async function botTurn() {
  const token = state.round;
  state.busy = true;
  render();
  await pause(timingBetween('botThinkMs'), token);
  const n = botPick(state.sides.bot.range);
  showGuess('bot', n);
  await resolveGuess('bot', n, token);
}

// The opponent answers automatically from their secret number (no cheating possible)
async function resolveGuess(side, n, token) {
  await pause(timing('answerDelayMs'), token);
  const answer = answerFor(n, state.sides[other(side)].secret);
  showAnswer(side, n, answer);
  // PHASE 3: only a correct guess wins. With one number left the turn still passes,
  // and that number has to be guessed on the next turn.
  if (answer === 'correct') {
    endGame(side);
    return;
  }
  await pause(timing('nextTurnDelayMs'), token);
  await startTurn(other(side));
}

function endGame(winner) {
  crazy.gameplayStop();
  if (isVersus() && winner === 'player') crazy.happytime();
  Object.assign(state, {
    phase: 'over',
    busy: false,
    selected: null,
    winner,
    // You earn coins when YOU win against Sam or an online player (not in 2 players on one screen)
    reward: isVersus() && winner === 'player' ? WIN_REWARD : 0,
  });
  if (state.reward) {
    wallet.coins += state.reward;
    saveWallet();
    renderCoins();
  }
  const loser = other(winner);
  setStatus(winner, 'winner');
  setStatus(loser, 'lost');
  world.setDance(winner, danceFor(winner));
  world.setPose(winner, 'win');
  world.setPose(loser, 'lose');
  world.look(winner, false);
  world.look(loser, false);
  world.setView('game');
  listRequested = false;
  render();
  state.turn = null;
  if (isHuman(winner)) {
    confetti();
    SFX.win();
    if (state.reward) setTimeout(() => tone([[1318, 0.08], [1760, 0.16]], 'square', 0.05), 700);
  } else {
    SFX.lose();
  }
  // The winner's finisher hits the loser a moment later (after "Correct!" has been seen)
  const finisher = finisherFor(winner);
  if (finisher) {
    const token = state.round;
    setTimeout(() => {
      if (token !== state.round || state.phase !== 'over') return;
      world.finish(loser, finisher);
      finisherSound(finisher);
    }, 1300);
  }
}

// Which victory dance a student does when they win
function danceFor(side) {
  if (state.mode === 'online') return side === 'player' ? wallet.equipped : state.net.oppDance;
  if (state.mode === 'bot') return side === 'player' ? wallet.equipped : 'hop';
  return wallet.equipped; // two players on this device
}

// Which finisher hits the loser (null = none). Sam doesn't have any.
function finisherFor(side) {
  if (state.mode === 'online') return side === 'player' ? wallet.finisher : state.net.oppFinisher;
  if (state.mode === 'bot') return side === 'player' ? wallet.finisher : null;
  return wallet.finisher; // two players on this device
}

// A rising or falling tone (for the finisher sound effects)
function sweep(from, to, dur, type = 'sine', vol = 0.08, delay = 0) {
  if (!soundOn()) return;
  try {
    const ctx = soundCtx();
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  } catch { /* sound not supported */ }
}

// A burst of filtered noise (pop, crackle, hiss, thunder, boom)
function noise(dur, vol = 0.1, delay = 0, freq = 1000, filter = 'lowpass') {
  if (!soundOn()) return;
  try {
    const ctx = soundCtx();
    if (!audio.noise) {
      audio.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = audio.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = audio.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur);
  } catch { /* sound not supported */ }
}

function finisherSound(kind) {
  if (kind === 'anvil') {
    sweep(1400, 380, 0.5, 'sine', 0.07);               // falling whistle
    sweep(110, 50, 0.45, 'square', 0.12, 0.5);         // CLONK
  } else if (kind === 'trapdoor') {
    sweep(900, 700, 0.06, 'square', 0.06);             // click
    sweep(700, 120, 1.1, 'triangle', 0.09, 0.3);       // slide whistle down
  } else if (kind === 'ufo') {
    for (let i = 0; i < 6; i++) sweep(500 + (i % 2) * 220, 520 + (i % 2) * 220, 0.18, 'sine', 0.05, i * 0.18);
    sweep(300, 1500, 1.4, 'sine', 0.06, 1.2);          // beam up
    sweep(400, 2000, 0.5, 'triangle', 0.05, 3.0);      // zoom away
  } else if (kind === 'blackhole') {
    sweep(90, 40, 2.6, 'sawtooth', 0.07);              // deep rumble
    sweep(200, 1200, 0.25, 'square', 0.05, 2.75);      // pop
  } else if (kind === 'balloon') {
    for (const d of [0.15, 0.55, 0.95]) sweep(260, 620, 0.22, 'sine', 0.08, d);   // pump, pump, pump
    sweep(500, 900, 1.2, 'sine', 0.03, 1.3);           // floating up
    noise(0.12, 0.3, 2.6, 2500, 'highpass');           // POP
    sweep(900, 200, 0.12, 'square', 0.06, 2.6);
    for (let i = 0; i < 5; i++) sweep(420 - i * 40, 180, 0.2, 'sawtooth', 0.04, 2.65 + i * 0.2);   // pffffrt
  } else if (kind === 'freeze') {
    sweep(1200, 3200, 0.5, 'triangle', 0.05, 0.1);     // ice forming
    noise(0.35, 0.12, 0.15, 2500, 'highpass');         // crackle
    for (let i = 0; i < 4; i++) sweep(2400 + i * 420, 2600 + i * 420, 0.25, 'sine', 0.03, 0.8 + i * 0.22);   // twinkle
    sweep(140, 60, 0.3, 'square', 0.08, 2.35);         // thud
    noise(0.9, 0.05, 2.35, 4000, 'highpass');          // sliding away
  } else if (kind === 'lightning') {
    noise(0.7, 0.1, 0, 300);                           // rumble
    noise(0.3, 0.35, 0.75, 6000);                      // CRACK
    sweep(1800, 80, 0.25, 'square', 0.08, 0.75);
    sweep(110, 100, 0.4, 'sawtooth', 0.06, 0.75);      // bzzzt
    noise(1.4, 0.16, 0.95, 250);                       // thunder
  } else if (kind === 'rocket') {
    noise(0.55, 0.06, 0.35, 5000, 'highpass');         // fuses
    noise(1.8, 0.18, 0.9, 700);                        // engines
    sweep(150, 900, 1.3, 'sawtooth', 0.05, 1.45);      // whoosh
  } else if (kind === 'meteor') {
    sweep(2200, 300, 1.0, 'sine', 0.06, 0.25);         // incoming whistle
    noise(1.6, 0.45, 1.25, 500);                       // BOOM
    sweep(90, 30, 0.7, 'square', 0.12, 1.25);
    for (let i = 0; i < 5; i++) noise(0.05, 0.1, 1.7 + i * 0.12, 3000, 'highpass');   // rubble landing
  }
}

// ================= Online & party =================
function onNetMessage(msg) {
  const inOnlineGame = state.mode === 'online' && state.screen === 'game';
  switch (msg.t) {
    case 'queued':
      if (state.net.expecting) setLobbyView('searching');
      break;
    case 'room':
      if (!state.net.expecting) return net.send({ t: 'cancel' });
      showRoom(msg);
      break;
    case 'error':
      if (inOnlineGame) {
        state.busy = false;
        toast('OOPS!');
        render();
      } else {
        state.net.expecting = false;
        setLobbyView(ui.lobby.dataset.mode);
        lobbyError(msg.msg);
      }
      break;
    case 'start':
      if (!state.net.expecting && !inOnlineGame) return net.send({ t: 'leave' });
      startOnlineGame(msg);
      break;
    case 'secretOk':
      // auto = the time ran out and the server picked a number for us
      if (inOnlineGame && msg.auto && state.sides.player.secret == null) {
        state.sides.player.secret = msg.n;
        state.selected = null;
        setStatus('player', 'ready');
        world.setPose('player', 'idle');
        toast("TIME'S UP! ⏰");
        render();
      }
      break;
    case 'oppReady':
      if (inOnlineGame) {
        state.net.oppReady = true;
        setStatus('bot', 'ready');
        world.setPose('bot', 'idle');
        render();
      }
      break;
    case 'turn':
      if (inOnlineGame) {
        state.phase = 'guess';
        state.net.deadline = performance.now() + msg.time * 1000;
        run(() => startTurn(sideOf(msg.who)));
      }
      break;
    case 'guess':
      if (inOnlineGame) {
        state.busy = true;
        state.net.deadline = null;
        if (msg.auto && sideOf(msg.by) === 'player') toast("TIME'S UP! ⏰");
        showGuess(sideOf(msg.by), msg.n);
        render();
      }
      break;
    case 'answer':
      if (inOnlineGame) showAnswer(sideOf(msg.by), msg.n, msg.answer);
      break;
    case 'over':
      if (inOnlineGame) {
        const winner = sideOf(msg.winner);
        state.sides.player.secret = msg.secrets[state.net.you];
        state.sides.bot.secret = msg.secrets[1 - state.net.you];
        endGame(winner);
      }
      break;
    case 'oppRematch':
      if (inOnlineGame) {
        state.net.rematchOpp = true;
        toast('REMATCH?');
        render();
      }
      break;
    case 'oppLeft':
      opponentGone(`${state.net.oppName} left the game.`);
      break;
    case 'chat':
      if (inOnlineGame) showChat(sideOf(msg.by), msg.kind, msg.id);
      break;
    default:
      break;
  }
}

function onNetClose() {
  if (state.mode === 'online' && state.screen === 'game') {
    opponentGone('Lost the connection to the game server.');
  } else if (!ui.lobbyModal.hidden) {
    state.net.expecting = false;
    setLobbyView(ui.lobby.dataset.mode);
    lobbyError('Lost the connection to the game server.');
  }
}

function startOnlineGame(msg) {
  closeModals({ keepRoom: true });
  state.net.expecting = false;
  Object.assign(state.net, {
    kind: msg.kind,
    you: msg.you,
    oppName: msg.names[1 - msg.you],
    oppDance: DANCE_IDS.includes(msg.dances?.[1 - msg.you]) ? msg.dances[1 - msg.you] : 'hop',
    oppFinisher: FINISHER_IDS.includes(msg.finishers?.[1 - msg.you]) ? msg.finishers[1 - msg.you] : null,
    max: msg.max,
    code: msg.code,
  });
  if (msg.code) crazy.roomFull(msg.code);   // both players are in: nobody else can join
  enterGame('online');
  state.net.deadline = performance.now() + msg.time * 1000;
  renderTimer();
  toast(`VS ${state.net.oppName.toUpperCase()}!`);
}

// Countdown for the online time limits (the server enforces them)
function renderTimer() {
  const { deadline } = state.net;
  let show = state.mode === 'online' && state.screen === 'game' && deadline != null && !state.net.oppLeft;
  if (show && state.phase === 'choose') show = state.sides.player.secret == null || !state.net.oppReady;
  else if (show) show = state.phase === 'guess' && !state.busy;
  ui.timer.hidden = !show;
  if (!show) return;
  const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
  ui.timer.textContent = `⏱ ${seconds}s`;
  ui.timer.classList.toggle('urgent', seconds <= 10);
}
setInterval(renderTimer, 250);

function opponentGone(text) {
  if (state.mode !== 'online' || state.screen !== 'game' || state.net.oppLeft) return;
  state.round++;
  state.net.oppLeft = true;
  crazy.leftRoom();
  crazy.gameplayStop();
  state.net.leftText = text;
  toggleChat(false);
  world.setView('game');
  if (state.phase !== 'over') {
    Object.assign(state, { phase: 'over', busy: false, selected: null, winner: 'player' });
    for (const side of SIDES) {
      hush(side);
      setStatus(side, null);
      world.setPose(side, 'idle');
    }
  }
  toast('GAME OVER 👋');
  render();
}

// ----- Quick chat & emotes -----
let chatMuted = false;
try { chatMuted = localStorage.getItem('gissa-talet-mute-chat') === '1'; } catch { /* no storage */ }
let chatCoolUntil = 0;

function buildChatPanel() {
  ui.chatEmotes.innerHTML = Object.entries(CHAT_EMOTES)
    .map(([id, e]) => `<button type="button" class="chat-emote" data-kind="emote" data-id="${id}" aria-label="${id}">${e.emoji}</button>`)
    .join('');
  ui.chatPhrases.innerHTML = Object.entries(CHAT_PHRASES)
    .map(([id, text]) => `<button type="button" class="chat-phrase outline" data-kind="phrase" data-id="${id}">${text}</button>`)
    .join('');
  ui.chatMute.checked = chatMuted;
}

function toggleChat(open = ui.chatPanel.hidden) {
  const allowed = state.mode === 'online' && state.screen === 'game' && !state.net.oppLeft;
  ui.chatPanel.hidden = !(open && allowed);
  ui.chatBtn.setAttribute('aria-expanded', String(!ui.chatPanel.hidden));
  if (!ui.chatPanel.hidden) SFX.click();
}

function sendChat(kind, id) {
  if (performance.now() < chatCoolUntil) return;
  if (!net.send({ t: 'chat', kind, id })) return;
  // Short cooldown so the chat can't be spammed (the server has its own limit too)
  chatCoolUntil = performance.now() + CHAT_COOLDOWN_MS;
  ui.chatPanel.classList.add('cooling');
  setTimeout(() => ui.chatPanel.classList.remove('cooling'), CHAT_COOLDOWN_MS);
  toggleChat(false);
}

function showChat(side, kind, id) {
  if (side === 'bot' && chatMuted) return;
  if (ui.app.classList.contains('no-chat')) return;   // CrazyGames turned chat off
  const label = labels[side];
  if (kind === 'phrase' && CHAT_PHRASES[id]) {
    label.chat.textContent = CHAT_PHRASES[id];
    label.chat.hidden = false;
    label.chat.classList.remove('pop');
    void label.chat.offsetWidth;
    label.chat.classList.add('pop');
    clearTimeout(label.chatTimer);
    label.chatTimer = setTimeout(() => { label.chat.hidden = true; }, 3500);
    ui.announcer.textContent = `${nameOf(side)}: ${CHAT_PHRASES[id]}`;
    world.talk(side, 0.6);
  } else if (kind === 'emote' && CHAT_EMOTES[id]) {
    const emote = CHAT_EMOTES[id];
    label.emote.textContent = emote.emoji;
    label.emote.hidden = false;
    label.emote.classList.remove('float');
    void label.emote.offsetWidth;
    label.emote.classList.add('float');
    clearTimeout(label.emoteTimer);
    label.emoteTimer = setTimeout(() => { label.emote.hidden = true; }, 2300);
    world.emote(side, emote.gesture, emote.face);
  } else {
    return;
  }
  tone([[700, 0.05], [1050, 0.07]], 'sine', 0.06);
}

function clearChat() {
  toggleChat(false);
  for (const side of SIDES) {
    clearTimeout(labels[side].chatTimer);
    clearTimeout(labels[side].emoteTimer);
    labels[side].chat.hidden = true;
    labels[side].emote.hidden = true;
  }
}

// ----- Lobby -----
function openLobby(mode) {
  closeModals();
  ui.lobby.dataset.mode = mode;
  ui.lobbyTitle.textContent = mode === 'online' ? '🌐 Online' : '🎉 Party';
  ui.nameInput.value = crazyName || loadName();
  ui.nameInput.readOnly = Boolean(crazyName);   // on CrazyGames you play under your username
  setLobbyView(mode);
  ui.lobbyModal.hidden = false;
  SFX.click();
  (mode === 'party' && ui.codeInput.value ? ui.codeInput : ui.nameInput).focus();
}

function setLobbyView(view) {
  ui.lobby.dataset.view = view;
  ui.lobbyError.hidden = true;
}

function lobbyError(text) {
  ui.lobbyError.textContent = text;
  ui.lobbyError.hidden = false;
}

function lobbyName() {
  if (crazyName) return crazyName;
  const name = ui.nameInput.value.trim().slice(0, 20) || loadName();
  ui.nameInput.value = name;
  saveName(name);
  return name;
}

async function connectLobby() {
  const back = ui.lobby.dataset.mode;
  setLobbyView('connecting');
  ui.connectText.textContent = 'Connecting to the game server…';
  // A hosted server that has been asleep takes a while to wake up – say so
  const slow = setTimeout(() => {
    ui.connectText.textContent = 'Waking up the game server… this can take up to a minute ⏳';
  }, 4000);
  try {
    await net.open();
    return true;
  } catch {
    setLobbyView(back);
    lobbyError(SERVER_HELP);
    return false;
  } finally {
    clearTimeout(slow);
  }
}

async function findOpponent() {
  const name = lobbyName();
  if (!(await connectLobby())) return;
  state.net.expecting = true;
  setLobbyView('searching');
  net.send({ t: 'quick', name, dance: wallet.equipped, finisher: wallet.finisher || '' });
}

async function createRoom() {
  const name = lobbyName();
  if (!(await connectLobby())) return;
  state.net.expecting = true;
  net.send({ t: 'create', name, max: settings.max, dance: wallet.equipped, finisher: wallet.finisher || '' });
}

async function joinRoom() {
  const code = ui.codeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    lobbyError('Type the 4-character room code.');
    ui.codeInput.focus();
    return;
  }
  const name = lobbyName();
  if (!(await connectLobby())) return;
  state.net.expecting = true;
  setLobbyView('connecting');
  net.send({ t: 'join', name, code, dance: wallet.equipped, finisher: wallet.finisher || '' });
}

function showRoom(msg) {
  state.net.code = msg.code;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  state.net.inviteBase = local && msg.lan && msg.lan.length ? msg.lan[0] : location.origin;
  ui.roomCode.innerHTML = msg.code.split('').map(ch => `<span class="outline">${ch}</span>`).join('');
  ui.inviteLink.textContent = `${state.net.inviteBase}/?room=${msg.code}`;
  // When the game is played from another site than the server (CrazyGames) a link to the server
  // wouldn't open the game, so friends use the code only
  ui.inviteLink.hidden = ui.copyBtn.hidden = Boolean(GAME_SERVER);
  // On CrazyGames: their own invite link, and their Join/Invite buttons get to know the room
  const crazyLink = crazy.inviteLink(msg.code);
  if (crazyLink) {
    ui.inviteLink.textContent = crazyLink;
    ui.inviteLink.hidden = ui.copyBtn.hidden = false;
  }
  crazy.roomOpen(msg.code);
  setLobbyView('room');
  SFX.pop();
}

function cancelLobby() {
  if (state.net.expecting) net.send({ t: 'cancel' });
  crazy.leftRoom();
  state.net.expecting = false;
  setLobbyView(ui.lobby.dataset.mode);
  SFX.click();
}

async function copyInvite() {
  const link = ui.inviteLink.textContent;
  try {
    await navigator.clipboard.writeText(link);
    toast('LINK COPIED!');
  } catch {
    // The clipboard needs https or localhost – select the link so it can be copied by hand
    const range = document.createRange();
    range.selectNodeContents(ui.inviteLink);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    toast('COPY THE LINK ✂️');
  }
}

// ================= Shop =================
// Each card shows your student doing the dance on repeat (drawn by the dance studio
// in scene3d.js). Locked dances have a padlock over the preview.
let studio = null;

function renderCoins() {
  ui.menuCoins.textContent = wallet.coins;
  ui.shopCoins.textContent = wallet.coins;
}

const shopCard = item => `
  <div class="shop-card" data-id="${item.id}" data-kind="${item.kind}" data-rarity="${item.rarity}">
    <div class="shop-stage">
      <span class="rarity outline">${item.rarity.toUpperCase()}</span>
      <canvas class="shop-canvas" aria-hidden="true"></canvas>
      <div class="lock-veil" aria-hidden="true">
        <div class="padlock"><span class="shackle"></span><span class="lock-body"></span></div>
      </div>
      <div class="equipped-badge outline">EQUIPPED</div>
    </div>
    <div class="shop-name outline">${item.name}</div>
    <button type="button" class="shop-buy outline"></button>
  </div>`;

function buildShop() {
  const dances = SHOP_ITEMS.filter(i => i.kind === 'dance');
  const finishers = SHOP_ITEMS.filter(i => i.kind === 'finisher');
  ui.shopGrid.innerHTML = `
    <div class="shop-section">
      <h3 class="outline">🕺 Victory dances</h3>
      <p class="outline">Your student does it when you win.</p>
    </div>
    ${dances.map(shopCard).join('')}
    <div class="shop-section finishers">
      <h3 class="outline">💀 Finishers</h3>
      <p class="outline">Happens to your opponent when you win! Tap an equipped finisher to turn it off.</p>
    </div>
    ${finishers.map(shopCard).join('')}`;
}

const isEquipped = item => (item.kind === 'dance' ? wallet.equipped === item.id : wallet.finisher === item.id);

function renderShop() {
  for (const card of ui.shopGrid.querySelectorAll('.shop-card')) {
    const item = SHOP_ITEMS.find(i => i.id === card.dataset.id);
    const owned = wallet.owned.includes(item.id);
    const equipped = isEquipped(item);
    const cardState = equipped ? 'equipped' : owned ? 'owned' : wallet.coins >= item.price ? 'buyable' : 'locked';
    if (!card.classList.contains('unlocking')) card.dataset.state = cardState;
    const btn = card.querySelector('.shop-buy');
    // A dance can't be turned off (you always have one), a finisher can
    btn.disabled = equipped && item.kind === 'dance';
    btn.innerHTML = equipped ? 'EQUIPPED ✓' : owned ? 'EQUIP' : `<i class="coin" aria-hidden="true"></i>${item.price}`;
    btn.setAttribute('aria-label', equipped
      ? (item.kind === 'dance' ? `${item.name} is equipped` : `Turn off ${item.name}`)
      : owned ? `Equip ${item.name}` : `Buy ${item.name} for ${item.price} coins`);
  }
}

function openShop() {
  openModal(ui.shopModal);
  if (!studio) {
    studio = world.createDanceStudio();
    for (const card of ui.shopGrid.querySelectorAll('.shop-card')) {
      const canvas = card.querySelector('.shop-canvas');
      if (card.dataset.kind === 'finisher') studio.addFinisherStage(card.dataset.id, canvas);
      else studio.addStage(card.dataset.id, canvas);
    }
  }
  renderShop();
  renderCoins();
  world.setPaused(true);   // the classroom is covered anyway – save the graphics card some work
  studio.start();
}

function closeShop() {
  if (studio) studio.stop();
  world.setPaused(false);
}

function buyOrEquip(id) {
  const item = SHOP_ITEMS.find(i => i.id === id);
  if (!item) return;
  if (isEquipped(item)) {
    // Tapping the equipped finisher turns it off
    if (item.kind === 'finisher') {
      wallet.finisher = null;
      saveWallet();
      renderShop();
      SFX.click();
    }
    return;
  }
  const card = ui.shopGrid.querySelector(`.shop-card[data-id="${id}"]`);
  if (!wallet.owned.includes(id)) {
    if (wallet.coins < item.price) {
      toast('NOT ENOUGH COINS');
      tone([[300, 0.12], [220, 0.18]], 'triangle', 0.07);
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      return;
    }
    wallet.coins -= item.price;
    wallet.owned.push(id);
    // The padlock pops open and flies away
    card.classList.add('unlocking');
    setTimeout(() => {
      card.classList.remove('unlocking');
      renderShop();
    }, 800);
    toast(`${item.name.toUpperCase()} UNLOCKED! 🎉`);
    confetti();
    SFX.win();
  } else {
    SFX.click();
  }
  if (item.kind === 'dance') wallet.equipped = id;
  else wallet.finisher = id;
  saveWallet();
  renderShop();
  renderCoins();
}

// ================= Effects =================
function confetti() {
  if (reduceMotion) return;
  const colors = ['#ffcd1f', '#2fd157', '#ff3434', '#2a7de1', '#d68cff', '#ff9f1c'];
  ui.confetti.innerHTML = '';
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--dx', `${(Math.random() * 2 - 1) * 120}px`);
    p.style.setProperty('--rot', `${randInt(180, 900)}deg`);
    p.style.animationDuration = `${2.4 + Math.random() * 1.8}s`;
    p.style.animationDelay = `${Math.random() * 0.7}s`;
    ui.confetti.append(p);
  }
}

// ================= Settings & how to play =================
function renderSettings() {
  for (const row of ui.settingsModal.querySelectorAll('.setting')) {
    const key = row.dataset.key;
    for (const btn of row.querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String(String(settings[key]) === btn.dataset.value));
    }
  }
  ui.rulesModal.querySelector('.rules-max').textContent = settings.max;
  ui.tagline.textContent = keepRanges(`Figure out your opponent's secret number (1–${settings.max})!`);
}

function openModal(modal) {
  closeModals();
  modal.hidden = false;
  SFX.click();
  modal.querySelector('.modal-close').focus();
}

// keepRoom = we're closing the lobby because the game is starting
function closeModals({ keepRoom = false } = {}) {
  if (!ui.lobbyModal.hidden && !keepRoom && state.net.expecting) {
    net.send({ t: 'cancel' });
    crazy.leftRoom();
    state.net.expecting = false;
  }
  if (!ui.shopModal.hidden) closeShop();
  ui.settingsModal.hidden = true;
  ui.rulesModal.hidden = true;
  ui.lobbyModal.hidden = true;
  ui.shopModal.hidden = true;
}

ui.settingsModal.addEventListener('click', e => {
  const btn = e.target.closest('.seg button');
  if (!btn) return;
  const key = btn.closest('.setting').dataset.key;
  const value = SETTING_OPTIONS[key].find(option => String(option) === btn.dataset.value);
  settings[key] = value;
  saveSettings();
  renderSettings();
  renderHud();
  SFX.click();
});

for (const modal of [ui.settingsModal, ui.rulesModal, ui.lobbyModal, ui.shopModal]) {
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.closest('[data-close]')) {
      closeModals();
      SFX.click();
    }
  });
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeModals();
  toggleChat(false);
});

// ================= Buttons =================
$('playBtn').addEventListener('click', () => enterGame('bot'));
$('localBtn').addEventListener('click', () => enterGame('local'));
$('onlineBtn').addEventListener('click', () => openLobby('online'));
$('partyBtn').addEventListener('click', () => openLobby('party'));
$('rulesBtn').addEventListener('click', () => openModal(ui.rulesModal));
$('settingsBtn').addEventListener('click', () => openModal(ui.settingsModal));
$('shopBtn').addEventListener('click', openShop);
// Clicking anywhere on a card buys / equips that dance
ui.shopGrid.addEventListener('click', e => {
  const card = e.target.closest('.shop-card');
  if (card) buyOrEquip(card.dataset.id);
});

ui.chatBtn.addEventListener('click', () => toggleChat());
ui.chatPanel.addEventListener('click', e => {
  const btn = e.target.closest('button[data-kind]');
  if (btn) sendChat(btn.dataset.kind, btn.dataset.id);
});
ui.chatMute.addEventListener('change', () => {
  chatMuted = ui.chatMute.checked;
  try { localStorage.setItem('gissa-talet-mute-chat', chatMuted ? '1' : '0'); } catch { /* no storage */ }
  if (chatMuted) {
    labels.bot.chat.hidden = true;
    labels.bot.emote.hidden = true;
  }
});
// Clicking anywhere else closes the chat panel
document.addEventListener('pointerdown', e => {
  if (!ui.chatPanel.hidden && !ui.chatPanel.contains(e.target) && !ui.chatBtn.contains(e.target)) toggleChat(false);
});

$('findBtn').addEventListener('click', findOpponent);
$('createBtn').addEventListener('click', createRoom);
$('joinBtn').addEventListener('click', joinRoom);
$('copyBtn').addEventListener('click', copyInvite);
ui.lobby.querySelectorAll('[data-cancel]').forEach(btn => btn.addEventListener('click', cancelLobby));
ui.codeInput.addEventListener('input', () => {
  ui.codeInput.value = ui.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
ui.codeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});
ui.nameInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (ui.lobby.dataset.mode === 'online') findOpponent();
  else ui.codeInput.focus();
});

ui.confirm.addEventListener('click', () => {
  if (state.handoff) endHandoff();
  else confirmSelection();
});
ui.againBtn.addEventListener('click', () => {
  if (state.mode !== 'online') return newGame();
  state.net.rematchMe = true;
  net.send({ t: 'rematch' });
  SFX.click();
  render();
});
$('resultMenuBtn').addEventListener('click', showMenu);
$('homeBtn').addEventListener('click', showMenu);
$('restartBtn').addEventListener('click', () => {
  if (state.mode !== 'online') newGame();
});
ui.listBtn.addEventListener('click', () => {
  if (isWide() || canPick()) minimized = !minimized;
  else listRequested = !listRequested;
  render();
});
ui.pickerClose.addEventListener('click', () => {
  if (canPick()) minimized = true;
  else listRequested = false;
  render();
});
ui.soundBtn.addEventListener('click', () => {
  settings.sound = !settings.sound;
  saveSettings();
  renderSettings();
  renderHud();
  SFX.click();
});
window.addEventListener('resize', () => updateInsets());
narrowMQ.addEventListener('change', render);

// ================= Start =================
buildChatPanel();
renderCoins();
buildShop();
buildTiles();
world.setBoard(`1 – ${MAX}`);
renderSettings();
world.setView('menu', true);
showMenu();
updateInsets(true);
// The numbers panel slides with exactly the curve and speed of the camera moves (see scene3d.js)
if (CSS.supports('transition-timing-function', 'linear(0, 1)')) {
  ui.picker.style.transition = `transform ${PANEL_SLIDE_MS}ms ${panelEaseCss()}`;
}
if (settings.sound) {
  try { soundCtx(); } catch { /* sound not supported */ }
}
for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) {   // iPhones only allow touchend/click
  window.addEventListener(type, () => {
    if (audio.ctx?.state === 'suspended') audio.ctx.resume().catch(() => { /* not allowed yet */ });
  }, { capture: true, passive: true });
}
window.__gameReady = true;
ui.loading.classList.add('done');

// ----- CrazyGames -----
// Their settings for chat and sound win over the game's own
function applyCrazySettings() {
  const { disableChat, muteAudio } = crazy.settings();
  crazyMuted = Boolean(muteAudio);
  ui.app.classList.toggle('no-chat', Boolean(disableChat));
  if (disableChat) toggleChat(false);
  renderHud();
}

// A CrazyGames invite link, or "Join" on a friend, goes straight into that party room
function joinFromInvite(code) {
  if (!code || !/^[A-Za-z0-9]{4}$/.test(code)) return;
  if (state.screen === 'game') showMenu();
  ui.codeInput.value = code.toUpperCase();
  openLobby('party');
  joinRoom();
}

initCrazyGames().then(async active => {
  if (!active) {
    openUrlInvite();
    return;
  }
  crazyName = await crazy.username();
  applyCrazySettings();
  crazy.onSettings(applyCrazySettings);
  crazy.onJoinRoom(joinFromInvite);
  const invited = crazy.invitedRoom();
  if (invited) {
    joinFromInvite(invited);
  } else if (crazy.isInstantMultiplayer()) {
    // Started from "play with friends" on CrazyGames: straight into a new private party room
    openLobby('party');
    createRoom();
  }
});

// Our own invite link (?room=CODE) opens the party lobby with the code filled in. (On
// CrazyGames their SDK reads the invite instead, so this waits until we know it isn't there.)
function openUrlInvite() {
  const invite = new URLSearchParams(location.search).get('room');
  if (invite && /^[A-Za-z0-9]{4}$/.test(invite)) {
    ui.codeInput.value = invite.toUpperCase();
    history.replaceState(null, '', location.pathname);
    openLobby('party');
  }
}
