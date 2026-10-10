// The CrazyGames SDK (https://docs.crazygames.com). It's only there in the CrazyGames version
// (build_crazygames.py adds its script tag), and only switches on when the game runs on
// CrazyGames – or on localhost, for testing. Everything here is safe to call when it's off.
let SDK = null;

export async function initCrazyGames() {
  const sdk = window.CrazyGames?.SDK;
  if (!sdk) return false;
  try {
    await sdk.init();
  } catch {
    return false;
  }
  if (sdk.environment !== 'crazygames' && sdk.environment !== 'local') return false;
  SDK = sdk;
  return true;
}

// Runs one SDK call; anything that goes wrong just gives the fallback
function call(fn, fallback = null) {
  if (!SDK) return fallback;
  try {
    return fn(SDK);
  } catch {
    return fallback;
  }
}

export const crazy = {
  get active() {
    return Boolean(SDK);
  },

  // When a round is being played (CrazyGames measures play time with this)
  gameplayStart: () => call(sdk => sdk.game.gameplayStart()),
  gameplayStop: () => call(sdk => sdk.game.gameplayStop()),
  // A happy moment, like winning
  happytime: () => call(sdk => sdk.game.happytime()),

  // The player's CrazyGames username (null when not logged in)
  async username() {
    if (!call(sdk => sdk.user.isUserAccountAvailable, false)) return null;
    try {
      return (await SDK.user.getUser())?.username || null;
    } catch {
      return null;
    }
  },

  // Party rooms. The room code travels in CrazyGames' invite links as "room".
  invitedRoom: () => call(sdk => sdk.game.getInviteParam('room')),
  isInstantMultiplayer: () => call(sdk => Boolean(sdk.game.isInstantMultiplayer), false),
  inviteLink: code => call(sdk => sdk.game.inviteLink({ room: code })),
  roomOpen: code => call(sdk => sdk.game.updateRoom({ roomId: code, isJoinable: true, inviteParams: { room: code } })),
  roomFull: code => call(sdk => sdk.game.updateRoom({ roomId: code, isJoinable: false })),
  leftRoom: () => call(sdk => sdk.game.leftRoom()),
  // A friend clicked "Join" on CrazyGames while the game is already open
  onJoinRoom: listener => call(sdk => sdk.game.addJoinRoomListener(params => listener(params?.room))),

  // CrazyGames' own switches for chat and sound
  settings: () => call(sdk => sdk.game.settings, null) || {},
  onSettings: listener => call(sdk => sdk.game.addSettingsChangeListener(listener)),
};
