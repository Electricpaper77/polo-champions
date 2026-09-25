import { useState } from "react";

const GAME_URL = "https://polo-champions.vercel.app/";

export function ShareGameButton() {
  const [status, setStatus] = useState("");
  const shareGame = async () => {
    const payload = { title: "Polo Champions", text: "Take the reins in a fast, tactical 4v4 British polo match.", url: GAME_URL };
    try {
      const canUseNativeShare = typeof navigator.share === "function";
      if (canUseNativeShare) await navigator.share(payload);
      else await navigator.clipboard.writeText(GAME_URL);
      setStatus(canUseNativeShare ? "Shared with your club." : "Link copied to clipboard.");
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setStatus("Could not share the link.");
    }
  };
  return <span><button type="button" onClick={() => void shareGame()}>SHARE GAME</button>{status && <small role="status">{status}</small>}</span>;
}
