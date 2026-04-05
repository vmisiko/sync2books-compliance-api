import { parseOscuInitializeDeviceInfo } from './parse-oscu-initialize-device';

describe('parseOscuInitializeDeviceInfo', () => {
  it('returns cmcKey and dvcId from data.info', () => {
    const raw = {
      resultCd: '000',
      data: {
        info: {
          tin: 'P123',
          bhfId: '00',
          dvcId: 'DVC-1',
          cmcKey: 'CMC-SECRET',
        },
      },
    };
    expect(parseOscuInitializeDeviceInfo(raw)).toEqual({
      cmcKey: 'CMC-SECRET',
      dvcId: 'DVC-1',
      tin: 'P123',
      bhfId: '00',
    });
  });

  it('returns null when data.info is missing', () => {
    expect(
      parseOscuInitializeDeviceInfo({ resultCd: '000', data: {} }),
    ).toBeNull();
  });

  it('returns null when cmcKey or dvcId missing', () => {
    expect(
      parseOscuInitializeDeviceInfo({
        data: { info: { cmcKey: 'x' } },
      }),
    ).toBeNull();
  });
});
