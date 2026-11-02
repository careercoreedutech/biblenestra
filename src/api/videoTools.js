// Native video preparation before upload: compress to 720p H.264 MP4 (≈2 Mbps) and grab a poster frame.
// Uses react-native-compressor (needs a development / EAS build — it isn't inside Expo Go);
// without it the original file is uploaded (the server still caps size at ~95 MB).
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as FileSystem from 'expo-file-system';

let Compressor = null;
try {
  // eslint-disable-next-line global-require
  Compressor = require('react-native-compressor');
} catch (e) {
  Compressor = null;
}

export const VIDEO_TARGET = { maxSize: 1280, bitrate: 2000000 }; // 720p (longest side 1280 px), ~15 MB per minute

/** → { uri, sizeBytes, compressed } ; onProgress(0..1) */
export async function compressVideo(uri, onProgress) {
  let out = uri;
  let compressed = false;
  if (Compressor && Compressor.Video && Compressor.Video.compress) {
    try {
      out = await Compressor.Video.compress(
        uri,
        { compressionMethod: 'manual', maxSize: VIDEO_TARGET.maxSize, bitrate: VIDEO_TARGET.bitrate, minimumFileSizeForCompress: 0 },
        (p) => { if (onProgress) onProgress(Math.max(0, Math.min(1, p))); },
      );
      compressed = true;
    } catch (e) {
      out = uri; // fall back to the original rather than failing the post
    }
  }
  if (onProgress) onProgress(1);
  const info = await FileSystem.getInfoAsync(out, { size: true }).catch(() => ({}));
  return { uri: out, sizeBytes: info && info.size ? info.size : 0, compressed };
}

/** Poster frame at ~1 s → { uri } | null */
export async function makeThumbnail(uri) {
  try {
    const t = await VideoThumbnails.getThumbnailAsync(uri, { time: 1000, quality: 0.7 });
    return { uri: t.uri, width: t.width, height: t.height };
  } catch (e) {
    return null;
  }
}

export const canCompress = !!Compressor;
