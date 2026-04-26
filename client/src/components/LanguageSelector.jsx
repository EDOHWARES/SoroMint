import { useTranslation } from 'react-i18next';

const LANGUAGES = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
];

export default function LanguageSelector() {
  const { i18n } = useTranslation();

  const handleChange = (e) => {
    const lang = e.target.value;
    i18n.changeLanguage(lang);
    const selected = LANGUAGES.find((l) => l.code === lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = selected ? selected.dir : 'ltr';
  };

  return (
    <select
      value={i18n.language}
      onChange={handleChange}
      className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-stellar-blue transition-colors"
      aria-label="Language selector"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code} className="bg-stellar-dark">
          {lang.label}
        </option>
      ))}
    </select>
  );
}
