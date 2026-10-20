// Thanh "Dừng khẩn cấp" luôn nổi trên cùng khi AIVN AGENT điều khiển máy
document.getElementById('hk').textContent = '· ' + (navigator.platform.startsWith('Mac') ? '⌘⌥Q' : 'Ctrl+Alt+Q');
document.getElementById('stop').addEventListener('click', () => window.aivn.computerStop());
