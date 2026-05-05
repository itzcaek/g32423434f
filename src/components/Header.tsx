/* Decorative top header navigation (links are non-functional) */

const ITEMS = [
  { src: '/images/forgotten.png',     label: 'Forgotten',     special: true,  rounded: '50%' },
  { src: '/images/nektome-chat.png',  label: 'nekto.me chat', special: false, rounded: '20%' },
  { src: '/images/nektome-voice.png', label: 'nekto.me voice', special: false, rounded: '20%' },
  { src: '/images/cqnky1.jpg',        label: 'Кьюнки1?',      active: true,   rounded: '20%' },
];

export function Header() {
  return (
    <header className="app-header">
      <ul className="header-list">
        {ITEMS.map((it) => (
          <li key={it.label} className="header-el">
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className={[it.special && 'special', it.active && 'active'].filter(Boolean).join(' ')}
            >
              <img src={it.src} alt="" style={{ borderRadius: it.rounded }} />
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </header>
  );
}
