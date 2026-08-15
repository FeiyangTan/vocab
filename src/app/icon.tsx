import { ImageResponse } from 'next/og';

/** Generated with ImageResponse, which keeps binary icon files out of the repository. */
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
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
          fontSize: 300,
          fontWeight: 600,
          letterSpacing: -12,
        }}
      >
        v
      </div>
    ),
    size,
  );
}
