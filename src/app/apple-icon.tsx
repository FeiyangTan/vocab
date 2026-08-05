import { ImageResponse } from 'next/og';

/** iPhone「添加到主屏」用的图标。iOS 不做圆角裁切以外的处理，所以背景要铺满。 */
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
          background: '#0a0a0a',
          color: '#ededed',
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
