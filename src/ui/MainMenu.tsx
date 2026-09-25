import { useState } from "react";
import type { PlatformUser } from "../services/Platform";

const GAME_URL = "https://polo-champions.vercel.app/";

async function sharePoloChampions(setStatus: (value: string) => void) {
  const share = { title: "Polo Champions", text: "Take the reins in a fast, tactical 4v4 British polo match.", url: GAME_URL };
  try {
    if (navigator.share) {
      await navigator.share(share);
      setStatus("Shared with your club.");
      return;
    }
    await navigator.clipboard.writeText(GAME_URL);
    setStatus("Link copied to clipboard.");
  } catch (error) {
    if ((error as DOMException).name !== "AbortError") setStatus("Could not share the link. Please copy it from your browser.");
  }
}

export function MainMenu({ user, onQuickMatch, onPartyLobby }: { user: PlatformUser | null; onQuickMatch: () => void; onPartyLobby: () => void }) {
  const progress = user ? Math.round(user.xp / user.xpNext * 100) : 0;
  const [shareStatus, setShareStatus] = useState("");
  return <main className="lobby" aria-label="British Polo Multiplayer lobby">
    <header className="profile-header" aria-label="Player profile">{user ? <><div className="profile-badge">PC</div><div><strong>{user.displayName}</strong><small>LEVEL {user.level}</small></div><span className="xp"><i style={{ width: `${progress}%` }} /></span><small>{user.xp}/{user.xpNext} XP</small><div className="currencies"><b>◆ {user.gold} GOLD</b><b>● {user.tokens} TOKENS</b></div></> : <span>CONNECTING TO POLO CLUB…</span>}</header>
    <section className="lobby-grid"><nav className="lobby-nav"><div className="crest">♛<strong>POLO<br/>CHAMPIONS</strong><small>BRITISH POLO LEAGUE</small></div><button className="nav-active">PLAY ONLINE</button><button onClick={onQuickMatch}>QUICK MATCH <span>4V4 ›</span></button><button onClick={onPartyLobby}>CUSTOM PARTY <span>›</span></button><button>RANKED <span>›</span></button><hr/><button>HORSES</button><button>CUSTOMIZATION</button><button>CLUB</button><button>OPTIONS</button></nav><section className="hero"><small>SEASON 2026 · ONLINE MULTIPLAYER</small><h1>BRITISH POLO<br/>MULTIPLAYER</h1><p>Royal grounds. Eight riders. One ball. Take the reins in a competitive 4v4 chukker.</p><button className="quick-cta" onClick={onQuickMatch}>PLAY QUICK MATCH</button><button className="party-cta" onClick={onPartyLobby}>HOST CUSTOM PARTY</button><button className="party-cta" onClick={() => void sharePoloChampions(setShareStatus)}>SHARE GAME</button>{shareStatus && <p role="status">{shareStatus}</p>}<div className="hero-meta"><span><b>4V4</b>LIVE FORMAT</span><span><b>7:00</b>CHUKKER</span><span><b>PC</b>STEAM · EPIC</span></div></section><aside className="club-panel"><small>YOUR CLUB</small><h2>THE ASCOT RIDERS</h2><p><b>●</b> 1 FRIEND ONLINE</p><p>StableMaster is ready to ride.</p><div className="daily"><small>DAILY CHALLENGE</small><strong>Ride-off Practice</strong><span><i /></span><em>5 / 8 completed</em></div></aside></section></main>;
}
