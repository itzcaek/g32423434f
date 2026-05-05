/* Animated grid + floating images and floating nicknames (independent) */

const IMAGES = [
  '/images/cat-link-zero.png',
  '/images/kvas-taras.png',
  '/images/sad-cat.png',
  '/images/pasha.png',
  '/images/hackerman.png',
  '/images/okami.png',
  '/images/okami-and-migainis.png',
  '/images/yu.png',
  '/images/cry-of-fear.png',
  '/images/forgotten.png',
];

const NAMES = [
  'Zirtin', 'jackdaniels', 'cord', 'shion', 'eSportsMen',
  'Okam', 'tapirak', 'frozer', 'sirvX', 'forgotten',
  'pasha', 'kvas', 'okami', 'sad-cat', 'crylink',
];

/* Two independent decorative layers, statically positioned around the frame.
   Coords are tuples [topPercent, leftPercent] so an image and a nickname can
   sit at clearly different spots — they're no longer paired. */
const IMG_POS: Array<[string, string]> = [
  ['8%',  '5%'],   ['22%', '13%'],  ['54%', '3%'],
  ['76%', '11%'],  ['90%', '4%'],   ['12%', '90%'],
  ['28%', '94%'],  ['58%', '92%'],  ['82%', '93%'],
  ['46%', '6%'],
];

const NAME_POS: Array<[string, string]> = [
  ['16%', '2%'],   ['33%', '7%'],   ['44%', '12%'],
  ['66%', '4%'],   ['86%', '14%'],  ['8%',  '94%'],
  ['20%', '88%'],  ['38%', '93%'],  ['50%', '88%'],
  ['72%', '88%'],  ['94%', '92%'],  ['62%', '13%'],
  ['38%', '5%'],   ['78%', '6%'],   ['28%', '4%'],
];

export function Background() {
  return (
    <>
      <div className="bg-grid" />
      <div className="float-bg float-imgs">
        {IMAGES.map((src, i) => {
          const [top, left] = IMG_POS[i % IMG_POS.length];
          return (
            <div
              key={`img-${i}`}
              className="float-item float-img"
              style={{
                top,
                left,
                animationDelay: `${(i % 5) * -1.2}s`,
                animationDuration: `${5 + (i % 4)}s`,
              }}
            >
              <img src={src} alt="" loading="lazy" />
            </div>
          );
        })}
      </div>
      <div className="float-bg float-names">
        {NAMES.map((name, i) => {
          const [top, left] = NAME_POS[i % NAME_POS.length];
          return (
            <span
              key={`name-${i}`}
              className="float-item float-name"
              style={{
                top,
                left,
                animationDelay: `${(i % 6) * -0.9}s`,
                animationDuration: `${6 + (i % 5)}s`,
              }}
            >
              {name}
            </span>
          );
        })}
      </div>
    </>
  );
}
