import React, { useEffect, useState } from "react";
import App from "./App";

const DESIGN_WIDTH = 900;
const DESIGN_HEIGHT = 700;

export function NossenApp() {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    function handleResize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const scaleX = w / DESIGN_WIDTH;
      const scaleY = h / DESIGN_HEIGHT;
      const s = Math.min(1, scaleX, scaleY);

      const contentWidth = DESIGN_WIDTH * s;
      const contentHeight = DESIGN_HEIGHT * s;

      setScale(s);
      setOffset({
        x: (w - contentWidth) / 2,
        y: (h - contentHeight) / 2,
      });
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="nossen-root">
      <div className="nossen-scale-wrapper">
        <App />
      </div>
    </div>
  );
}