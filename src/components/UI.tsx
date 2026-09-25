import { useEffect } from "react";
import { useMatch } from "../game/GameState";

/** Hidden developer-only time skip. Press T during a match to reach the final board. */
export function DeveloperTimeSkip() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyT" || event.repeat) return;
      useMatch.setState({ seconds: 0, chukker: 4, chukkerTransition: false, matchComplete: true, paused: true, started: false, message: "FULL TIME" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return null;
}
