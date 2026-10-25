// Profile page entry point — re-exports the modular ProfilePage from
// ./community/ProfilePage. The route stays `/community` so links, the Big
// Screen registry and the navbar key keep working.

import ProfilePage from "./community/ProfilePage";

export default ProfilePage;
