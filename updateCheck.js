// updateCheck.js - Kiểm tra phiên bản app, ép người dùng cập nhật khi có bản mới

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

let CapacitorApp = null;
try {
  const appModule = await import('@capacitor/app');
  CapacitorApp = appModule.App;
} catch (e) {
  // Chạy trên web thuần (không phải app Capacitor) -> không có App plugin, dùng fallback
}

const LOCAL_VERSION_KEY = 'aichater_app_version';
const PENDING_UPDATE_KEY = 'aichater_pending_update'; // đặt trước khi thoát app để hiện popup "đang cập nhật" lúc mở lại

function ensureUpdateOverlaysInDOM() {
  if (document.getElementById('update-required-overlay')) return;

  const style = document.createElement('style');
  style.textContent = `
    #update-required-overlay, #update-progress-overlay {
      position: fixed;
      inset: 0;
      z-index: 999999;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.55);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      font-family: 'Inter', -apple-system, sans-serif;
    }
    #update-required-overlay.show, #update-progress-overlay.show {
      display: flex;
      animation: updFadeIn 0.3s ease both;
    }
    @keyframes updFadeIn { from { opacity: 0; } to { opacity: 1; } }

    .upd-card {
      position: relative;
      overflow: hidden;
      width: min(88vw, 340px);
      padding: 30px 24px 26px;
      border-radius: 24px;
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(26px) saturate(160%);
      -webkit-backdrop-filter: blur(26px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.25);
      box-shadow: 0 16px 48px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.3);
      color: #fff;
      text-align: center;
      animation: updSlideUp 0.4s cubic-bezier(.19,1,.22,1) both;
    }
    @keyframes updSlideUp {
      0% { opacity: 0; transform: translateY(20px) scale(0.95); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    .upd-card::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(115deg, transparent 20%, rgba(255,255,255,0.18) 32%, transparent 44%);
      background-size: 250% 250%;
      animation: updSheen 3s linear infinite;
      pointer-events: none;
    }
    @keyframes updSheen {
      0% { background-position: 150% 0%; }
      100% { background-position: -50% 0%; }
    }

    .upd-icon {
      width: 62px;
      height: 62px;
      border-radius: 18px;
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      margin: 0 auto 16px;
      color: #ff5c8a;
    }
    .upd-title {
      font-size: 18px;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .upd-desc {
      font-size: 13.5px;
      line-height: 1.6;
      color: rgba(255,255,255,0.65);
      margin-bottom: 22px;
    }
    .upd-btn {
      position: relative;
      overflow: hidden;
      width: 100%;
      height: 48px;
      border: none;
      border-radius: 14px;
      background: rgba(255,255,255,0.14);
      backdrop-filter: blur(14px);
      border: 1px solid rgba(255,255,255,0.25);
      color: #fff;
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }

    .upd-progress-title {
      font-size: 16px;
      font-weight: 800;
      margin-bottom: 16px;
    }
    .upd-progress-track {
      width: 100%;
      height: 8px;
      border-radius: 4px;
      background: rgba(255,255,255,0.15);
      overflow: hidden;
      margin-bottom: 10px;
    }
    .upd-progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #ff5c8a, #ff9ebd);
      border-radius: 4px;
      transition: width 0.2s ease;
    }
    .upd-progress-pct {
      font-size: 13px;
      color: rgba(255,255,255,0.6);
    }
  `;
  document.head.appendChild(style);

  const requiredOverlay = document.createElement('div');
  requiredOverlay.id = 'update-required-overlay';
  requiredOverlay.innerHTML = `
    <div class="upd-card">
      <div class="upd-icon"><i class="fa-solid fa-rotate"></i></div>
      <div class="upd-title">Có bản cập nhật mới</div>
      <div class="upd-desc">AIChater vừa có phiên bản mới. Thoát ứng dụng để cập nhật và tiếp tục sử dụng nhé.</div>
      <button class="upd-btn" id="update-required-exit-btn">Thoát để cập nhật</button>
    </div>
  `;
  document.body.appendChild(requiredOverlay);

  const progressOverlay = document.createElement('div');
  progressOverlay.id = 'update-progress-overlay';
  progressOverlay.innerHTML = `
    <div class="upd-card">
      <div class="upd-icon"><i class="fa-solid fa-download"></i></div>
      <div class="upd-progress-title">Đang cập nhật AIChater...</div>
      <div class="upd-progress-track"><div class="upd-progress-fill" id="update-progress-fill"></div></div>
      <div class="upd-progress-pct" id="update-progress-pct">0%</div>
    </div>
  `;
  document.body.appendChild(progressOverlay);

  document.getElementById('update-required-exit-btn').addEventListener('click', () => {
    localStorage.setItem(PENDING_UPDATE_KEY, '1');
    exitApp();
  });
}

function exitApp() {
  try {
    if (CapacitorApp) {
      CapacitorApp.exitApp();
      return;
    }
  } catch (e) {}
  try { window.close(); } catch (e) {}
}

function showUpdateRequiredPopup() {
  ensureUpdateOverlaysInDOM();
  document.getElementById('update-required-overlay').classList.add('show');
}

function playFakeUpdateProgress() {
  ensureUpdateOverlaysInDOM();
  const overlay = document.getElementById('update-progress-overlay');
  const fill = document.getElementById('update-progress-fill');
  const pct = document.getElementById('update-progress-pct');
  overlay.classList.add('show');

  let progress = 0;
  const interval = setInterval(() => {
    const remaining = 100 - progress;
    progress += Math.max(1, remaining * 0.18);
    if (progress >= 100) progress = 100;
    fill.style.width = progress + '%';
    pct.textContent = Math.round(progress) + '%';
    if (progress >= 100) {
      clearInterval(interval);
      setTimeout(() => {
        overlay.classList.remove('show');
      }, 500);
    }
  }, 180);
}

/**
 * Gọi hàm này ở đầu mỗi trang (trừ trang login).
 * db: instance Firestore đã khởi tạo sẵn ở trang gọi.
 */
async function checkForUpdate(db) {
  if (localStorage.getItem(PENDING_UPDATE_KEY) === '1') {
    localStorage.removeItem(PENDING_UPDATE_KEY);
    try {
      const snap = await getDoc(doc(db, 'config', 'appVersion'));
      if (snap.exists()) {
        localStorage.setItem(LOCAL_VERSION_KEY, String(snap.data().version));
      }
    } catch (e) {}
    playFakeUpdateProgress();
    return;
  }

  try {
    const snap = await getDoc(doc(db, 'config', 'appVersion'));
    if (!snap.exists()) return;

    const remoteVersion = snap.data().version;
    const localVersion = localStorage.getItem(LOCAL_VERSION_KEY);

    if (localVersion === null) {
      localStorage.setItem(LOCAL_VERSION_KEY, String(remoteVersion));
      return;
    }

    if (String(remoteVersion) !== String(localVersion)) {
      showUpdateRequiredPopup();
    }
  } catch (e) {
    console.log('checkForUpdate error:', e);
  }
}

export { checkForUpdate };
