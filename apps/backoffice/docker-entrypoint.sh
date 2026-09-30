#!/bin/sh
# Inyecta la configuración de tiempo de ejecución (URL de la API, clave pública y Map ID de Google Maps)
# sin reconstruir la imagen.
set -eu
API_BASE_URL="${API_BASE_URL:-}"
API_ORIGIN="${API_BASE_URL:-'self'}"
GOOGLE_MAPS_BROWSER_KEY="${GOOGLE_MAPS_BROWSER_KEY:-}"
GOOGLE_MAPS_MAP_ID="${GOOGLE_MAPS_MAP_ID:-}"
cat > /usr/share/nginx/html/config.js <<JS
window.__VOLT_CONFIG__ = { apiBaseUrl: "${API_BASE_URL}", googleMapsApiKey: "${GOOGLE_MAPS_BROWSER_KEY}", googleMapsMapId: "${GOOGLE_MAPS_MAP_ID}" };
JS
sed "s|\${API_ORIGIN}|${API_ORIGIN}|g" /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
