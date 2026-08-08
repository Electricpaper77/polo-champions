import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { Game } from "./game/Game";
createRoot(document.getElementById("root")!).render(<React.StrictMode><Game /></React.StrictMode>);
