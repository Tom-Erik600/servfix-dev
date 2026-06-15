const { formatOrderDescription } = require('../public/admin/assets/js/avvik.js');

describe('formatOrderDescription', () => {
    it("should return 'Vannlekkasje kjøkken' when orderDescription is 'Vannlekkasje kjøkken' and tripletexOrderId is 12345", () => {
        expect(formatOrderDescription('Vannlekkasje kjøkken', 12345)).toBe('Vannlekkasje kjøkken');
    });

    it("should return 'Tripletex #12345' when orderDescription is null and tripletexOrderId is 12345", () => {
        expect(formatOrderDescription(null, 12345)).toBe('Tripletex #12345');
    });

    it("should return 'Tripletex #12345' when orderDescription is '' and tripletexOrderId is 12345", () => {
        expect(formatOrderDescription('', 12345)).toBe('Tripletex #12345');
    });

    it("should return '—' when orderDescription is null and tripletexOrderId is null", () => {
        expect(formatOrderDescription(null, null)).toBe('—');
    });

    it("should return '—' when orderDescription is '' and tripletexOrderId is null", () => {
        expect(formatOrderDescription('', null)).toBe('—');
    });

    it("should return '—' when orderDescription is undefined and tripletexOrderId is undefined", () => {
        expect(formatOrderDescription(undefined, undefined)).toBe('—');
    });

    it("should return 'desc' when orderDescription is 'desc' and tripletexOrderId is null", () => {
        expect(formatOrderDescription('desc', null)).toBe('desc');
    });
});
