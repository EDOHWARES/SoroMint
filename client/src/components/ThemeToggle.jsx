import React, { useEffect } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useUIStore } from '../store';

/**
 * ThemeToggle - Dark/Light/System Theme Switcher
 */
const ThemeToggle = () => {
  const { theme, setTheme, initTheme } = useUIStore();

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  const cycleTheme = () => {
    const cycle = ['light', 'dark', 'system'];
    const nextIndex = (cycle.indexOf(theme) + 1) % cycle.length;
    setTheme(cycle[nextIndex]);
  };

  const getThemeIcon = () => {
    switch (theme) {
      case 'light': return <Sun className="w-5 h-5 text-amber-500" />;
      case 'dark': return <Moon className="w-5 h-5 text-blue-400" />;
      case 'system': return <Monitor className="w-5 h-5 text-slate-400" />;
      default: return <Monitor className="w-5 h-5" />;
    }
  };

  const getThemeLabel = () => {
    switch (theme) {
      case 'light': return 'Light mode';
      case 'dark': return 'Dark mode';
      case 'system': return 'System preference';
      default: return 'Theme';
    }
  };

  return (
    <button
      onClick={cycleTheme}
      className="
        relative flex items-center justify-center
        w-10 h-10 rounded-xl
        bg-black/5 dark:bg-white/5
        hover:bg-black/10 dark:hover:bg-white/10
        border border-black/5 dark:border-white/10
        transition-all duration-300
        focus:outline-none focus:ring-2 focus:ring-stellar-blue
        group
      "
      aria-label={`Current: ${getThemeLabel()}. Click to change theme.`}
      title={getThemeLabel()}
    >
      <span className="transition-transform duration-300 group-hover:scale-110">
        {getThemeIcon()}
      </span>
      
      {/* Tiny active indicator */}
      <span
        className={`absolute bottom-1 w-1.5 h-1.5 rounded-full transition-colors ${
          theme === 'light' ? 'bg-amber-500' : theme === 'dark' ? 'bg-blue-400' : 'bg-slate-400'
        }`}
      />
    </button>
  );
};

export default ThemeToggle;