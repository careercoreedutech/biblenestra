// Web preview: no on-device transcoding — the picked file is uploaded as is, and the poster frame is
// captured with a <video> + <canvas>.
export const VIDEO_TARGET = { maxSize: 1280, bitrate: 2000000 };

export async function compressVideo(uri, onProgress) {
  if (onProgress) onProgress(1);
  return { uri, sizeBytes: 0, compressed: false };
}

export function makeThumbnail(uri) {
  return new Promise((resolve) => {
    try {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.muted = true;
      v.preload = 'auto';
      v.src = uri;
      const done = (r) => { v.removeAttribute('src'); resolve(r); };
      v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
      v.onseeked = () => {
        try {
          const w = v.videoWidth; const h = v.videoHeight;
          const scale = Math.min(1, 720 / Math.max(w, h));
          const c = document.createElement('canvas');
          c.width = Math.round(w * scale); c.height = Math.round(h * scale);
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          c.toBlob((blob) => done(blob ? { blob, width: c.width, height: c.height } : null), 'image/jpeg', 0.75);
        } catch (e) { done(null); }
      };
      v.onerror = () => done(null);
      setTimeout(() => done(null), 8000);
    } catch (e) { resolve(null); }
  });
}

export const canCompress = false;
