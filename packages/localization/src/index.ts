export const messages = { 'vi-VN': { appName: 'Nailsoft', loading: 'Đang tải…', empty: 'Chưa có dữ liệu', error: 'Đã xảy ra lỗi', retry: 'Thử lại', forbidden: 'Bạn không có quyền truy cập' }, 'en-US': { appName: 'Nailsoft', loading: 'Loading…', empty: 'No data yet', error: 'Something went wrong', retry: 'Retry', forbidden: 'You do not have permission to access this' } } as const;
export type MessageKey = keyof typeof messages['en-US'];
export const translate = (locale: keyof typeof messages, key: MessageKey): string => messages[locale][key];
