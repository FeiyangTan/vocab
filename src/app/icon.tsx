import { ImageResponse } from 'next/og';

/** 用 ImageResponse 生成，省得往仓库里塞二进制图标文件。 */
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
