"use client";
import { useEffect, useState } from "react";

/**
 * Simple view (default) is for people who have never deployed anything: one
 * conversation, plain words, one button per decision. The technical view adds
 * the live timeline, API calls, mode badges and the audit/limits pages.
 */
const KEY = "rz-view";
const EVENT = "rz-view-change";

export function useTechView(): [boolean, (on: boolean) => void] {
  const [tech, setTech] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        setTech(localStorage.getItem(KEY) === "tech");
      } catch {
        // storage unavailable: stay in simple view
      }
    };
    read();
    window.addEventListener(EVENT, read);
    return () => window.removeEventListener(EVENT, read);
  }, []);
  const set = (on: boolean) => {
    try {
      localStorage.setItem(KEY, on ? "tech" : "simple");
    } catch {
      // storage unavailable: the switch still applies on this page
    }
    setTech(on);
    window.dispatchEvent(new Event(EVENT));
  };
  return [tech, set];
}
