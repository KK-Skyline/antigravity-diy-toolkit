// 用法: node tools/agcdp.js eval tools/check-wallpaper.js
// 一眼看清 Antigravity 当前的壁纸与主题状态
(async () => {
  const s = document.getElementById('antigravity-we-style');
  const css = s ? s.textContent : '';
  const i = css.indexOf('url("data:');
  const v = document.getElementById('ag-wallpaper-video');
  const rain = document.getElementById('ag-rain-canvas');
  const q = v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
  const st = document.documentElement.style;
  return JSON.stringify({
    themeLoaded: css.includes('失重亚克力'),
    staticWallpaper: i > 0 ? css.slice(i + 10, css.indexOf(';', i)) + ' ' + Math.round((css.indexOf('"', i + 5) - i) / 1024) + 'KB' : 'none',
    video: v ? { src: v.currentSrc.slice(0, 40), paused: v.paused, t: +v.currentTime.toFixed(1), duration: Math.round(v.duration || 0), size: v.videoWidth + 'x' + v.videoHeight, frames: q && q.totalVideoFrames, dropped: q && q.droppedVideoFrames, error: v.error && v.error.code } : null,
    rain: rain ? { connected: rain.isConnected, size: rain.width + 'x' + rain.height } : null,
    windowHidden: document.hidden,
    vars: Object.fromEntries(['--ag-accent', '--ag-glass-a', '--ag-wp-bright', '--ag-scrim'].map(p => [p, st.getPropertyValue(p)]))
  }, null, 1);
})()
