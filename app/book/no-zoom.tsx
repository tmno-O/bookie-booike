"use client";

import { useEffect } from "react";

/** iOS Safari ignores user-scalable=no, so also block its pinch gesture and double-tap zoom. */
export default function NoZoom() {
  useEffect(() => {
    const block = (event: Event) => event.preventDefault();
    document.addEventListener("gesturestart", block);
    document.addEventListener("gesturechange", block);
    document.documentElement.style.touchAction = "manipulation";
    return () => {
      document.removeEventListener("gesturestart", block);
      document.removeEventListener("gesturechange", block);
      document.documentElement.style.touchAction = "";
    };
  }, []);
  return null;
}
