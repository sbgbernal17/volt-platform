/**
 * Íconos de la app. El manual pide Material Symbols Outlined; mientras no se incorpore esa fuente
 * (ADR 0025, pendiente del dueño) se usa Material Icons de `@expo/vector-icons`, ya en el paquete,
 * con los mismos nombres del handoff en formato kebab-case.
 */
import { MaterialIcons } from '@expo/vector-icons';
import type { StyleProp, TextStyle } from 'react-native';
import { colors, size } from './tokens.ts';

export type IconName = keyof typeof MaterialIcons.glyphMap;

export function Icon({
  name,
  size: iconSize = size.icon,
  color = colors.text,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  return <MaterialIcons name={name} size={iconSize} color={color} style={style} />;
}
