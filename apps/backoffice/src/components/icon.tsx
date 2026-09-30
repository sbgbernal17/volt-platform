/**
 * Ícono de Material Icons por ligadura (misma familia y nombres que la app, ADR 0025 y 0030). Los
 * nombres llegan en kebab-case como en la app (`help-outline`) y se convierten a `help_outline`.
 */
export function Icon({
  name,
  size,
  className,
  title,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg' | undefined;
  className?: string | undefined;
  title?: string | undefined;
}) {
  const classes = [
    'material-icons',
    size === 'sm' ? 'icon-sm' : size === 'lg' ? 'icon-lg' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} aria-hidden={title ? undefined : true} title={title}>
      {name.replace(/-/g, '_')}
    </span>
  );
}
