// Configuración de Metro de Expo (detecta el monorepo pnpm y sus paquetes de espacio de trabajo).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
