// sync.js - Quản lý đồng bộ giữa các tab

const CHANNEL_NAME = 'aichater-sync';

// Tạo Broadcast Channel
let channel = null;
try {
  channel = new BroadcastChannel(CHANNEL_NAME);
} catch(e) {
  console.log('BroadcastChannel không được hỗ trợ, fallback sang Storage Event');
}

// Hàm gửi tín hiệu reload đến các tab khác
export function broadcastReload() {
  if (channel) {
    channel.postMessage({ type: 'RELOAD', timestamp: Date.now() });
  }
  // Fallback: dùng localStorage
  localStorage.setItem('aichater_sync_reload', Date.now().toString());
}

// Hàm lắng nghe sự kiện reload từ tab khác
export function listenReload(callback) {
  // Broadcast Channel
  if (channel) {
    channel.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'RELOAD') {
        callback();
      }
    });
  }
  
  // Fallback: Storage Event (cho trình duyệt cũ)
  window.addEventListener('storage', (event) => {
    if (event.key === 'aichater_sync_reload' && event.newValue) {
      // Chỉ reload nếu không phải tab hiện tại gửi
      callback();
    }
  });
}

// Hàm reload trang hiện tại
export function reloadCurrentPage() {
  // Gửi tín hiệu cho tab khác TRƯỚC khi reload
  broadcastReload();
  
  // Reload trang hiện tại sau 100ms
  setTimeout(() => {
    window.location.reload();
  }, 100);
}

// Hàm lắng nghe và tự động reload khi có tín hiệu
export function autoReloadOnSync() {
  listenReload(() => {
    console.log('Nhận tín hiệu reload từ tab khác, reloading...');
    // Reload sau 200ms để tránh xung đột
    setTimeout(() => {
      window.location.reload();
    }, 200);
  });
}