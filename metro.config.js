const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const config = getDefaultConfig(__dirname);
// Bundled Bible translations ship as plain-text assets (".bible" = JSON), loaded on demand — not inlined into the JS bundle.
config.resolver.assetExts.push('bible');

// Web preview only: expo-video has no web build in this setup, so swap in a stub when the preview stub exists.
const stub = path.join(__dirname, '.preview', 'expo-video.js');
const orig = config.resolver.resolveRequest;
config.resolver.resolveRequest = (ctx, name, platform) => {
  if (platform === 'web' && name === 'expo-video' && fs.existsSync(stub)) return { type: 'sourceFile', filePath: stub };
  return (orig || ctx.resolveRequest)(ctx, name, platform);
};
module.exports = config;
