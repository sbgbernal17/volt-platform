// Configuración en tiempo de ejecución (la reemplaza el contenedor al arrancar; ver Dockerfile).
// apiBaseUrl vacío = mismo origen (Vite reenvía /admin/v1 a la API en desarrollo).
// googleMapsApiKey vacía = sin mapa (en desarrollo puede venir de VITE_GOOGLE_MAPS_BROWSER_KEY).
window.__VOLT_CONFIG__ = { apiBaseUrl: '', googleMapsApiKey: '', googleMapsMapId: '' };
