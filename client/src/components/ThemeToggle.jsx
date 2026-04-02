import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useUIStore } from '../store';

const ThemeToggle = () => {
  const { theme, toggleTheme } = useUIStore();

  return (
    <button
      onClick={toggleTheme}
      className="
        relative 
        w-16 h-8 
        rounded-full 
        bg-slate-700 dark:bg-slate-700
        transition-colors duration-300
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stellar-blue
        hover:bg-slate-600 dark:hover:bg-slate-600
      "
      role="switch"
      aria-checked={theme === 'dark'}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {/* Slider Circle */}
      <span
        className={`
          absolute 
          top-1 
          w-6 h-6 
          rounded-full 
          bg-white 
          shadow-md
          transition-transform duration-300 ease-in-out
          flex items-center justify-center
          ${theme === 'dark' ? 'translate-x-9' : 'translate-x-1'}
        `}
      >
        {/* Icon */}
        {theme === 'dark' ? (
          <Moon size={14} className="text-slate-700" aria-hidden="true" />
        ) : (
          <Sun size={14} className="text-yellow-500" aria-hidden="true" />
        )}
      </span>
import { useEffect } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useUIStore } from '../store';

/**
 * ThemeToggle - Dark/Light Mode Theme Switcher
 * 
 * Features:
 * - Cycles through: light -> dark -> system -> light
 * - Persists preference to localStorage
 * - Automatically detects system preference
 * - Aesthetic toggle switch with icons
 */
const ThemeToggle = () => {
  const { theme, resolvedTheme, setTheme, initTheme } = useUIStore();

  // Initialize theme on mount
  useEffect(() => {
    initTheme();
  }, [initTheme]);

  // Get icon and label based on current theme
  const getThemeIcon = () => {
    switch (theme) {
      case 'light':
        return <Sun className="w-5 h-5" aria-hidden="true" />;
      case 'dark':
        return <Moon className="w-5 h-5" aria-hidden="true" />;
      case 'system':
        return <Monitor className="w-5 h-5" aria-hidden="true" />;
      default:
        return <Moon className="w-5 h-5" aria-hidden="true" />;
    }
  };

  const getThemeLabel = () => {
    switch (theme) {
      case 'light':
        return 'Light mode';
      case 'dark':
        return 'Dark mode';
      case 'system':
        return `System preference (${resolvedTheme})`;
      default:
        return 'Dark mode';
    }
  };

  const cycleTheme = () => {
    const cycle = ['light', 'dark', 'system'];
    const currentIndex = cycle.indexOf(theme);
    const nextIndex = (currentIndex + 1) % cycle.length;
    setTheme(cycle[nextIndex]);
  };

  return (
    <button
      onClick={cycleTheme}
      className="
        relative
        flex items-center justify-center
        w-10 h-10
        rounded-xl
        bg-white/5 dark:bg-white/5
        hover:bg-white/10 dark:hover:bg-white/10
        border border-white/10
        transition-all duration-300
        focus:outline-none focus:ring-2 focus:ring-stellar-blue focus:ring-offset-2 focus:ring-offset-stellar-dark dark:focus:ring-offset-stellar-dark
        group
      "
      aria-label={`Current: ${getThemeLabel()}. Click to change theme.`}
      title={getThemeLabel()}
    >
      <span className="transition-transform duration-300 group-hover:scale-110 group-active:scale-95">
        {getThemeIcon()}
      </span>
      
      {/* Visual indicator for theme state */}
      <span
        className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full transition-colors duration-300"
        style={{
          backgroundColor: theme === 'light' 
            ? '#fbbf24' /* amber-400 */
            : theme === 'dark' 
              ? '#60a5fa' /* blue-400 */
              : '#94a3b8' /* slate-400 for system */
        }}
        aria-hidden="true"
      />
    </button>
  );
};

export default ThemeToggle;