import { PaginationQueryDto } from './pagination.dto';

function query(fields: Partial<PaginationQueryDto> = {}) {
  return Object.assign(new PaginationQueryDto(), fields);
}

describe('PaginationQueryDto.toSort', () => {
  it('breaks ties on _id after the fallback, so pages cannot overlap', () => {
    expect(query().toSort(['lastNameLo'], { lastNameLo: 1 })).toEqual({ lastNameLo: 1, _id: 1 });
  });

  it('breaks ties on _id after a whitelisted sortBy', () => {
    expect(query({ sortBy: 'rank', sortOrder: 'asc' }).toSort(['rank'], { average: -1 })).toEqual({
      rank: 1,
      _id: 1,
    });
  });

  it('keeps the tie-break last, after the key it breaks', () => {
    const sort = query({ sortBy: 'date', sortOrder: 'desc' }).toSort(['date'], { date: -1 });
    expect(Object.keys(sort)).toEqual(['date', '_id']);
  });

  it('ignores a sortBy that is not whitelisted', () => {
    expect(query({ sortBy: 'passwordHash' }).toSort(['date'], { date: -1 })).toEqual({
      date: -1,
      _id: 1,
    });
  });

  it('leaves a sort that already names _id alone', () => {
    expect(query().toSort([], { _id: -1 })).toEqual({ _id: -1 });
  });
});
