// WIDGETS (Android): registers the widget task handler (runs headless when Android adds / updates /
// resizes a widget, including the daily refresh) and keeps the widgets fresh while the app is open.
// Web / iOS use ./index.js (no-op), so the native widget library is never bundled there.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { registerWidgetTaskHandler, requestWidgetUpdate } from 'react-native-android-widget';
import { renderBibleNestraWidget, WIDGET_NAMES } from './BibleNestraWidgets';
import { loadWidgetData } from './widgetData';
import { STORE_KEY } from '../store';

async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget }) {
  try {
    if (widgetAction === 'WIDGET_DELETED') return;
    // Taps use OPEN_URI deep links (handled natively), so WIDGET_CLICK only needs a redraw.
    const data = await loadWidgetData(STORE_KEY);
    renderWidget(renderBibleNestraWidget(widgetInfo, data));
  } catch (e) { /* never crash the headless task */ }
}

let registered = false;
export function registerWidgets() {
  if (registered) return;
  registered = true;
  try { registerWidgetTaskHandler(widgetTaskHandler); } catch (e) { /* widget module missing in Expo Go */ }
}
registerWidgets();

export async function refreshWidgets() {
  try {
    const data = await loadWidgetData(STORE_KEY);
    await Promise.all(WIDGET_NAMES.map((widgetName) => requestWidgetUpdate({
      widgetName,
      renderWidget: (info) => renderBibleNestraWidget({ ...info, widgetName }, data),
    }).catch(() => {})));
  } catch (e) { /* no widgets placed / module unavailable */ }
}

/** Mounted once at the app root: redraw the widgets when reading progress / the day's content changes. */
export function useHomeWidgets(state, ready) {
  const plans = ready && state && state.plans ? state.plans.map((p) => `${p.id}:${p.done}`).join('|') : '';
  const day = new Date().toDateString();
  useEffect(() => {
    if (!ready) return undefined;
    // the store saves to AsyncStorage asynchronously → redraw shortly after
    const t = setTimeout(() => { refreshWidgets(); }, 1500);
    return () => clearTimeout(t);
  }, [ready, plans, day, state && state.version ? Math.floor(state.version / 25) : 0]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refreshWidgets(); });
    return () => sub.remove();
  }, []);
}
