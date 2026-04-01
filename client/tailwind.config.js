/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        stellar: {
          blue: '#146EF5',
          dark: '#0e141b',
          light: '#f8fafc',
        }
      }
    },
  },
  plugins: [],
}
