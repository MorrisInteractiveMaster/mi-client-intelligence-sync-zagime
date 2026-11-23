import { useEffect, useState } from "react";

const themeKey = "morris-platform-theme";
const themes = ["system", "light", "dark"] as const;
type Theme = typeof themes[number];

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(themeKey);
    return themes.find(theme => theme === stored) ?? "system";
  } catch {
    return "system";
  }
}

export function usePlatformTheme() {
  const [theme, setTheme] = useState(readTheme);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    const sync = (event: StorageEvent) => {
      if (event.key === themeKey || event.key === null) setTheme(readTheme());
    };
    media.addEventListener("change", update);
    window.addEventListener("storage", sync);
    update();
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function change(value: Theme) {
    setTheme(value);
    try {
      localStorage.setItem(themeKey, value);
    } catch {
      // The selected theme remains active for this visit.
    }
  }

  return { theme, change, appearance: theme === "system" ? (systemDark ? "dark" : "light") : theme };
}

export function ThemeSelector({ theme, onChange }: { theme: Theme; onChange: (value: Theme) => void }) {
  return <label className="mi-theme-selector">
    <span>Appearance</span>
    <select value={theme} onChange={event => {
      const next = themes.find(value => value === event.target.value);
      if (next) onChange(next);
    }}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>;
}
