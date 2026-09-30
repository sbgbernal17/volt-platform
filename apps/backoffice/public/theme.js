// Aplica el tema guardado (volt.theme: light | dark; ausente = el del sistema) antes del primer
// pintado. Va en un archivo propio porque la CSP solo permite scripts del mismo origen.
(() => {
  try {
    const theme = window.localStorage.getItem('volt.theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch {
    // sin almacenamiento: tema del sistema
  }
})();
