// WIDGETS: web / iOS stub. Android home-screen widgets live in ./index.android.js (Metro picks the
// platform file), so react-native-android-widget is never bundled for web or iOS.
// iOS WidgetKit widgets need a native widget extension target; they are out of scope until the iOS build.
export function registerWidgets() {}
export async function refreshWidgets() {}
export function useHomeWidgets() {}
