/** Friends / Nostr commands (private key + friend database document). */
import { registerCommands, type CommandHandler } from "../ipc";
import {
  getNostrPrivkey,
  loadFriendsDb,
  saveFriendsDb,
  setNostrPrivkey,
} from "../features/friends/store";

export const friendsCommands: Record<string, CommandHandler> = {
  load_friends_db: () => loadFriendsDb(),

  save_friends_db: (args) => {
    saveFriendsDb(args.content);
    return null;
  },

  get_friends_nostr_privkey: () => getNostrPrivkey(),

  set_friends_nostr_privkey: (args) => {
    setNostrPrivkey(args.hex);
    return null;
  },
};

export function registerFriendsCommands(): void {
  registerCommands(friendsCommands, { override: true });
}
