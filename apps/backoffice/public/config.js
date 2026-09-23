// Configuración en tiempo de ejecución (la reemplaza el contenedor al arrancar; ver Dockerfile).
// apiBaseUrl vacío = mismo origen (Vite reenvía /admin/v1 a la API en desarrollo).
window.__VOLT_CONFIG__ = { apiBaseUrl: '' };
