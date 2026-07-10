import { describe, expect, it } from 'vitest'; import { translate } from './index';
describe('translate', () => { it('supports both required locales', () => { expect(translate('vi-VN','retry')).toBe('Thử lại'); expect(translate('en-US','retry')).toBe('Retry'); }); });
