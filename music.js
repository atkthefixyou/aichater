// music.js - Thư viện nhạc dùng chung (Cloudinary lưu file, Firestore lưu metadata)

import { collection, addDoc, getDocs, orderBy, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import notification from './notification.js';

let currentUserUid = null;
const ADMIN_UID = 'uid_that_is_you'; // thay bằng UID Firebase thật của bạn

function setMusicCurrentUser(uid) {
  currentUserUid = uid;
}

let AudioPlayer = null;
let isNativePlatform = false;
try {
  const capCore = await import('@capacitor/core');
  const nativeAudioModule = await import('@mediagrid/capacitor-native-audio');
  AudioPlayer = nativeAudioModule.AudioPlayer;
  isNativePlatform = capCore.Capacitor.isNativePlatform();
} catch (e) {
  // Chạy trên web thuần (không phải app Capacitor) -> dùng thẻ <audio> HTML thường
  isNativePlatform = false;
}

const CLOUDINARY_CLOUD_NAME = 'dodrsc6hb';
const CLOUDINARY_UPLOAD_PRESET = 'aichater_music';
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
const NATIVE_AUDIO_ID = 'aichaterMusicPlayer';

let dbInstance = null;
let currentAudio = null;
let currentPlayingId = null;
let nativeAudioInitialized = false;
let currentPlaylist = [];
let currentIndex = -1;
let islandUpdateInterval = null;

function musicInit(db) {
  dbInstance = db;
  ensureMusicPopupInDOM();
}

// ===== Upload lên Cloudinary =====
async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(CLOUDINARY_UPLOAD_URL, {
    method: 'POST',
    body: formData
  });
  if (!res.ok) throw new Error('Upload thất bại');
  const data = await res.json();
  return data.secure_url;
}

// ===== Firestore: lưu / lấy danh sách nhạc =====
async function saveMusicEntry({ title, artist, platform, coverUrl, audioUrl }) {
  const musicCol = collection(dbInstance, 'musicLibrary');
  await addDoc(musicCol, {
    title,
    artist,
    platform,
    coverUrl: coverUrl || '',
    audioUrl,
    uploaderId: currentUserUid,
    createdAt: serverTimestamp()
  });
}

async function fetchMusicList() {
  const musicCol = collection(dbInstance, 'musicLibrary');
  const q = query(musicCol, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
  return list;
}

// ===== Popup UI (liquid glass, giống Spotify) =====
function ensureMusicPopupInDOM() {
  if (document.getElementById('music-popup-overlay')) return;

  const style = document.createElement('style');
  style.textContent = `
    #music-popup-overlay {
      position: fixed;
      inset: 0;
      z-index: 9997;
      background: rgba(0,0,0,0.4);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: none;
      align-items: flex-end;
      justify-content: center;
    }
    #music-popup-overlay.show {
      display: flex;
      animation: musicFadeIn 0.25s ease both;
    }
    @keyframes musicFadeIn { from { opacity: 0; } to { opacity: 1; } }
    .music-popup-box {
      position: relative;
      overflow: hidden;
      width: 100%;
      max-width: 480px;
      max-height: 82vh;
      display: flex;
      flex-direction: column;
      border-radius: 26px 26px 0 0;
      background: rgba(20,20,26,0.75);
      backdrop-filter: blur(28px) saturate(160%);
      -webkit-backdrop-filter: blur(28px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.15);
      border-bottom: none;
      box-shadow: 0 -8px 40px rgba(0,0,0,0.4);
      color: #fff;
      animation: musicSlideUp 0.4s cubic-bezier(.19,1,.22,1) both;
    }
    @keyframes musicSlideUp {
      0% { opacity: 0; transform: translateY(40px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    .music-popup-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 18px 18px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      flex-shrink: 0;
    }
    .music-popup-logo-icon {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: rgba(255,255,255,0.12);
      backdrop-filter: blur(12px) saturate(150%);
      -webkit-backdrop-filter: blur(12px) saturate(150%);
      border: 1px solid rgba(255,255,255,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }
    .music-popup-title {
      font-size: 17px;
      font-weight: 700;
      flex: 1;
    }
    .music-popup-close {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.2);
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(12px) saturate(150%);
      -webkit-backdrop-filter: blur(12px) saturate(150%);
      color: rgba(255,255,255,0.7);
      font-size: 14px;
      cursor: pointer;
      flex-shrink: 0;
    }
    .music-popup-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 14px;
    }
    .music-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 48px 24px;
      gap: 10px;
      color: rgba(255,255,255,0.5);
    }
    .music-empty-icon { font-size: 34px; color: rgba(255,255,255,0.25); margin-bottom: 4px; }
    .music-empty-title { font-size: 15px; font-weight: 700; color: rgba(255,255,255,0.8); }
    .music-empty-sub { font-size: 12.5px; line-height: 1.5; max-width: 260px; }

    .music-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 8px;
      border-radius: 14px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 0.2s, border-color 0.2s, backdrop-filter 0.2s;
    }
    .music-item:active {
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(14px) saturate(150%);
      -webkit-backdrop-filter: blur(14px) saturate(150%);
      border-color: rgba(255,255,255,0.15);
    }
    .music-item.playing {
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(16px) saturate(160%);
      -webkit-backdrop-filter: blur(16px) saturate(160%);
      border-color: rgba(255,255,255,0.22);
    }
    .music-cover {
      width: 46px;
      height: 46px;
      border-radius: 10px;
      object-fit: cover;
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      flex-shrink: 0;
    }
    .music-item-info { flex: 1; min-width: 0; }
    .music-item-title {
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .music-item-sub {
      font-size: 12px;
      color: rgba(255,255,255,0.5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 2px;
    }
    
    .music-edit-btn {
  background: rgba(255,255,255,0.1);
  border: none;
  color: rgba(255,255,255,0.7);
  width: 26px;
  height: 26px;
  border-radius: 50%;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}
    
    .music-platform-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 6px;
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(10px) saturate(150%);
      -webkit-backdrop-filter: blur(10px) saturate(150%);
      border: 1px solid rgba(255,255,255,0.18);
      color: rgba(255,255,255,0.6);
      flex-shrink: 0;
      text-transform: uppercase;
    }
    .music-play-icon {
      font-size: 16px;
      color: #fff;
      flex-shrink: 0;
      width: 20px;
      text-align: center;
    }

    .music-popup-footer {
      padding: 14px 18px;
      border-top: 1px solid rgba(255,255,255,0.1);
      flex-shrink: 0;
    }
    .music-add-btn {
      width: 100%;
      height: 46px;
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(14px) saturate(150%);
      -webkit-backdrop-filter: blur(14px) saturate(150%);
      border: 1px solid rgba(255,255,255,0.25);
      border-radius: 14px;
      color: #fff;
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }
    .music-add-btn::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(115deg, transparent 20%, rgba(255,255,255,0.25) 32%, transparent 44%);
      background-size: 250% 250%;
      animation: musicBtnSheen 2.5s linear infinite;
      pointer-events: none;
    }
    @keyframes musicBtnSheen {
      0% { background-position: 150% 0%; }
      100% { background-position: -50% 0%; }
    }

    /* Form thêm nhạc */
    .music-form-field { margin-bottom: 14px; position: relative; }
    .music-form-label {
      font-size: 12.5px;
      color: rgba(255,255,255,0.6);
      margin-bottom: 6px;
      display: block;
    }
    .music-form-input {
      width: 100%;
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(14px) saturate(150%);
      -webkit-backdrop-filter: blur(14px) saturate(150%);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 10px;
      color: #fff;
      font-family: inherit;
      font-size: 14px;
      padding: 10px 12px;
      outline: none;
      box-sizing: border-box;
    }

    /* Custom dropdown liquid glass - thay cho <select> mặc định */
    .music-dropdown { position: relative; }
    .music-dropdown-trigger {
      width: 100%;
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(14px) saturate(150%);
      -webkit-backdrop-filter: blur(14px) saturate(150%);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 10px;
      color: #fff;
      font-family: inherit;
      font-size: 14px;
      padding: 10px 12px;
      text-align: left;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .music-dropdown-trigger .placeholder { color: rgba(255,255,255,0.4); }
    .music-dropdown-trigger i { font-size: 12px; color: rgba(255,255,255,0.5); transition: transform 0.2s; }
    .music-dropdown.open .music-dropdown-trigger i { transform: rotate(180deg); }
    .music-dropdown-menu {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      z-index: 10;
      background: rgba(30,30,36,0.85);
      backdrop-filter: blur(24px) saturate(160%);
      -webkit-backdrop-filter: blur(24px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.35);
      overflow: hidden;
      display: none;
      max-height: 220px;
      overflow-y: auto;
    }
    .music-dropdown.open .music-dropdown-menu { display: block; }
    .music-dropdown-item {
      padding: 11px 14px;
      font-size: 14px;
      color: #fff;
      cursor: pointer;
    }
    .music-dropdown-item:active,
    .music-dropdown-item.selected {
      background: rgba(255,255,255,0.1);
    }

    .music-file-btn {
      width: 100%;
      padding: 12px;
      background: rgba(255,255,255,0.06);
      backdrop-filter: blur(12px) saturate(150%);
      -webkit-backdrop-filter: blur(12px) saturate(150%);
      border: 1px dashed rgba(255,255,255,0.3);
      border-radius: 10px;
      color: rgba(255,255,255,0.7);
      font-family: inherit;
      font-size: 13px;
      text-align: center;
      cursor: pointer;
      box-sizing: border-box;
    }
    .music-file-btn.has-file {
      color: #fff;
      border-color: rgba(255,255,255,0.5);
      background: rgba(255,255,255,0.12);
      backdrop-filter: blur(14px) saturate(160%);
      -webkit-backdrop-filter: blur(14px) saturate(160%);
    }
    .music-disclaimer {
      font-size: 11px;
      color: rgba(255,255,255,0.4);
      line-height: 1.5;
      margin-bottom: 16px;
    }
    .music-submit-btn {
      width: 100%;
      height: 46px;
      background: rgba(255,255,255,0.12);
      backdrop-filter: blur(14px) saturate(150%);
      -webkit-backdrop-filter: blur(14px) saturate(150%);
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 14px;
      color: #fff;
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }
    .music-submit-btn::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(115deg, transparent 20%, rgba(255,255,255,0.3) 32%, transparent 44%);
      background-size: 250% 250%;
      animation: musicBtnSheen 2.5s linear infinite;
      pointer-events: none;
    }
    .music-submit-btn:disabled { opacity: 0.5; cursor: default; }
    .music-submit-btn:disabled::before { display: none; }
    .music-back-link {
      background: none;
      border: none;
      color: rgba(255,255,255,0.6);
      font-size: 13px;
      cursor: pointer;
      margin-bottom: 14px;
      padding: 0;
    }

    /* Loading overlay riêng cho upload nhạc, giống style "Đang xử lý"/"Đang nạp" */
    .music-loading-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.45);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    .music-loading-overlay.show {
      display: flex;
      animation: musicFadeIn 0.25s ease both;
    }
    .music-loading-box {
      position: relative;
      overflow: hidden;
      padding: 32px 36px;
      border-radius: 24px;
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(24px) saturate(160%);
      -webkit-backdrop-filter: blur(24px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.3);
      box-shadow: 0 8px 32px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.3);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      animation: musicSlideUp 0.4s cubic-bezier(.19,1,.22,1) both;
      color: #fff;
    }
    .music-loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255,255,255,0.25);
      border-top-color: #fff;
      border-radius: 50%;
      animation: musicSpin 0.8s linear infinite;
    }
    @keyframes musicSpin { to { transform: rotate(360deg); } }
    .music-loading-title { font-size: 16px; font-weight: 700; }
    .music-loading-sub { font-size: 13px; color: rgba(255,255,255,0.6); margin-top: -8px; }

    /* ===== DYNAMIC ISLAND GIẢ LẬP ===== */
#music-island-wrapper {
  position: fixed;
  inset: 0;
  z-index: 9990;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12px;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;   /* giữ none luôn, không đổi */
  transition: visibility 0s 0.5s, opacity 0.5s ease;
}

#music-island-wrapper.show {
  visibility: visible;
  opacity: 1;
  pointer-events: none;   /* SỬA: đổi từ auto -> none, wrapper không bao giờ nhận click */
  transition: visibility 0s, opacity 0.5s ease;
}

#music-island {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: auto;
  flex-direction: column;
  align-items: stretch;
  background: rgba(15,15,18,0.75);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 26px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.1);
  color: #fff;
  overflow: hidden;
  cursor: pointer;
  display: flex;
  
  width: 190px;
  height: 40px;
  max-width: calc(100vw - 24px);
  
  /* CSS variable cho vị trí mở rộng */
  --expanded-top: 50vh;
  
  /* MỘT transition duy nhất — 4.0s cho TẤT CẢ */
  transition: top 4.0s cubic-bezier(0.25, 1, 0.4, 1),
              width 4.0s cubic-bezier(0.25, 1, 0.4, 1),
              height 4.0s cubic-bezier(0.25, 1, 0.4, 1),
              border-radius 4.0s cubic-bezier(0.25, 1, 0.4, 1),
              transform 4.0s cubic-bezier(0.25, 1, 0.4, 1);
}

#music-island-wrapper.show #music-island {
  animation: islandPop 1.0s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes islandPop {
  0% { opacity: 0; transform: translateX(-50%) scale(0.9); }
  100% { opacity: 1; transform: translateX(-50%) scale(1); }
}

/* MỞ RỘNG — dùng CSS variable */
#music-island.expanded {
  top: var(--expanded-top);     /* ← Transition từ 12px → var(--expanded-top) */
  width: calc(100vw - 24px);
  max-width: 480px;
  height: 78vh;
  max-height: 640px;
  border-radius: 36px;
}

#music-island:not(.expanded) {
  transition: height 0.7s cubic-bezier(.4,0,.2,1), width 0.7s cubic-bezier(.4,0,.2,1), border-radius 0.7s cubic-bezier(.4,0,.2,1);
}

#music-island-wrapper.expanded-wrap {
  padding-top: 12px;
  padding-bottom: 12px;
  align-items: center;         
}

#music-island-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9989;
  background: rgba(0,0,0,0.25);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 4.0s ease,           /* ← 4.0s, đồng bộ với island */
              backdrop-filter 4.0s ease,
              -webkit-backdrop-filter 4.0s ease;
}

#music-island-backdrop.show {
  opacity: 1;
  pointer-events: auto;
}

    .island-collapsed-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  opacity: 1;
  transition: opacity 0.25s ease;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
    .island-cover {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      object-fit: cover;
      background: rgba(255,255,255,0.1);
      flex-shrink: 0;
    }
    .island-title-mini {
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }
    .island-mini-btn {
      background: none;
      border: none;
      color: #fff;
      font-size: 14px;
      width: 22px;
      height: 22px;
      flex-shrink: 0;
      cursor: pointer;
    }
    .island-expanded-content {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: stretch;
  height: 100%;
  padding: 28px 26px 22px;
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
}
    #music-island.expanded .island-expanded-content {
  opacity: 1;
  transition: opacity 0.4s ease 0.35s;
  pointer-events: auto;
}
    #music-island.expanded .island-collapsed-row {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

    /* Ảnh bìa lớn chiếm phần lớn không gian, giống Control Center */
    .island-cover-big-wrap {
      position: relative;
      width: 100%;
      aspect-ratio: 1 / 1;
      border-radius: 22px;
      overflow: hidden;
      background: rgba(255,255,255,0.06);
      margin-bottom: 22px;
    }
    .island-cover-big {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      background: rgba(255,255,255,0.08);
    }
    .island-cover-fallback {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 60px;
      color: rgba(255,255,255,0.2);
    }

    /* Hàng tên bài (marquee) + icon sóng âm nảy */
    .island-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 4px;
    }
    .island-title-marquee-wrap {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      position: relative;
    }
    .island-title-marquee-track {
      display: inline-block;
      white-space: nowrap;
      font-size: 21px;
      font-weight: 800;
      color: #fff;
    }
    .island-title-marquee-track.scrolling.playing {
      animation-play-state: running;
    }
    .island-title-marquee-track.scrolling {
      animation-play-state: paused;
    }
    @keyframes islandMarquee {
      0%    { transform: translateX(0); opacity: 1; }
      8%    { transform: translateX(0); opacity: 1; }              /* dừng ~1s ở đầu trước khi chạy */
      88%   { transform: translateX(var(--marquee-distance, -100px)); opacity: 1; }
      92%   { transform: translateX(var(--marquee-distance, -100px)); opacity: 1; }
      96%   { transform: translateX(var(--marquee-distance, -100px)); opacity: 0; }  /* mờ dần trước khi nhảy về đầu, che dấu bước nhảy */
      97%   { transform: translateX(0); opacity: 0; }
      100%  { transform: translateX(0); opacity: 1; }
    }

    /* Icon sóng âm nảy liên tục, kiểu equalizer */
    .island-sound-icon {
      display: flex;
      align-items: flex-end;
      gap: 3px;
      height: 18px;
      flex-shrink: 0;
    }
    .island-sound-icon .bar {
      width: 3px;
      background: #fff;
      border-radius: 2px;
      height: 20%;
      transition: height 0.2s ease;
    }
    .island-sound-icon.playing .bar {
      animation: islandSoundBounce 0.9s ease-in-out infinite;
    }
    .island-sound-icon.playing .bar:nth-child(1) { height: 40%; animation-delay: 0s; }
    .island-sound-icon.playing .bar:nth-child(2) { height: 100%; animation-delay: 0.15s; }
    .island-sound-icon.playing .bar:nth-child(3) { height: 65%; animation-delay: 0.3s; }
    .island-sound-icon.playing .bar:nth-child(4) { height: 85%; animation-delay: 0.45s; }
    @keyframes islandSoundBounce {
      0%, 100% { transform: scaleY(0.35); }
      50% { transform: scaleY(1); }
    }

    .island-artist-big {
      font-size: 15px;
      font-weight: 500;
      color: rgba(255,255,255,0.55);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 20px;
    }

    .island-close-btn {
      position: absolute;
      top: 18px;
      right: 18px;
      background: rgba(255,255,255,0.12);
      backdrop-filter: blur(12px) saturate(150%);
      -webkit-backdrop-filter: blur(12px) saturate(150%);
      border: 1px solid rgba(255,255,255,0.2);
      color: rgba(255,255,255,0.8);
      width: 30px;
      height: 30px;
      border-radius: 50%;
      font-size: 13px;
      cursor: pointer;
      flex-shrink: 0;
      z-index: 3;
    }

    .island-seek-row {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      margin-bottom: 8px;
    }
    .island-time {
      font-size: 12.5px;
      color: rgba(255,255,255,0.5);
      width: 38px;
      flex-shrink: 0;
    }
    .island-time.right { text-align: right; }

    .island-controls-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 44px;
      width: 100%;
      margin-bottom: 14px;
    }

    /* Thanh âm lượng giả lập giống ảnh mẫu (loa nhỏ - vạch - loa to) */
    .island-volume-row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      margin-bottom: 18px;
      color: rgba(255,255,255,0.45);
      font-size: 12px;
    }
    .island-volume-track {
      flex: 1;
      height: 4px;
      border-radius: 2px;
      background: rgba(255,255,255,0.15);
      position: relative;
      touch-action: none;
      cursor: pointer;
    }
    .island-volume-fill {
      position: absolute;
      top: 0; left: 0; bottom: 0;
      width: 100%;
      background: #fff;
      border-radius: 2px;
      pointer-events: none;
    }
    .island-volume-thumb {
      position: absolute;
      top: 50%;
      left: 100%;
      transform: translate(-50%, -50%);
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 10px rgba(255,255,255,0.4), 0 0 6px rgba(0,0,0,0.3);
      pointer-events: none;
    }

    .island-footer-label {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      font-size: 13.5px;
      font-weight: 600;
      color: rgba(255,255,255,0.55);
      padding: 12px;
      border-radius: 16px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .island-seek-track {
      flex: 1;
      height: 6px;
      background: rgba(255,255,255,0.15);
      border-radius: 3px;
      position: relative;
      cursor: pointer;
      touch-action: none;
    }
    .island-seek-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: #fff;
  border-radius: 3px;
  width: 0%;
}
    
    .island-seek-thumb {
  position: absolute;
  top: 50%;
  left: 0%;
  transform: translate(-50%, -50%);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 0 14px rgba(255,255,255,0.5), 0 0 8px rgba(0,0,0,0.3);
  pointer-events: none;
  transition: opacity 0.15s ease;
  opacity: 0;
}

.island-seek-track:hover .island-seek-thumb,
.island-seek-track.dragging .island-seek-thumb {
  opacity: 1;
}

#music-island:not(.expanded) .island-seek-thumb {
  opacity: 0 !important;
}

    .island-ctrl-btn {
      background: none;
      border: none;
      color: #fff;
      cursor: pointer;
    }
    .island-ctrl-btn.small { font-size: 28px; }
    .island-ctrl-btn.play-pause {
      font-size: 30px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: rgba(255,255,255,0.15);
      backdrop-filter: blur(14px) saturate(160%);
      -webkit-backdrop-filter: blur(14px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `;
  document.head.appendChild(style);

  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'music-loading-overlay';
  loadingOverlay.id = 'music-loading-overlay';
  loadingOverlay.innerHTML = `
    <div class="music-loading-box">
      <div class="music-loading-spinner"></div>
      <div class="music-loading-title">Đang tải lên</div>
      <div class="music-loading-sub">Vui lòng chờ trong giây lát...</div>
    </div>
  `;
  document.body.appendChild(loadingOverlay);

  const islandWrapper = document.createElement('div');
  islandWrapper.id = 'music-island-wrapper';

  const island = document.createElement('div');
  island.id = 'music-island';
  island.innerHTML = `
    <div class="island-collapsed-row" id="island-collapsed-row">
      <img class="island-cover" id="island-cover-mini" src="" alt="">
      <div class="island-title-mini" id="island-title-mini">—</div>
      <button class="island-mini-btn" id="island-mini-playpause"><i class="fa-solid fa-pause"></i></button>
    </div>
    <div class="island-expanded-content">
      <button class="island-close-btn" id="island-close-btn"><i class="fa-solid fa-chevron-down"></i></button>

      <div class="island-cover-big-wrap">
        <img class="island-cover-big" id="island-cover-big" src="" alt="" style="display:none">
        <div class="island-cover-fallback" id="island-cover-fallback"><i class="fa-solid fa-compact-disc"></i></div>
      </div>

      <div class="island-title-row">
        <div class="island-title-marquee-wrap">
          <div class="island-title-marquee-track" id="island-title-marquee">—</div>
        </div>
        <div class="island-sound-icon">
          <div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div>
        </div>
      </div>
      <div class="island-artist-big" id="island-artist-big">—</div>

      <div class="island-seek-row">
        <span class="island-time" id="island-time-current">0:00</span>
        <div class="island-seek-track" id="island-seek-track">
          <div class="island-seek-fill" id="island-seek-fill"></div>
          <div class="island-seek-thumb" id="island-seek-thumb"></div>
        </div>
        <span class="island-time right" id="island-time-total">0:00</span>
      </div>

      <div class="island-controls-row">
        <button class="island-ctrl-btn small" id="island-prev-btn"><i class="fa-solid fa-backward-step"></i></button>
        <button class="island-ctrl-btn play-pause" id="island-playpause-btn"><i class="fa-solid fa-pause"></i></button>
        <button class="island-ctrl-btn small" id="island-next-btn"><i class="fa-solid fa-forward-step"></i></button>
      </div>

      <div class="island-volume-row">
        <i class="fa-solid fa-volume-low"></i>
        <div class="island-volume-track" id="island-volume-track">
          <div class="island-volume-fill" id="island-volume-fill"></div>
          <div class="island-volume-thumb" id="island-volume-thumb"></div>
        </div>
        <i class="fa-solid fa-volume-high"></i>
      </div>

      <div class="island-footer-label">
        <i class="fa-solid fa-music"></i> AIChater Music Player
      </div>
    </div>
  `;
  islandWrapper.appendChild(island);
  document.body.appendChild(islandWrapper);

  const backdrop = document.createElement('div');
  backdrop.id = 'music-island-backdrop';
  document.body.appendChild(backdrop);

  initSeekDrag();
  initVolumeDrag();

  island.addEventListener('click', (e) => {
  if (island.classList.contains('expanded')) return;
  if (e.target.closest('.island-mini-btn')) return;
  expandIsland();
});

  document.getElementById('island-close-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    collapseIsland();
  });

  backdrop.addEventListener('click', () => collapseIsland());

  // ===== STATE FLAGS =====
let isCollapsing = false;
let isExpanding = false;

// ===== Expand / Collapse =====
function expandIsland() {
  if (island.classList.contains('expanded') || isExpanding) return;
  isExpanding = true;
  
  // Tính toán vị trí giữa màn hình
  const viewportHeight = window.innerHeight;
  const islandMaxHeight = Math.min(viewportHeight * 0.78, 640);
  const targetTop = (viewportHeight - islandMaxHeight) / 2;
  
  // Set CSS variable thay vì inline style
  island.style.setProperty('--expanded-top', `${targetTop}px`);
  
  islandWrapper.classList.add('expanded-wrap');
  backdrop.classList.add('show');
  
  requestAnimationFrame(() => {
    island.classList.add('expanded');
    setTimeout(() => { isExpanding = false; }, 4000);
  });
}

function collapseIsland() {
  if (!island.classList.contains('expanded') || isCollapsing) return;
  isCollapsing = true;
  
  island.classList.remove('expanded');
  
  // Backdrop fade out cùng lúc với island
  backdrop.classList.remove('show');
  
  setTimeout(() => {
    islandWrapper.classList.remove('expanded-wrap');
    isCollapsing = false;
  }, 4000);
}

function handleOutsideTap(e) {
  if (!island.classList.contains('expanded')) return;
  if (island.contains(e.target)) return;
  if (e.target === backdrop) return;
  if (isCollapsing) return; // ← Thêm check
  collapseIsland();
}

// CHỈ dùng click, không dùng touchstart
document.addEventListener('click', handleOutsideTap);

// Backdrop click
backdrop.addEventListener('click', () => collapseIsland());

  // ===== Vuốt trái/phải trên Dynamic Island để đóng hẳn + dừng nhạc =====
  const SWIPE_DISMISS_THRESHOLD = 60;
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeCurrentX = 0;
  let isSwiping = false;
  let swipeIgnored = false;

  function isInteractiveTarget(target) {
    return !!target.closest('.island-seek-track, .island-mini-btn, .island-ctrl-btn, .island-close-btn');
  }

  function getSwipeClientX(e) {
    if (e.touches && e.touches.length > 0) return e.touches[0].clientX;
    if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientX;
    return e.clientX;
  }
  function getSwipeClientY(e) {
    if (e.touches && e.touches.length > 0) return e.touches[0].clientY;
    if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientY;
    return e.clientY;
  }

  function onSwipeStart(e) {
    if (isInteractiveTarget(e.target)) {
      swipeIgnored = true;
      return;
    }
    swipeIgnored = false;
    isSwiping = true;
    swipeStartX = getSwipeClientX(e);
    swipeStartY = getSwipeClientY(e);
    swipeCurrentX = swipeStartX;
    islandWrapper.style.transition = 'none';
  }

  function onSwipeMove(e) {
  if (!isSwiping || swipeIgnored) return;
  swipeCurrentX = getSwipeClientX(e);
  const deltaX = swipeCurrentX - swipeStartX;
  const deltaY = getSwipeClientY(e) - swipeStartY;

  if (Math.abs(deltaY) > Math.abs(deltaX) * 1.2) return;
  if (e.cancelable) e.preventDefault();
  islandWrapper.style.left = `${deltaX}px`;
  islandWrapper.style.opacity = String(Math.max(0.2, 1 - Math.abs(deltaX) / 250));
}

  async function onSwipeEnd() {
  if (!isSwiping || swipeIgnored) {
    isSwiping = false;
    swipeIgnored = false;
    return;
  }
  isSwiping = false;
  const deltaX = swipeCurrentX - swipeStartX;
  islandWrapper.style.transition = 'left 0.3s ease, opacity 0.3s ease';

  if (Math.abs(deltaX) > SWIPE_DISMISS_THRESHOLD) {
    const flyDistance = deltaX > 0 ? window.innerWidth : -window.innerWidth;
    islandWrapper.style.left = `${flyDistance}px`;
    islandWrapper.style.opacity = '0';
    setTimeout(async () => {
  await musicStopAll();
  const wrapper = document.getElementById('music-island-wrapper');
  const backdrop = document.getElementById('music-island-backdrop');
  console.log('WRAPPER - display:', getComputedStyle(wrapper).display, '| opacity:', getComputedStyle(wrapper).opacity, '| pointer-events:', getComputedStyle(wrapper).pointerEvents);
  console.log('BACKDROP - display:', getComputedStyle(backdrop).display, '| opacity:', getComputedStyle(backdrop).opacity, '| pointer-events:', getComputedStyle(backdrop).pointerEvents, '| class:', backdrop.className);
  islandWrapper.style.transition = '';
  islandWrapper.style.left = '';
  islandWrapper.style.opacity = '';
}, 300);
  } else {
    // Vuốt chưa đủ xa -> bật lại vị trí cũ
    islandWrapper.style.left = '';
    islandWrapper.style.opacity = '1';
  }
}

  islandWrapper.addEventListener('touchstart', onSwipeStart, { passive: true });
  islandWrapper.addEventListener('touchmove', onSwipeMove, { passive: false });
  islandWrapper.addEventListener('touchend', onSwipeEnd);
  islandWrapper.addEventListener('touchcancel', onSwipeEnd);

  islandWrapper.addEventListener('mousedown', onSwipeStart);
  document.addEventListener('mousemove', onSwipeMove);
  document.addEventListener('mouseup', onSwipeEnd);


  document.getElementById('island-mini-playpause').addEventListener('click', async (e) => {
    e.stopPropagation();
    await islandTogglePlayPause();
  });
  document.getElementById('island-playpause-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    await islandTogglePlayPause();
  });
  document.getElementById('island-prev-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    await playPrev();
  });
  document.getElementById('island-next-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    await playNext();
  });
  document.getElementById('island-seek-track').addEventListener('click', (e) => {
    e.stopPropagation();
    // Seek tuyệt đối chỉ khả dụng ở chế độ web fallback (giả lập UI cho native)
    if (!isNativePlatform && currentAudio && currentAudio.duration) {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      currentAudio.currentTime = ratio * currentAudio.duration;
    }
  });

  const overlay = document.createElement('div');
  overlay.id = 'music-popup-overlay';
  overlay.innerHTML = `
    <div class="music-popup-box">
      <div class="music-popup-header">
        <div class="music-popup-logo-icon"><i class="fa-solid fa-music"></i></div>
        <div class="music-popup-title">Music</div>
        <button class="music-popup-close" id="music-popup-close-btn">✕</button>
      </div>
      <div class="music-popup-list" id="music-popup-list"></div>
      <div class="music-popup-footer" id="music-popup-footer">
        <button class="music-add-btn" id="music-add-btn">+ Thêm nhạc</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('music-popup-close-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeMusicPopup();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      e.preventDefault();
      closeMusicPopup();
    }
  });
  document.getElementById('music-add-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    renderMusicAddForm();
  });
}

function renderMusicList(list) {
  const listEl = document.getElementById('music-popup-list');
  const footerEl = document.getElementById('music-popup-footer');

  footerEl.innerHTML = `<button class="music-add-btn" id="music-add-btn">+ Thêm nhạc</button>`;
  document.getElementById('music-add-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    renderMusicAddForm();
  });

  if (!list.length) {
    listEl.innerHTML = `
      <div class="music-empty">
        <div class="music-empty-icon"><i class="fa-solid fa-compact-disc"></i></div>
        <div class="music-empty-title">Chưa có nhạc nào</div>
        <div class="music-empty-sub">Thêm bài hát đầu tiên để mọi người cùng nghe khi chat.</div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = list.map(item => {
    const canEdit = item.uploaderId === currentUserUid || currentUserUid === ADMIN_UID;
    return `
    <div class="music-item" data-id="${item.id}" data-url="${item.audioUrl}">
      <img class="music-cover" src="${item.coverUrl || ''}" onerror="this.style.visibility='hidden'" alt="">
      <div class="music-item-info">
        <div class="music-item-title">${item.title}</div>
        <div class="music-item-sub">${item.artist || 'Không rõ nghệ sĩ'}</div>
      </div>
      ${item.platform ? `<span class="music-platform-badge">${item.platform}</span>` : ''}
      ${canEdit ? `<button class="music-edit-btn" data-id="${item.id}"><i class="fa-solid fa-pen"></i></button>` : ''}
      <i class="fa-solid fa-play music-play-icon"></i>
    </div>
  `;
  }).join('');

  listEl.querySelectorAll('.music-item').forEach((el, index) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMusicPlay(el, list[index], list);
    });
    // Khôi phục trạng thái "đang phát" nếu bài này vẫn đang chạy nền từ trước
    if (el.dataset.id === currentPlayingId) {
      el.classList.add('playing');
      el.querySelector('.music-play-icon').className = 'fa-solid fa-pause music-play-icon';
    }
  });
  listEl.querySelectorAll('.music-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = list.find(m => m.id === btn.dataset.id);
      if (item) renderMusicEditForm(item);
    });
  });
}

async function toggleMusicPlay(el, item, list) {
  const id = el.dataset.id;

  // Đang phát đúng bài này -> bấm lại để pause/resume
  if (currentPlayingId === id) {
    const playing = await isCurrentlyPlaying();
    if (playing) {
      await pauseCurrentAudio();
      updateItemUI(id, false);
      updateIslandPlayState(false);
    } else {
      await resumeCurrentAudio();
      updateItemUI(id, true);
      updateIslandPlayState(true);
    }
    return;
  }

  currentPlaylist = list || [item];
  currentIndex = currentPlaylist.findIndex(t => t.id === id);
  await playTrackByIndex(currentIndex);
}

async function playTrackByIndex(index) {
  if (index < 0 || index >= currentPlaylist.length) return;
  const item = currentPlaylist[index];
  currentIndex = index;

  document.querySelectorAll('.music-item').forEach(itemEl => updateItemUIEl(itemEl, itemEl.dataset.id === item.id));

  await stopCurrentAudio();

  if (isNativePlatform && AudioPlayer) {
    try {
      await AudioPlayer.create({
        audioId: NATIVE_AUDIO_ID,
        audioSource: item.audioUrl,
        friendlyTitle: item.title,
        artistName: item.artist || 'AIChater',
        albumTitle: 'Thư viện nhạc AIChater',
        artworkSource: item.coverUrl || '',
        useForNotification: true,
        isBackgroundMusic: false,
        loop: false,
        showSeekForward: true,
        showSeekBackward: true
      });
      await AudioPlayer.initialize({ audioId: NATIVE_AUDIO_ID });
      await AudioPlayer.play({ audioId: NATIVE_AUDIO_ID });
      nativeAudioInitialized = true;
      await applyVolume(currentVolume);

      AudioPlayer.onAudioEnd({ audioId: NATIVE_AUDIO_ID }, () => {
        playNext();
      });
    } catch (e) {
      console.error('Lỗi phát nhạc native:', e);
      notification.error({ title: 'AIChater', message: 'Không phát được bài này.', duration: 3000, theme: 'dark' });
      return;
    }
  } else {
    currentAudio = new Audio(item.audioUrl);
    currentAudio.volume = currentVolume;
    currentAudio.play();
    currentAudio.addEventListener('ended', () => playNext());
  }

  currentPlayingId = item.id;
  renderMusicIsland(item);
  updateIslandPlayState(true);
}

async function playNext() {
  if (currentIndex < currentPlaylist.length - 1) {
    await playTrackByIndex(currentIndex + 1);
  } else {
    await playTrackByIndex(0); // quay lại bài đầu playlist
  }
}

async function playPrev() {
  if (currentIndex > 0) {
    await playTrackByIndex(currentIndex - 1);
  } else {
    await playTrackByIndex(currentPlaylist.length - 1);
  }
}

async function isCurrentlyPlaying() {
  if (isNativePlatform && AudioPlayer && nativeAudioInitialized) {
    try {
      const res = await AudioPlayer.isPlaying({ audioId: NATIVE_AUDIO_ID });
      return !!(res && res.isPlaying);
    } catch (e) { return false; }
  }
  return !!(currentAudio && !currentAudio.paused);
}

async function resumeCurrentAudio() {
  if (isNativePlatform && AudioPlayer && nativeAudioInitialized) {
    try { await AudioPlayer.play({ audioId: NATIVE_AUDIO_ID }); } catch (e) {}
  } else if (currentAudio) {
    currentAudio.play();
  }
}

async function seekBy(seconds) {
  if (isNativePlatform && AudioPlayer && nativeAudioInitialized) {
    try {
      // Plugin native cần seek tuyệt đối; nếu cần seek tương đối, bỏ qua an toàn cho bản giả lập
    } catch (e) {}
  } else if (currentAudio) {
    currentAudio.currentTime = Math.max(0, currentAudio.currentTime + seconds);
  }
}

function updateItemUIEl(el, isPlaying) {
  el.classList.toggle('playing', isPlaying);
  const ic = el.querySelector('.music-play-icon');
  if (ic) ic.className = isPlaying ? 'fa-solid fa-pause music-play-icon' : 'fa-solid fa-play music-play-icon';
}

function updateItemUI(id, isPlaying) {
  document.querySelectorAll('.music-item').forEach(el => {
    if (el.dataset.id === id) updateItemUIEl(el, isPlaying);
  });
}

// ===== Dynamic Island (giả lập) =====
let marqueeCheckTimeout = null;

function renderMusicIsland(item) {
  const island = document.getElementById('music-island');
  if (!island) return;

  document.getElementById('island-title-mini').textContent = item.title;

  // Ảnh bìa lớn: hiện ảnh nếu có, fallback icon đĩa nhạc nếu không
  const coverBig = document.getElementById('island-cover-big');
  const coverFallback = document.getElementById('island-cover-fallback');
  const coverMini = document.getElementById('island-cover-mini');

  if (item.coverUrl) {
    coverBig.src = item.coverUrl;
    coverBig.style.display = 'block';
    coverFallback.style.display = 'none';
    coverMini.src = item.coverUrl;
    coverMini.style.visibility = 'visible';
    coverBig.onerror = () => {
      coverBig.style.display = 'none';
      coverFallback.style.display = 'flex';
    };
  } else {
    coverBig.style.display = 'none';
    coverFallback.style.display = 'flex';
    coverMini.style.visibility = 'hidden';
  }

  document.getElementById('island-artist-big').textContent = item.artist || 'Không rõ nghệ sĩ';

  setupMarqueeTitle(item.title);

  const wrapper = document.getElementById('music-island-wrapper');
  if (wrapper) wrapper.classList.add('show');

  if (islandUpdateInterval) clearInterval(islandUpdateInterval);
  islandUpdateInterval = setInterval(updateIslandProgress, 500);
}

// Chạy chữ vòng lặp nếu tên bài dài hơn khung hiển thị; nếu vừa khung thì đứng yên
function setupMarqueeTitle(title) {
  const track = document.getElementById('island-title-marquee');
  const wrap = track ? track.closest('.island-title-marquee-wrap') : null;
  if (!track || !wrap) return;

  track.textContent = title;
  track.classList.remove('scrolling');
  track.style.animation = 'none';
  track.style.transform = 'translateX(0)';
  track.style.opacity = '1';

  if (marqueeCheckTimeout) clearTimeout(marqueeCheckTimeout);

  // Đợi 1 nhịp để layout ổn định rồi mới đo (đảm bảo scrollWidth chính xác, đặc biệt khi đang mở animation)
  marqueeCheckTimeout = setTimeout(() => {
    const overflow = track.scrollWidth - wrap.clientWidth;
    if (overflow > 4) {
      const distance = -(overflow + 24); // chừa khoảng đệm để không dính sát mép khi chạy hết
      track.style.setProperty('--marquee-distance', `${distance}px`);
      // Thời lượng animation tỉ lệ theo độ dài chữ
      const durationSec = Math.max(7, Math.abs(overflow) / 26 + 3);
      track.style.animation = `islandMarquee ${durationSec}s ease-in-out infinite`;
      track.classList.add('scrolling');
      // Đồng bộ trạng thái chạy/dừng theo play state hiện tại (nhạc đang play mới cho chạy)
      isCurrentlyPlaying().then(playing => {
        track.classList.toggle('playing', playing);
      });
    }
  }, 300);
}

function updateIslandPlayState(isPlaying) {
  const icons = document.querySelectorAll('#island-mini-playpause i, #island-playpause-btn i');
  icons.forEach(ic => {
    ic.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
  });

  const soundIcon = document.querySelector('.island-sound-icon');
  if (soundIcon) soundIcon.classList.toggle('playing', isPlaying);

  const marqueeTrack = document.getElementById('island-title-marquee');
  if (marqueeTrack) marqueeTrack.classList.toggle('playing', isPlaying);
}

async function islandTogglePlayPause() {
  if (!currentPlayingId) return;
  const playing = await isCurrentlyPlaying();
  if (playing) {
    await pauseCurrentAudio();
    updateItemUI(currentPlayingId, false);
    updateIslandPlayState(false);
  } else {
    await resumeCurrentAudio();
    updateItemUI(currentPlayingId, true);
    updateIslandPlayState(true);
  }
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function updateIslandProgress() {
  const fill = document.getElementById('island-seek-fill');
  const thumb = document.getElementById('island-seek-thumb');
  const curEl = document.getElementById('island-time-current');
  const totEl = document.getElementById('island-time-total');
  
  if (!fill || !curEl || !totEl) return;

  // Nếu đang kéo thả, KHÔNG cập nhật để tránh giật
  if (isDraggingSeek) return;

  // --- WEB FALLBACK (dùng <audio>) ---
  if (!isNativePlatform && currentAudio) {
    const duration = currentAudio.duration || 0;
    const currentTime = currentAudio.currentTime || 0;
    const ratio = duration > 0 ? (currentTime / duration) : 0;
    const clamped = Math.max(0, Math.min(1, ratio));
    
    // Cập nhật thanh tiến trình
    fill.style.width = (clamped * 100) + '%';
    
    // Cập nhật dấu chấm trắng
    if (thumb) {
      thumb.style.left = (clamped * 100) + '%';
    }
    
    // Cập nhật thời gian hiển thị
    curEl.textContent = formatTime(currentTime);
    totEl.textContent = formatTime(duration);
  }
}

function hideMusicIsland() {
  const island = document.getElementById('music-island');
  const wrapper = document.getElementById('music-island-wrapper');
  const backdrop = document.getElementById('music-island-backdrop');
  if (island) island.classList.remove('expanded');
  if (wrapper) { wrapper.classList.remove('show'); wrapper.classList.remove('expanded-wrap'); }
  if (backdrop) backdrop.classList.remove('show');
  if (islandUpdateInterval) {
    clearInterval(islandUpdateInterval);
    islandUpdateInterval = null;
  }
  if (marqueeCheckTimeout) {
    clearTimeout(marqueeCheckTimeout);
    marqueeCheckTimeout = null;
  }
}

async function pauseCurrentAudio() {
  if (isNativePlatform && AudioPlayer && nativeAudioInitialized) {
    try { await AudioPlayer.pause({ audioId: NATIVE_AUDIO_ID }); } catch (e) {}
  } else if (currentAudio) {
    currentAudio.pause();
  }
}

async function stopCurrentAudio() {
  if (isNativePlatform && AudioPlayer && nativeAudioInitialized) {
    try {
      await AudioPlayer.stop({ audioId: NATIVE_AUDIO_ID });
      await AudioPlayer.destroy({ audioId: NATIVE_AUDIO_ID });
    } catch (e) {}
    nativeAudioInitialized = false;
  } else if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

// Dừng nhạc hoàn toàn (vd người dùng chủ động bấm "Dừng phát" hoặc thoát app)
async function musicStopAll() {
  await stopCurrentAudio();
  currentPlayingId = null;
  document.querySelectorAll('.music-item').forEach(itemEl => {
    itemEl.classList.remove('playing');
    const ic = itemEl.querySelector('.music-play-icon');
    if (ic) ic.className = 'fa-solid fa-play music-play-icon';
  });
  hideMusicIsland();
}

function renderMusicAddForm() {
  const listEl = document.getElementById('music-popup-list');
  const footerEl = document.getElementById('music-popup-footer');
  footerEl.innerHTML = '';

  listEl.innerHTML = `
    <button class="music-back-link" id="music-back-to-list">← Quay lại danh sách</button>
    <div class="music-disclaimer">Chỉ tải lên nhạc bạn có quyền chia sẻ (nhạc tự sáng tác, nhạc miễn phí bản quyền). Không tải nhạc vi phạm bản quyền.</div>

    <div class="music-form-field">
      <label class="music-form-label">Tên bài hát *</label>
      <input type="text" class="music-form-input" id="music-title-input" placeholder="VD: Có chắc yêu là đây">
    </div>
    <div class="music-form-field">
      <label class="music-form-label">Nghệ sĩ / Ca sĩ</label>
      <input type="text" class="music-form-input" id="music-artist-input" placeholder="VD: Sơn Tùng M-TP">
    </div>
    <div class="music-form-field">
      <label class="music-form-label">Nền tảng nguồn</label>
      <div class="music-dropdown" id="music-platform-dropdown">
        <button type="button" class="music-dropdown-trigger" id="music-platform-trigger">
          <span class="placeholder" id="music-platform-label">-- Chọn nền tảng --</span>
          <i class="fa-solid fa-chevron-down"></i>
        </button>
        <div class="music-dropdown-menu">
          <div class="music-dropdown-item" data-value="">-- Chọn nền tảng --</div>
          <div class="music-dropdown-item" data-value="YouTube">YouTube</div>
          <div class="music-dropdown-item" data-value="TikTok">TikTok</div>
          <div class="music-dropdown-item" data-value="SoundCloud">SoundCloud</div>
          <div class="music-dropdown-item" data-value="Spotify">Spotify</div>
          <div class="music-dropdown-item" data-value="Tự sáng tác">Tự sáng tác</div>
          <div class="music-dropdown-item" data-value="Khác">Khác</div>
        </div>
      </div>
    </div>
    <div class="music-form-field">
      <label class="music-form-label">Ảnh bìa (tùy chọn)</label>
      <button class="music-file-btn" id="music-cover-btn">Chọn ảnh bìa...</button>
      <input type="file" id="music-cover-file" accept="image/*" style="display:none">
    </div>
    <div class="music-form-field">
      <label class="music-form-label">File nhạc *</label>
      <button class="music-file-btn" id="music-audio-btn">Chọn file nhạc (mp3, m4a...)</button>
      <input type="file" id="music-audio-file" accept="audio/*" style="display:none">
    </div>

    <button class="music-submit-btn" id="music-submit-btn">Tải lên</button>
  `;

  document.getElementById('music-back-to-list').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    reloadAndRenderMusicList();
  });

  // Custom dropdown logic
  let selectedPlatform = '';
  const dropdown = document.getElementById('music-platform-dropdown');
  const trigger = document.getElementById('music-platform-trigger');
  const platformLabel = document.getElementById('music-platform-label');

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  dropdown.querySelectorAll('.music-dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectedPlatform = item.dataset.value;
      platformLabel.textContent = selectedPlatform || '-- Chọn nền tảng --';
      platformLabel.classList.toggle('placeholder', !selectedPlatform);
      dropdown.querySelectorAll('.music-dropdown-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      dropdown.classList.remove('open');
    });
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
  });

  const coverBtn = document.getElementById('music-cover-btn');
  const coverFileInput = document.getElementById('music-cover-file');
  coverBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    coverFileInput.click();
  });
  coverFileInput.addEventListener('change', () => {
    if (coverFileInput.files[0]) {
      coverBtn.textContent = coverFileInput.files[0].name;
      coverBtn.classList.add('has-file');
    }
  });

  const audioBtn = document.getElementById('music-audio-btn');
  const audioFileInput = document.getElementById('music-audio-file');
  audioBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    audioFileInput.click();
  });
  audioFileInput.addEventListener('change', () => {
    if (audioFileInput.files[0]) {
      audioBtn.textContent = audioFileInput.files[0].name;
      audioBtn.classList.add('has-file');
    }
  });

  document.getElementById('music-submit-btn').addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const title = document.getElementById('music-title-input').value.trim();
    const artist = document.getElementById('music-artist-input').value.trim();
    const platform = selectedPlatform;
    const coverFile = coverFileInput.files[0];
    const audioFile = audioFileInput.files[0];
    const submitBtn = document.getElementById('music-submit-btn');

    if (!title) { showMusicNotification('warning', 'Nhập tên bài hát!'); return; }
    if (!audioFile) { showMusicNotification('warning', 'Chọn file nhạc!'); return; }

    submitBtn.disabled = true;
    showMusicLoading(true);

    try {
      const audioUrl = await uploadToCloudinary(audioFile);
      let coverUrl = '';
      if (coverFile) {
        coverUrl = await uploadToCloudinary(coverFile);
      }
      await saveMusicEntry({ title, artist, platform, coverUrl, audioUrl });
      showMusicLoading(false);
      showMusicNotification('success', 'Đã tải nhạc lên thành công!');
      reloadAndRenderMusicList();
    } catch (err) {
      showMusicLoading(false);
      showMusicNotification('error', 'Lỗi khi tải lên: ' + err.message);
      submitBtn.disabled = false;
    }
  });
}

function showMusicLoading(show) {
  const overlay = document.getElementById('music-loading-overlay');
  if (!overlay) return;
  overlay.classList.toggle('show', show);
}

function showMusicNotification(type, message) {
  if (notification && typeof notification[type] === 'function') {
    notification[type]({ title: 'AIChater', message, duration: 3000, theme: 'dark' });
  } else {
    alert(message);
  }
}

async function reloadAndRenderMusicList() {
  const listEl = document.getElementById('music-popup-list');
  listEl.innerHTML = `<div class="music-empty"><div class="music-empty-icon"><i class="fa-solid fa-spinner fa-spin"></i></div></div>`;
  const list = await fetchMusicList();
  renderMusicList(list);
}

async function openMusicPopup() {
  ensureMusicPopupInDOM();
  document.getElementById('music-popup-overlay').classList.add('show');
  await reloadAndRenderMusicList();
}

function closeMusicPopup() {
  const overlay = document.getElementById('music-popup-overlay');
  if (overlay) overlay.classList.remove('show');
  // Không dừng nhạc khi đóng popup - nhạc tiếp tục phát nền
}

// ── SEEK: KÉO THẢ DẤU CHẤM ──────────────────────────
let isDraggingSeek = false;

// ===== ĐIỀU KHIỂN ÂM LƯỢNG (kéo thả) =====
const VOLUME_STORAGE_KEY = 'aichater_music_volume';
let currentVolume = parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY) || '0.7');

async function applyVolume(vol) {
  currentVolume = Math.max(0, Math.min(1, vol));
  localStorage.setItem(VOLUME_STORAGE_KEY, String(currentVolume));

  if (isNativePlatform && AudioPlayer && nativeAudioInitialized) {
    try { await AudioPlayer.setVolume({ audioId: NATIVE_AUDIO_ID, volume: currentVolume }); } catch (e) {}
  } else if (currentAudio) {
    currentAudio.volume = currentVolume;
  }

  const fill = document.getElementById('island-volume-fill');
  const thumb = document.getElementById('island-volume-thumb');
  if (fill) fill.style.width = (currentVolume * 100) + '%';
  if (thumb) thumb.style.left = (currentVolume * 100) + '%';
}

function initVolumeDrag() {
  const track = document.getElementById('island-volume-track');
  if (!track) return;

  // Áp dụng volume đã lưu ngay khi khởi tạo UI
  const fill = document.getElementById('island-volume-fill');
  const thumb = document.getElementById('island-volume-thumb');
  if (fill) fill.style.width = (currentVolume * 100) + '%';
  if (thumb) thumb.style.left = (currentVolume * 100) + '%';

  function getRatio(clientX) {
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }
  function getClientX(e) {
    if (e.touches && e.touches.length > 0) return e.touches[0].clientX;
    if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientX;
    return e.clientX;
  }

  function startDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    applyVolume(getRatio(getClientX(e)));

    function onMove(ev) { applyVolume(getRatio(getClientX(ev))); }
    function onEnd() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }

  track.addEventListener('mousedown', startDrag);
  track.addEventListener('touchstart', startDrag, { passive: false });
}

function initSeekDrag() {
  const track = document.getElementById('island-seek-track');
  const thumb = document.getElementById('island-seek-thumb');
  if (!track || !thumb) return;

  // Cập nhật vị trí dấu chấm theo % (chỉ UI, không seek thực)
  function updateThumbPosition(ratio) {
    const clamped = Math.max(0, Math.min(1, ratio));
    thumb.style.left = (clamped * 100) + '%';
    document.getElementById('island-seek-fill').style.width = (clamped * 100) + '%';
  }

  // Lấy vị trí click / drag → ratio
  function getSeekRatio(clientX) {
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  // Lấy toạ độ X từ cả mouse event lẫn touch event
  function getClientX(e) {
    if (e.touches && e.touches.length > 0) return e.touches[0].clientX;
    if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientX;
    return e.clientX;
  }

  function startDrag(e) {
    e.preventDefault();
    e.stopPropagation();

    // Chỉ kéo được khi đã mở rộng và có audio đang phát
    const island = document.getElementById('music-island');
    if (!island || !island.classList.contains('expanded')) return;
    if (!currentAudio && !isNativePlatform) return;

    isDraggingSeek = true;
    track.classList.add('dragging');

    const ratio = getSeekRatio(getClientX(e));
    updateThumbPosition(ratio);

    if (!isNativePlatform && currentAudio && currentAudio.duration) {
      currentAudio.currentTime = ratio * currentAudio.duration;
    }

    function onMove(ev) {
      const r = getSeekRatio(getClientX(ev));
      updateThumbPosition(r);
      if (!isNativePlatform && currentAudio && currentAudio.duration) {
        currentAudio.currentTime = r * currentAudio.duration;
      }
    }

    function onEnd() {
      isDraggingSeek = false;
      track.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }

  // Bấm chuột xuống trên track → bắt đầu kéo
  track.addEventListener('mousedown', startDrag);
  // Chạm ngón tay xuống track → bắt đầu kéo (mobile)
  track.addEventListener('touchstart', startDrag, { passive: false });

  // Cho phép bắt đầu kéo trực tiếp từ chính dấu chấm (thumb) luôn, không chỉ track
  if (thumb) {
    thumb.addEventListener('mousedown', startDrag);
    thumb.addEventListener('touchstart', startDrag, { passive: false });
  }

  // Click vào track (không kéo) → tua
  track.addEventListener('click', (e) => {
    if (isDraggingSeek) return;
    const island = document.getElementById('music-island');
    if (!island || !island.classList.contains('expanded')) return;
    if (!currentAudio && !isNativePlatform) return;

    const ratio = getSeekRatio(e.clientX);
    updateThumbPosition(ratio);

    if (!isNativePlatform && currentAudio && currentAudio.duration) {
      currentAudio.currentTime = ratio * currentAudio.duration;
    }
  });

  // Cập nhật vị trí dấu chấm khi tiến trình thay đổi
  // (gọi từ updateIslandProgress)
  window._updateSeekThumb = function(ratio) {
    if (isDraggingSeek) return; // Không override khi đang kéo
    const thumb = document.getElementById('island-seek-thumb');
    const fill = document.getElementById('island-seek-fill');
    if (thumb) thumb.style.left = (ratio * 100) + '%';
    if (fill) fill.style.width = (ratio * 100) + '%';
  };
}

export { musicInit, openMusicPopup, closeMusicPopup, musicStopAll };
