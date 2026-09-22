/* eslint-disable @typescript-eslint/no-require-imports -- each test needs a
   fresh module instance after changing process.env, see jest.resetModules()
   below; a static import would only ever see the first env-var snapshot. */

const ORIGINAL_ENV = process.env;

describe('demoMode config', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('defaults to inactive with a 60 minute reset interval', () => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_RESET_MINUTES;

    const { DEMO_MODE, DEMO_RESET_MINUTES } = require('../../src/config/demoMode');
    expect(DEMO_MODE).toBe(false);
    expect(DEMO_RESET_MINUTES).toBe(60);
  });

  it('activates only on the exact string "true"', () => {
    process.env.DEMO_MODE = 'yes';
    expect(require('../../src/config/demoMode').DEMO_MODE).toBe(false);

    jest.resetModules();
    process.env.DEMO_MODE = 'true';
    expect(require('../../src/config/demoMode').DEMO_MODE).toBe(true);
  });

  it('clamps DEMO_RESET_MINUTES to [5, 1440]', () => {
    process.env.DEMO_RESET_MINUTES = '2';
    expect(require('../../src/config/demoMode').DEMO_RESET_MINUTES).toBe(5);

    jest.resetModules();
    process.env.DEMO_RESET_MINUTES = '999999';
    expect(require('../../src/config/demoMode').DEMO_RESET_MINUTES).toBe(1440);

    jest.resetModules();
    process.env.DEMO_RESET_MINUTES = 'not-a-number';
    expect(require('../../src/config/demoMode').DEMO_RESET_MINUTES).toBe(60);
  });
});
