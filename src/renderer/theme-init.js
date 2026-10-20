// Áp dụng giao diện sáng/tối đã lưu trước khi trang được vẽ (tránh nháy màu khi mở AIVN)
document.documentElement.dataset.theme = (window.aivn && window.aivn.initialTheme) || 'light';
