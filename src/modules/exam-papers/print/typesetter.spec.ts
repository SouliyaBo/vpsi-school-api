import { openDocument, spansWithMath, Typesetter } from './typesetter';

/** A 1×1 white PNG — enough for pdfkit to accept as a picture. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAWk1v8QAAAABJRU5ErkJggg==',
  'base64',
);

describe('Typesetter', () => {
  const size = 11;

  function setup() {
    const { doc } = openDocument('spec');
    const type = new Typesetter(doc);
    const placed: { y: number; height: number }[] = [];
    const drawn: { y: number }[] = [];
    jest.spyOn(doc, 'image').mockImplementation(((
      _: Buffer,
      __: number,
      y: number,
      options: { height: number },
    ) => {
      placed.push({ y, height: options.height });
      return doc;
    }) as unknown as typeof doc.image);
    jest.spyOn(doc, 'text').mockImplementation(((_: string, __: number, y: number) => {
      drawn.push({ y });
      return doc;
    }) as unknown as typeof doc.text);
    return { doc, type, placed, drawn };
  }

  it('sets an equation on the words’ baseline, lowered by its descent', () => {
    const { type, placed, drawn } = setup();
    const height = type.draw(
      [{ text: 'ໃຫ້ ' }, { text: '', image: { buffer: PNG, width: 40, height: 22, descent: 7 } }],
      0,
      100,
      400,
      size,
    );
    const baseline = drawn[0].y;
    // Bottom edge 7 pt below the baseline; the top reaches above the words'
    // own ascent, so the line grows upward to hold it.
    expect(placed[0].y + placed[0].height).toBeCloseTo(baseline + 7, 5);
    expect(placed[0].y).toBeGreaterThanOrEqual(100);
    expect(height).toBeGreaterThan(type.lineHeight(size));
    expect(baseline + 7 + 1).toBeLessThanOrEqual(100 + height + 1e-6);
  });

  it('centres a picture with no descent on the text, as before', () => {
    const { type, placed, drawn } = setup();
    // A line of words alone: its baseline below the top is the face's ascent.
    type.draw([{ text: 'ຄຳຖາມ' }], 0, 0, 400, size);
    const ascent = drawn[0].y;
    const textHeight = type.lineHeight(size);

    type.draw(
      [{ text: 'ຮູບ ' }, { text: '', image: { buffer: PNG, width: 60, height: 40 } }],
      0,
      0,
      400,
      size,
    );
    const baseline = drawn[1].y;
    const textMiddle = baseline - ascent + textHeight / 2;
    expect(placed[0].y + placed[0].height / 2).toBeCloseTo(textMiddle, 5);
    expect(placed[0].y).toBeGreaterThanOrEqual(0);
  });

  it('typesets a $…$ formula as vector art on the baseline, and prints bad TeX as typed', () => {
    const spans = spansWithMath('ໃຫ້ $x^2$ ແລະ $\\frac{1}{2$ ແມ່ນ', size);
    expect(spans.map((span) => span.text)).toEqual(['ໃຫ້ ', '', ' ແລະ ', '$\\frac{1}{2$', ' ແມ່ນ']);
    expect(spans[1].math).toBeDefined();

    const { type, doc, drawn } = setup();
    const svgSpy = jest.spyOn(doc, 'save');
    const height = type.draw(spans, 0, 100, 400, size);
    expect(svgSpy).toHaveBeenCalled();
    expect(drawn.length).toBe(4);
    expect(height).toBeGreaterThanOrEqual(type.lineHeight(size));
    // A fraction makes the line taller than words alone.
    const tall = type.measure(spansWithMath('$\\frac{a}{b}$', size), 400, size);
    expect(tall).toBeGreaterThan(type.lineHeight(size));
  });

  it('keeps a line of words alone at the text leading', () => {
    const { type } = setup();
    expect(type.measure([{ text: 'ຄຳຖາມ' }], 400, size)).toBeCloseTo(type.lineHeight(size), 5);
  });
});
