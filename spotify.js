// spotify.js - Tích hợp Spotify (Web API, PKCE flow, free tier)

const SPOTIFY_CLIENT_ID = 'efbc230eec5a44f1864e6e7f5e81388f';
const SPOTIFY_REDIRECT_URI = 'https://aichater.html-5.me/spotify-callback.html';
const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state';

// ===== PKCE helpers =====
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  randomValues.forEach(v => { result += chars[v % chars.length]; });
  return result;
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

function base64urlEncode(buffer) {
  let str = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function spotifyLogin() {
  const codeVerifier = generateRandomString(64);
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64urlEncode(hashed);
  const state = generateRandomString(16);

  localStorage.setItem('spotify_code_verifier', codeVerifier);
  localStorage.setItem('spotify_auth_state', state);
  // Ghi nhớ trang hiện tại (home.html hoặc msg.html?id=...) để callback quay đúng chỗ
  localStorage.setItem('spotify_return_page', location.pathname.split('/').pop() + location.search);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state: state
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function spotifyIsLoggedIn() {
  const token = localStorage.getItem('spotify_access_token');
  const expiresAt = parseInt(localStorage.getItem('spotify_token_expires_at') || '0', 10);
  return !!token && Date.now() < expiresAt;
}

async function spotifyRefreshTokenIfNeeded() {
  const expiresAt = parseInt(localStorage.getItem('spotify_token_expires_at') || '0', 10);
  if (Date.now() < expiresAt) return true;

  const refreshToken = localStorage.getItem('spotify_refresh_token');
  if (!refreshToken) return false;

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: SPOTIFY_CLIENT_ID
      })
    });
    const data = await res.json();
    if (data.access_token) {
      const newExpiresAt = Date.now() + (data.expires_in * 1000);
      localStorage.setItem('spotify_access_token', data.access_token);
      localStorage.setItem('spotify_token_expires_at', String(newExpiresAt));
      if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
      return true;
    }
  } catch (e) {
    console.error('Spotify refresh error', e);
  }
  return false;
}

function spotifyLogout() {
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('spotify_token_expires_at');
}

async function spotifyGetCurrentlyPlaying() {
  if (!spotifyIsLoggedIn()) {
    const refreshed = await spotifyRefreshTokenIfNeeded();
    if (!refreshed) return null;
  }
  const token = localStorage.getItem('spotify_access_token');
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 204) return { playing: false };
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.item) return { playing: false };
    return {
      playing: data.is_playing,
      trackName: data.item.name,
      artistName: data.item.artists.map(a => a.name).join(', '),
      albumImage: data.item.album.images && data.item.album.images[0] ? data.item.album.images[0].url : '',
      trackUrl: data.item.external_urls ? data.item.external_urls.spotify : '#'
    };
  } catch (e) {
    console.error('Spotify now-playing error', e);
    return null;
  }
}

// ===== Popup UI (liquid glass, dùng chung cho home & msg) =====
let spotifyPollInterval = null;

function ensureSpotifyPopupInDOM() {
  if (document.getElementById('spotify-popup-overlay')) return;

  const style = document.createElement('style');
  style.textContent = `
    #spotify-popup-overlay {
      position: fixed;
      inset: 0;
      z-index: 9998;
      background: rgba(0,0,0,0.35);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
    }
    #spotify-popup-overlay.show {
      display: flex;
      animation: spotifyFadeIn 0.25s ease both;
    }
    @keyframes spotifyFadeIn { from { opacity: 0; } to { opacity: 1; } }
    .spotify-popup-box {
      position: relative;
      overflow: hidden;
      width: 320px;
      max-width: 90vw;
      padding: 24px 22px;
      border-radius: 24px;
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(24px) saturate(160%);
      -webkit-backdrop-filter: blur(24px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.5);
      box-shadow: 0 8px 32px rgba(0,0,0,0.25), inset 0 1px 1px rgba(255,255,255,0.5);
      color: #fff;
      text-align: center;
      animation: spotifySlideIn 0.4s cubic-bezier(.19,1,.22,1) both;
    }
    @keyframes spotifySlideIn {
      0% { opacity: 0; transform: translateY(-20px) scale(0.94); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    .spotify-popup-close {
      position: absolute;
      top: 10px;
      right: 12px;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: none;
      background: rgba(255,255,255,0.12);
      color: rgba(255,255,255,0.7);
      font-size: 14px;
      cursor: pointer;
    }
    .spotify-popup-logo {
      font-size: 32px;
      color: #1DB954;
      margin-bottom: 10px;
    }
    .spotify-popup-title {
      font-size: 17px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .spotify-popup-desc {
      font-size: 13px;
      color: rgba(255,255,255,0.65);
      line-height: 1.5;
      margin-bottom: 18px;
    }
    .spotify-login-btn {
      width: 100%;
      height: 46px;
      background: #1DB954;
      border: none;
      border-radius: 24px;
      color: #fff;
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }
    .spotify-now-playing {
      display: flex;
      align-items: center;
      gap: 12px;
      text-align: left;
      background: rgba(255,255,255,0.08);
      border-radius: 14px;
      padding: 12px;
      margin-bottom: 14px;
    }
    .spotify-album-art {
      width: 52px;
      height: 52px;
      border-radius: 8px;
      object-fit: cover;
      flex-shrink: 0;
      background: rgba(255,255,255,0.1);
    }
    .spotify-track-info { min-width: 0; flex: 1; }
    .spotify-track-name {
      font-size: 14px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .spotify-artist-name {
      font-size: 12.5px;
      color: rgba(255,255,255,0.6);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 2px;
    }
    .spotify-playing-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: #1DB954;
      font-weight: 700;
      margin-top: 4px;
    }
    .spotify-bar {
      width: 3px;
      height: 10px;
      background: #1DB954;
      border-radius: 2px;
      animation: spotifyBounce 0.9s ease-in-out infinite;
    }
    .spotify-bar:nth-child(2) { animation-delay: 0.2s; }
    .spotify-bar:nth-child(3) { animation-delay: 0.4s; }
    @keyframes spotifyBounce {
      0%, 100% { transform: scaleY(0.4); }
      50% { transform: scaleY(1); }
    }
    .spotify-logout-btn {
      font-size: 12.5px;
      color: rgba(255,255,255,0.5);
      background: none;
      border: none;
      cursor: pointer;
      margin-top: 4px;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'spotify-popup-overlay';
  overlay.innerHTML = `
    <div class="spotify-popup-box">
      <button class="spotify-popup-close" id="spotify-popup-close-btn">✕</button>
      <div id="spotify-popup-content"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('spotify-popup-close-btn').addEventListener('click', closeSpotifyPopup);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSpotifyPopup();
  });
}

async function renderSpotifyPopupContent() {
  const content = document.getElementById('spotify-popup-content');
  if (!content) return;

  if (!spotifyIsLoggedIn()) {
    const refreshed = await spotifyRefreshTokenIfNeeded();
    if (!refreshed) {
      content.innerHTML = `
        <div class="spotify-popup-logo"><i class="fa-brands fa-spotify"></i></div>
        <div class="spotify-popup-title">Kết nối Spotify</div>
        <div class="spotify-popup-desc">Đăng nhập để xem bài bạn đang nghe ngay trong AIChater.</div>
        <button class="spotify-login-btn" id="spotify-do-login-btn">Đăng nhập với Spotify</button>
      `;
      document.getElementById('spotify-do-login-btn').addEventListener('click', spotifyLogin);
      return;
    }
  }

  content.innerHTML = `
    <div class="spotify-popup-logo"><i class="fa-brands fa-spotify"></i></div>
    <div class="spotify-popup-title">Đang tải...</div>
  `;

  const nowPlaying = await spotifyGetCurrentlyPlaying();

  if (!nowPlaying || !nowPlaying.playing) {
    content.innerHTML = `
      <div class="spotify-popup-logo"><i class="fa-brands fa-spotify"></i></div>
      <div class="spotify-popup-title">Không có bài nào đang phát</div>
      <div class="spotify-popup-desc">Mở Spotify và phát nhạc để xem tại đây.</div>
      <button class="spotify-logout-btn" id="spotify-do-logout-btn">Ngắt kết nối Spotify</button>
    `;
  } else {
    content.innerHTML = `
      <div class="spotify-now-playing">
        <img class="spotify-album-art" src="${nowPlaying.albumImage}" alt="">
        <div class="spotify-track-info">
          <div class="spotify-track-name">${nowPlaying.trackName}</div>
          <div class="spotify-artist-name">${nowPlaying.artistName}</div>
          <div class="spotify-playing-badge">
            <span class="spotify-bar"></span><span class="spotify-bar"></span><span class="spotify-bar"></span>
            Đang phát
          </div>
        </div>
      </div>
      <button class="spotify-logout-btn" id="spotify-do-logout-btn">Ngắt kết nối Spotify</button>
    `;
  }

  const logoutBtn = document.getElementById('spotify-do-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      spotifyLogout();
      renderSpotifyPopupContent();
    });
  }
}

function openSpotifyPopup() {
  ensureSpotifyPopupInDOM();
  document.getElementById('spotify-popup-overlay').classList.add('show');
  renderSpotifyPopupContent();
  if (spotifyPollInterval) clearInterval(spotifyPollInterval);
  spotifyPollInterval = setInterval(renderSpotifyPopupContent, 10000);
}

function closeSpotifyPopup() {
  const overlay = document.getElementById('spotify-popup-overlay');
  if (overlay) overlay.classList.remove('show');
  if (spotifyPollInterval) {
    clearInterval(spotifyPollInterval);
    spotifyPollInterval = null;
  }
}

// Lấy bài đang nghe hiện tại để dùng cho mục đích khác (vd đưa vào system prompt AI)
async function spotifyGetNowPlayingForPrompt() {
  if (!spotifyIsLoggedIn()) {
    const refreshed = await spotifyRefreshTokenIfNeeded();
    if (!refreshed) return null;
  }
  const data = await spotifyGetCurrentlyPlaying();
  if (data && data.playing) {
    return `${data.trackName} - ${data.artistName}`;
  }
  return null;
}

function spotifyCheckJustConnected() {
  if (localStorage.getItem('spotify_just_connected') === '1') {
    localStorage.removeItem('spotify_just_connected');
    localStorage.removeItem('spotify_return_page');
    openSpotifyPopup();
  }
}

export {
  spotifyLogin,
  spotifyLogout,
  spotifyIsLoggedIn,
  spotifyGetCurrentlyPlaying,
  spotifyGetNowPlayingForPrompt,
  openSpotifyPopup,
  closeSpotifyPopup,
  spotifyCheckJustConnected
};
