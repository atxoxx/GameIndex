import type {
  UserProfile,
  Friend,
  GameSession,
  GameRecommendation,
  RecommendationComment,
  GameSuggestion,
  SuggestionComment,
  FriendCircle,
  DmThread,
  RsvpStatus,
  SessionRole,
  SessionParticipant,
  SessionMessage,
  DmAttachment,
  ReactionKind,
  SuggestionReactionKind,
  SharedGameStat,
  FriendsDatabase,
} from "../../pages/friendsStorage";

export type {
  UserProfile,
  Friend,
  GameSession,
  GameRecommendation,
  RecommendationComment,
  GameSuggestion,
  SuggestionComment,
  FriendCircle,
  DmThread,
  RsvpStatus,
  SessionRole,
  SessionParticipant,
  SessionMessage,
  DmAttachment,
  ReactionKind,
  SuggestionReactionKind,
  SharedGameStat,
  FriendsDatabase,
};

export type FriendsTabKey =
  | "friends"
  | "activity"
  | "dms"
  | "sessions"
  | "recs"
  | "suggestions"
  | "compare"
  | "leaderboard"
  | "race"
  | "profile";

/** The seven destinations exposed by the friends hub strip. */
export type FriendsHubTab = "friends" | "activity" | "messages" | "sessions" | "play" | "stats" | "profile";

export type FriendsPlaySegment = "recommendations" | "suggestions";
export type FriendsStatsSegment = "compare" | "leaderboard" | "race";

export interface FriendInvitation {
  syncId: string;
  name: string;
  avatar: string;
  status: string;
  favoriteGame?: string;
  libStats?: {
    gamesCount: number;
    playtimeMinutes: number;
    achievementsCount: number;
  };
}

export interface SyncLogEntry {
  time: string;
  message: string;
  details: string[];
}

export interface UnseenCounts {
  sessions: number;
  recs: number;
  suggestions: number;
  activity: number;
  dms: number;
}
