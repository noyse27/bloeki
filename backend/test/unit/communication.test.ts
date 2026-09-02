import {
  applyWordFilter,
  convertEmoticons,
  defaultReactionConfig,
  isReactionAssetId,
  normalizeBlockedWords,
  normalizeChatBody,
  validateReactionConfig,
} from '../../src/services/communication';

describe('communication validation', () => {
  it('normalizes valid messages and rejects empty or oversized bodies', () => {
    expect(normalizeChatBody('  Hallo zusammen!  ')).toBe('Hallo zusammen!');
    expect(normalizeChatBody('   ')).toBeNull();
    expect(normalizeChatBody('x'.repeat(501))).toBeNull();
    expect(normalizeChatBody({ body: 'nope' })).toBeNull();
  });

  it('normalizes blocked words case-insensitively and rejects invalid lists', () => {
    expect(normalizeBlockedWords([' Mist ', 'mist', 'zwei  wörter'])).toEqual(['Mist', 'zwei wörter']);
    expect(normalizeBlockedWords([''])).toBeNull();
    expect(normalizeBlockedWords(new Array(101).fill('x'))).toBeNull();
  });

  it('filters full words and phrases without censoring innocent substrings', () => {
    expect(applyWordFilter('Mist! Das ist mist. Miststück bleibt.', ['Mist'])).toBe(
      '*piep*! Das ist *piep*. Miststück bleibt.',
    );
    expect(applyWordFilter('Das ist ganz großer mist', ['großer mist'])).toBe('Das ist ganz *piep*');
  });

  it('converts supported standalone text emoticons', () => {
    expect(convertEmoticons('Hallo :) Das rockt :D! <3')).toBe('Hallo 🙂 Das rockt 😄! ❤️');
    expect(convertEmoticons('https://example.test/a:)')).toBe('https://example.test/a:)');
  });

  it('accepts only curated reaction assets and enforces uniqueness/eight-limit', () => {
    expect(isReactionAssetId('dance')).toBe(true);
    expect(isReactionAssetId('custom-html')).toBe(false);
    const defaults = defaultReactionConfig();
    expect(validateReactionConfig(defaults)).not.toBeNull();
    expect(validateReactionConfig({ ...defaults, waiting: [...defaults.waiting, defaults.waiting[0]] })).toBeNull();
    expect(validateReactionConfig({ ...defaults, waiting: new Array(9).fill(defaults.waiting[0]) })).toBeNull();
  });
});
