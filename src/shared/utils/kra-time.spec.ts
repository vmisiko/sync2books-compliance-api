import {
  formatKraDate,
  formatKraDateTime,
  kraClockParts,
  resolveKraSaleMoment,
} from './kra-time';

describe('kra-time', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  // The whole point: the result must not depend on the timezone of the machine.
  describe.each(['UTC', 'Africa/Nairobi', 'America/Los_Angeles', 'Pacific/Auckland'])(
    'with the server running in %s',
    (tz) => {
      beforeEach(() => {
        process.env.TZ = tz;
      });

      it('formats an instant as Kenyan wall-clock time', () => {
        const t = new Date('2026-10-01T07:44:28Z'); // 10:44:28 in Nairobi
        expect(formatKraDateTime(t)).toBe('20261001104428');
        expect(formatKraDate(t)).toBe('20261001');
      });

      it('rolls the Kenyan date forward after 21:00 UTC', () => {
        const t = new Date('2026-09-30T22:30:00Z'); // 01:30 on 1 Oct in Nairobi
        expect(formatKraDateTime(t)).toBe('20261001013000');
      });

      it('stamps a sale dated today with the real Kenyan time', () => {
        const now = new Date('2026-10-01T07:44:28Z');
        expect(resolveKraSaleMoment('2026-10-01', now)).toEqual({
          yyyyMMdd: '20261001',
          yyyyMMddhhmmss: '20261001104428',
        });
      });

      it('stamps a sale with no date with the real Kenyan time', () => {
        const now = new Date('2026-10-01T07:44:28Z');
        expect(resolveKraSaleMoment(undefined, now).yyyyMMddhhmmss).toBe('20261001104428');
      });

      it('stamps a backdated sale at mid-day on its own date, never 03:00 or the previous day', () => {
        const now = new Date('2026-10-01T07:44:28Z');
        expect(resolveKraSaleMoment('2026-09-28', now)).toEqual({
          yyyyMMdd: '20260928',
          yyyyMMddhhmmss: '20260928120000',
        });
      });
    },
  );

  it('exposes the clock parts', () => {
    expect(kraClockParts(new Date('2026-10-01T07:44:28Z'))).toEqual({
      yyyy: '2026',
      mm: '10',
      dd: '01',
      hh: '10',
      mi: '44',
      ss: '28',
    });
  });
});
