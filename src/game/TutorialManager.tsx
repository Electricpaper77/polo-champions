import { useEffect, useState } from "react";
import { completeTutorial } from "../services/PlayerProfile";
import { useMatch } from "./GameState";
import "./tutorial.css";

declare global { interface Window { POLO_TUTORIAL_ACTIVE?: boolean; } }

const prompts = ["Use WASD to ride your horse.", "Hold SHIFT to sprint.", "Ride past the ball and LEFT CLICK to swing.", "Score a goal to complete training!"];

export function TutorialOverlay({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0), score = useMatch(state => state.score.blue);
  useEffect(() => { window.POLO_TUTORIAL_ACTIVE = true; return () => { window.POLO_TUTORIAL_ACTIVE = false; }; }, []);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (step === 0 && ["KeyW","KeyA","KeyS","KeyD"].includes(event.code)) setStep(1); if (step === 1 && event.code.startsWith("Shift")) setStep(2); }; const click = () => { if (step === 2) setStep(3); }; window.addEventListener("keydown", key); window.addEventListener("mousedown", click); return () => { window.removeEventListener("keydown", key); window.removeEventListener("mousedown", click); }; }, [step]);
  useEffect(() => { if (step === 3 && score > 0) { completeTutorial(); onComplete(); } }, [step, score, onComplete]);
  return <section className="tutorial-overlay" role="status" aria-live="polite"><b>TRAINING GROUNDS</b><span>{prompts[step]}</span><small>STEP {step + 1}/4</small></section>;
}
