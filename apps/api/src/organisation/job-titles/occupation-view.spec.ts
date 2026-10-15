import { withOccupation } from './occupation-view.js';

describe('a job title’s occupation', () => {
  it('is sent with its name in the social insurance table beside its code', () => {
    expect(withOccupation({ id: 'j1', titleEn: 'Physicist', occupationCode: '012100' })).toEqual({
      id: 'j1',
      titleEn: 'Physicist',
      occupationCode: '012100',
      occupationName: 'فيزيائي عام',
    });
  });

  it('has no name without a code, or for a code the table doesn’t have', () => {
    expect(withOccupation({ occupationCode: null }).occupationName).toBeNull();
    expect(withOccupation({ occupationCode: '999998' }).occupationName).toBeNull();
  });
});
