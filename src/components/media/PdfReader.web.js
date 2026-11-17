// PDF reader (web): the Worker's pdf.js page (/library/viewer) in an iframe; page changes arrive by postMessage.
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

export function handleViewerMessage(raw, { onPage, onReady, onError }) {
  let d = raw;
  try { if (typeof raw === 'string') d = JSON.parse(raw); } catch (e) { return; }
  if (!d || d.source !== 'bn-pdf') return;
  if (d.type === 'page' && onPage) onPage(d.page, d.pages);
  if (d.type === 'ready' && onReady) onReady(d.page, d.pages);
  if (d.type === 'error' && onError) onError(d.message);
}

export default function PdfReader({ url, onPage, onReady, onError, style }) {
  const frame = useRef(null);
  const cbs = useRef({});
  cbs.current = { onPage, onReady, onError };
  useEffect(() => {
    const origin = (String(url).match(/^https?:\/\/[^/]+/) || [''])[0];
    const onMsg = (e) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      if (origin && e.origin !== origin) return;
      handleViewerMessage(e.data, cbs.current);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [url]);
  return (
    <View style={[styles.wrap, style]}>
      <iframe ref={frame} title="Book reader" src={url} style={{ border: 0, width: '100%', height: '100%', background: '#2B2A33' }} />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { flex: 1, backgroundColor: '#2B2A33' } });
