import { useState } from "react";
import { readBootIntro } from "../bootIntro";
import { CardSplash } from "./BootSplashCard";
import { SealSplash } from "./BootSplashSeal";

export type BootSplashPhase = "loading" | "finishing";

export interface BootSplashProps {
  phase: BootSplashPhase;
  onDone: () => void;
}

/** Boot gate: plays the intro picked in Settings (stored on this device). */
export function BootSplash(props: BootSplashProps) {
  // Read once on mount, so the intro can't switch mid-animation.
  const [intro] = useState(readBootIntro);
  return intro === "card" ? <CardSplash {...props} /> : <SealSplash {...props} />;
}
