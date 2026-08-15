import { ImageResponse } from 'next/og';

/** The icon iPhone's "Add to Home Screen" uses. iOS does nothing beyond rounding the
 *  corners, so the background has to cover the whole square. */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#faf7f2',
          color: '#2f5d50',
          fontSize: 108,
          fontWeight: 600,
          letterSpacing: -4,
        }}
      >
        v
      </div>
    ),
    size,
  );
}
