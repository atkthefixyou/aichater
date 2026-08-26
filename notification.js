// notification.js - Hệ thống notification Liquid Glass (không icon)

class AIChatNotification {
  constructor() {
    this.container = null;
    this.notifications = [];
    this.maxNotifications = 3;
    this.init();
  }

  init() {
    this.container = document.createElement('div');
    this.container.id = 'notification-container';
    this.container.style.cssText = `
      position: fixed;
      top: 16px;
      left: 16px;
      right: 16px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    `;
    document.body.appendChild(this.container);
  }

  show(options) {
    const {
      title = 'AIChater',
      subtitle = '',
      message = '',
      time = 'vừa xong',
      type = 'info',
      duration = 4000,
      theme = 'light', // 'light' = nền sáng chữ tối, 'dark' = nền đen chữ trắng
      onClick = null,
      onClose = null
    } = options;

    const colors = theme === 'dark'
      ? {
          appName: '#ff6fa5',
          time: 'rgba(255,255,255,0.55)',
          subtitle: '#ffffff',
          message: 'rgba(255,255,255,0.75)'
        }
      : {
          appName: '#e0397a',
          time: 'rgba(30,20,25,0.45)',
          subtitle: '#2a1a20',
          message: 'rgba(40,25,30,0.72)'
        };

    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.style.cssText = `
      pointer-events: auto;
      position: relative;
      padding: 16px 18px;
      border-radius: 22px;
      background: rgba(255,255,255,0.04);
      backdrop-filter: blur(14px) saturate(150%);
      -webkit-backdrop-filter: blur(14px) saturate(150%);
      border: 1px solid rgba(255,255,255,0.5);
      box-shadow: 0 8px 28px rgba(0,0,0,0.10), inset 0 1px 1px rgba(255,255,255,0.8), inset 0 -1px 6px rgba(255,255,255,0.15);
      animation: notificationSlideIn 0.55s cubic-bezier(.19,1,.22,1) both;
      transition: all 0.3s ease;
      width: 100%;
    `;

    // Sheen effect
    const sheen = document.createElement('div');
    sheen.style.cssText = `
      position: absolute;
      inset: 0;
      border-radius: 22px;
      background: linear-gradient(115deg, transparent 20%, rgba(255,255,255,0.35) 32%, transparent 44%);
      background-size: 250% 250%;
      animation: notificationSheen 3.2s linear infinite;
      pointer-events: none;
    `;
    toast.appendChild(sheen);

    // Body - không có icon/avatar
    const body = document.createElement('div');
    body.style.cssText = `
      flex: 1;
      min-width: 0;
      position: relative;
      z-index: 1;
    `;

    // Top row
    const topRow = document.createElement('div');
    topRow.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 4px;
    `;

    const appName = document.createElement('span');
    appName.style.cssText = `
      font-size: 13px;
      font-weight: 700;
      color: ${colors.appName};
      letter-spacing: 0.01em;
    `;
    appName.textContent = title;
    topRow.appendChild(appName);

    const timeEl = document.createElement('span');
    timeEl.style.cssText = `
      font-size: 11px;
      color: ${colors.time};
      flex-shrink: 0;
    `;
    timeEl.textContent = time;
    topRow.appendChild(timeEl);

    body.appendChild(topRow);

    // Subtitle
    if (subtitle) {
      const subEl = document.createElement('div');
      subEl.style.cssText = `
        font-size: 15px;
        font-weight: 600;
        color: ${colors.subtitle};
        margin-bottom: 3px;
      `;
      subEl.textContent = subtitle;
      body.appendChild(subEl);
    }

    // Message
    const msgEl = document.createElement('div');
    msgEl.style.cssText = `
      font-size: 13.5px;
      line-height: 1.5;
      color: ${colors.message};
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    `;
    msgEl.textContent = message;
    body.appendChild(msgEl);

    toast.appendChild(body);

    // Click event
    if (onClick) {
      toast.style.cursor = 'pointer';
      toast.onclick = () => {
        onClick();
        this.remove(toast);
      };
    }

    this.container.appendChild(toast);
    this.notifications.push(toast);

    if (duration > 0) {
      setTimeout(() => {
        this.remove(toast);
        if (onClose) onClose();
      }, duration);
    }

    if (this.notifications.length > this.maxNotifications) {
      const oldest = this.notifications.shift();
      if (oldest && oldest.parentNode) {
        oldest.style.animation = 'notificationSlideOut 0.4s cubic-bezier(.4,0,1,1) both';
        setTimeout(() => {
          if (oldest.parentNode) oldest.remove();
        }, 400);
      }
    }

    return toast;
  }

  remove(toast) {
    if (!toast || !toast.parentNode) return;
    toast.style.animation = 'notificationSlideOut 0.4s cubic-bezier(.4,0,1,1) both';
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 400);
    this.notifications = this.notifications.filter(t => t !== toast);
  }

  info(options) {
    return this.show({ ...options, type: 'info' });
  }

  success(options) {
    return this.show({ ...options, type: 'success' });
  }

  error(options) {
    return this.show({ ...options, type: 'error' });
  }

  warning(options) {
    return this.show({ ...options, type: 'warning' });
  }

  aiMessage(characterName, message, onClick, theme = 'light') {
    return this.info({
      title: 'AIChater',
      subtitle: characterName || 'Nhân vật AI',
      message: message || 'Đã gửi tin nhắn mới',
      time: 'vừa xong',
      duration: 5000,
      theme: theme,
      onClick: onClick
    });
  }

  // Thông báo thay thế alert
  alert(message, options = {}) {
    return this.show({
      title: options.title || 'AIChater',
      message: message,
      duration: options.duration || 3000,
      type: options.type || 'info',
      ...options
    });
  }
}

const notification = new AIChatNotification();

const style = document.createElement('style');
style.textContent = `
  @keyframes notificationSlideIn {
    0% { opacity: 0; transform: translateY(-40px) scale(0.96); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes notificationSlideOut {
    0% { opacity: 1; transform: translateY(0) scale(1); }
    100% { opacity: 0; transform: translateY(-40px) scale(0.96); }
  }
  @keyframes notificationSheen {
    0% { background-position: 150% 0%; }
    100% { background-position: -50% 0%; }
  }
  .notification-toast {
    font-family: -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
  }
`;
document.head.appendChild(style);

export default notification;