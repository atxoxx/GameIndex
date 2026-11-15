// Home - the landing surface of Big Screen Mode.
//
// The active interface layout owns the composition; this module only
// resolves which one to mount. Each layout keeps the same data contract
// (the selected game is always named and described) but presents it in
// its own visual language.

import { useActivePreset } from "../../context/BigScreenPrefsContext";
import GameIndexHome from "./layouts/home/GameIndexHome";
import XboxHome from "./layouts/home/XboxHome";
import SteamHome from "./layouts/home/SteamHome";
import PlayStationHome from "./layouts/home/PlayStationHome";
import SwitchHome from "./layouts/home/SwitchHome";

export default function BigScreenHome() {
  const { id } = useActivePreset();

  switch (id) {
    case "xbox":
      return <XboxHome />;
    case "steam":
      return <SteamHome />;
    case "playstation":
      return <PlayStationHome />;
    case "switch":
      return <SwitchHome />;
    case "gameindex":
    default:
      return <GameIndexHome />;
  }
}
