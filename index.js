/**
 * NoEditedTag — two independent tricks for the "(edited)" marker.
 *
 *  1. Local strip  — nulls edited_timestamp on incoming dispatches so YOUR
 *                    client never renders the marker. Affects nobody else.
 *  2. Cloak edits  — appends U+202B (RIGHT-TO-LEFT EMBEDDING) to the content
 *                    when you edit. The character is real message content, so
 *                    it reaches everyone, and the unterminated bidi run drags
 *                    the marker out of its normal trailing position on their
 *                    clients too. This is a rendering glitch, not a feature —
 *                    it may already be patched. Test before relying on it.
 *
 * No build step: written against the global `vendetta` object.
 * Kettu / Bunny / Revenge / Vendetta.
 */

const {
  patcher: { before },
  metro: { findByProps, findByStoreName, common: { FluxDispatcher, UserStore, React } },
  ui: { components: { Forms } },
  plugin: { storage },
  storage: { useProxy },
} = vendetta;

const RLE = "\u202B";

const MessageStore = findByStoreName("MessageStore");
const MessageActions =
  findByProps("sendMessage", "editMessage") ?? findByProps("editMessage");

storage.enabled ??= true;      // local strip
storage.onlyMine ??= true;
storage.cloakEdits ??= false;  // bidi trick — off until you've tested it

const patches = [];

/* ---------- 1. local strip ---------- */

function isMine(msg) {
  const me = UserStore.getCurrentUser()?.id;
  if (!me) return false;

  const authorId =
    msg.author?.id ??
    MessageStore?.getMessage?.(msg.channel_id, msg.id)?.author?.id;

  return authorId === me;
}

function strip(msg) {
  if (!msg || typeof msg !== "object") return;
  if (storage.onlyMine && !isMine(msg)) return;
  // null, not delete: MessageRecord.merge() keeps the old value if the key
  // is merely absent.
  msg.edited_timestamp = null;
}

/* ---------- 2. cloak edits ---------- */

function cloak(args) {
  if (!storage.cloakEdits) return;

  const payload = args[2];
  const content = payload?.content;
  if (typeof content !== "string") return;

  const clean = content.replace(/\u202B/g, "");
  // Empty content means "delete this message" — don't resurrect it.
  if (!clean.length) return;

  payload.content = clean + RLE;
}

/* ---------- lifecycle ---------- */

function onLoad() {
  patches.push(
    before("dispatch", FluxDispatcher, ([action]) => {
      if (!storage.enabled || !action) return;

      switch (action.type) {
        case "MESSAGE_CREATE":
        case "MESSAGE_UPDATE":
          strip(action.message);
          break;

        case "LOAD_MESSAGES_SUCCESS":
        case "LOAD_MESSAGES_SUCCESS_CACHED":
        case "MESSAGES_FETCH_SUCCESS":
          action.messages?.forEach?.(strip);
          break;
      }
    })
  );

  if (MessageActions?.editMessage) {
    patches.push(before("editMessage", MessageActions, cloak));
  }
}

function onUnload() {
  patches.forEach((p) => p?.());
  patches.length = 0;
  // Messages already cloaked keep their character — edit them again with the
  // setting off to clear it.
}

/* ---------- settings ---------- */

const { FormSection, FormSwitchRow, FormDivider } = Forms;

const Settings = () => {
  useProxy(storage);

  return React.createElement(
    FormSection,
    { title: "No Edited Tag" },
    React.createElement(FormSwitchRow, {
      label: "Hide marker locally",
      subLabel: "Only affects your client",
      value: storage.enabled,
      onValueChange: (v) => (storage.enabled = v),
    }),
    React.createElement(FormDivider, null),
    React.createElement(FormSwitchRow, {
      label: "Only my messages",
      subLabel: "Leave on so you can still see when others edit theirs",
      value: storage.onlyMine,
      onValueChange: (v) => (storage.onlyMine = v),
    }),
    React.createElement(FormDivider, null),
    React.createElement(FormSwitchRow, {
      label: "Cloak edits (experimental)",
      subLabel:
        "Appends an invisible bidi character to edits. Reaches other people's clients, but Discord may have patched it.",
      value: storage.cloakEdits,
      onValueChange: (v) => (storage.cloakEdits = v),
    })
  );
};

const plugin = { onLoad, onUnload, settings: Settings };

module.exports = { __esModule: true, default: plugin, ...plugin };
