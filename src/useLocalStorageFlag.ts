import { useState } from "react";

// A persisted boolean flag (e.g. "onboarding dismissed"). localStorage can
// throw (private browsing, storage disabled) — fail soft per the app's error
// convention: the flag just behaves as unset and the UI reappears.

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function useLocalStorageFlag(key: string): [boolean, () => void] {
  const [value, setValue] = useState(() => read(key));
  const set = () => {
    setValue(true);
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // storage unavailable — the in-memory flag still holds for this session
    }
  };
  return [value, set];
}
