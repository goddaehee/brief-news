import { create } from "zustand";
import type { FilterKey, Reaction } from "./types";

const REACT_KEY = "brief-reactions";
const NOTIFY_KEY = "brief-notify";

function readReactions(): Record<string, Reaction> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(REACT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Reaction>) : {};
  } catch {
    return {};
  }
}

function readNotify(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(NOTIFY_KEY) === "1";
}

type FeedState = {
  filter: FilterKey;
  focused: number;
  visible: number;
  notify: boolean;
  reactions: Record<string, Reaction>;
  setFilter: (k: FilterKey) => void;
  setFocused: (n: number) => void;
  loadMore: () => void;
  resetVisible: () => void;
  toggleNotify: () => boolean;
  setReaction: (id: string, r: Reaction) => void;
};

export const PAGE = 20;

export const useFeed = create<FeedState>((set, get) => ({
  filter: "all",
  focused: -1,
  visible: PAGE,
  notify: false,
  reactions: {},
  setFilter: (filter) => set({ filter, focused: -1, visible: PAGE }),
  setFocused: (focused) => set({ focused }),
  loadMore: () => set({ visible: get().visible + PAGE }),
  resetVisible: () => set({ visible: PAGE }),
  toggleNotify: () => {
    const next = !get().notify;
    try {
      localStorage.setItem(NOTIFY_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ notify: next });
    return next;
  },
  setReaction: (id, r) => {
    const prev = get().reactions;
    const next = { ...prev, [id]: prev[id] === r ? (undefined as unknown as Reaction) : r };
    if (prev[id] === r) delete next[id];
    try {
      localStorage.setItem(REACT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    set({ reactions: next });
  },
}));

export function hydratePrefs() {
  useFeed.setState({
    notify: readNotify(),
    reactions: readReactions(),
  });
}
