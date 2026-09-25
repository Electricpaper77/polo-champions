import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import * as THREE from "three";
import { PlayerProfileStore, PLAYER_COSMETIC_COLORS, type CosmeticCoat, type CosmeticMallet } from "../services/PlayerProfile";

const coats: [CosmeticCoat, string, number][] = [["CHESTNUT", "Chestnut", 0], ["BLACK", "Black", 100], ["DAPPLE_GREY", "Dapple Grey", 300]];
const mallets: [CosmeticMallet, string, number][] = [["BAMBOO", "Bamboo", 0], ["CARBON_FIBER", "Carbon Fiber", 200]];

function GearPreview({ coat, mallet }: { coat: CosmeticCoat; mallet: CosmeticMallet }) {
  const pivot = useRef<THREE.Group>(null);
  useFrame((_, delta) => { if (pivot.current) pivot.current.rotation.y += delta * 0.55; });
  return <group ref={pivot} rotation={[0, -0.45, 0]}><mesh castShadow><capsuleGeometry args={[0.55, 1.7, 6, 12]} /><meshStandardMaterial color={PLAYER_COSMETIC_COLORS[coat]} roughness={0.52} /></mesh><mesh position={[0.66, -0.08, 0]} rotation={[0, 0, -0.35]} castShadow><cylinderGeometry args={[0.035, 0.035, 2.15, 8]} /><meshStandardMaterial color={PLAYER_COSMETIC_COLORS[mallet]} roughness={0.35} metalness={mallet === "CARBON_FIBER" ? 0.65 : 0.05} /></mesh></group>;
}

function Preview({ coat, mallet }: { coat: CosmeticCoat; mallet: CosmeticMallet }) {
  return <div style={{ height: 190, borderRadius: 12, overflow: "hidden", background: "linear-gradient(#9bc2d7, #315b37)", margin: "12px 0" }}><Canvas shadows camera={{ position: [0, 1.2, 4.2], fov: 38 }}><ambientLight intensity={0.7}/><directionalLight position={[3, 5, 4]} intensity={1.2} castShadow/><GearPreview coat={coat} mallet={mallet}/></Canvas></div>;
}

export function LockerRoom() {
  const [profile, setProfile] = useState(PlayerProfileStore.get()), [notice, setNotice] = useState("");
  const chooseCoat = (coat: CosmeticCoat) => { const result = PlayerProfileStore.unlockCoat(coat); setProfile(result.ok ? PlayerProfileStore.equip({ equippedCoat: coat }) : result.profile); setNotice(result.ok ? "EQUIPPED" : "INSUFFICIENT POLO COINS"); };
  const chooseMallet = (mallet: CosmeticMallet) => { const result = PlayerProfileStore.unlockMallet(mallet); setProfile(result.ok ? PlayerProfileStore.equip({ equippedMallet: mallet }) : result.profile); setNotice(result.ok ? "EQUIPPED" : "INSUFFICIENT POLO COINS"); };
  const marketButton = (owned: boolean, price: number) => owned ? "EQUIP" : `BUY WITH ${price} POLO COINS`;
  return <section className="customization locker-room"><small>PLAYER PROGRESSION</small><h1>LOCKER ROOM · {profile.poloCoins} POLO COINS</h1><p>MATCHES {profile.matchesPlayed} · GOALS {profile.goalsScored} · WIN RATE {PlayerProfileStore.winRate()}%</p>{notice && <p role="status" style={{ color: notice === "EQUIPPED" ? "#8fe18f" : "#ff9a87", animation: notice === "EQUIPPED" ? undefined : "goal-pulse .18s ease-in-out 3" }}>{notice}</p>}<Preview coat={profile.equippedCoat} mallet={profile.equippedMallet}/><h2>HORSE COATS</h2><div>{coats.map(([id, name, price]) => <button key={id} className={profile.equippedCoat === id ? "equipped" : ""} style={{ transition: "transform 160ms ease, background-color 160ms ease" }} onClick={() => chooseCoat(id)}>{name}<small>{marketButton(profile.unlockedCoats.includes(id), price)}</small></button>)}</div><h2>MALLETS</h2><div>{mallets.map(([id, name, price]) => <button key={id} className={profile.equippedMallet === id ? "equipped" : ""} style={{ transition: "transform 160ms ease, background-color 160ms ease" }} onClick={() => chooseMallet(id)}>{name}<small>{marketButton(profile.unlockedMallets.includes(id), price)}</small></button>)}</div></section>;
}
