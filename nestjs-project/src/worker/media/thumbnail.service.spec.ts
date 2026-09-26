import { thumbnailSeekSeconds } from './thumbnail.service';

describe('thumbnailSeekSeconds', () => {
  it.each([
    [null, 0],
    [0, 0],
    [-5, 0],
    [3, 0.3],
    [60, 6],
    [100, 10],
    [3600, 10],
  ])(
    'should pick the frame for a duration of %s s at %s s',
    (duration, seek) => {
      expect(thumbnailSeekSeconds(duration)).toBeCloseTo(seek);
    },
  );
});
