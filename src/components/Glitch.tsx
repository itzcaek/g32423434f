/* Glitched pixel-style heading */

export function Glitch({
  text,
  variant = 'default',
  size,
}: {
  text: string;
  variant?: 'default' | 'error';
  size?: number;
}) {
  return (
    <h1
      className={`glitch ${variant === 'error' ? 'error' : ''}`}
      data-text={text}
      style={size ? { fontSize: size } : undefined}
    >
      {text}
    </h1>
  );
}
