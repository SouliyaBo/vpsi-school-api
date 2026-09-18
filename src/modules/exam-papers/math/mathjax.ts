import { liteAdaptor, LiteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor';
import { MathDocument } from 'mathjax-full/js/core/MathDocument';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html';
import { TeX } from 'mathjax-full/js/input/tex';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages';
import { SerializedMmlVisitor } from 'mathjax-full/js/core/MmlTree/SerializedMmlVisitor';
import { mathjax } from 'mathjax-full/js/mathjax';
import { SVG } from 'mathjax-full/js/output/svg';

/**
 * TeX typeset by MathJax, once per process.
 *
 * MathJax reads the TeX into a MathML tree and draws that tree as SVG with
 * its own glyph outlines inside — no font on the machine is involved, so a
 * formula prints the same on the office's laptop and on the server. The
 * MathML is kept too: it is what the Word file gets, as a Word equation.
 */

/** MathJax's `ex` for its TeX font, as a share of the em: the x-height. */
const EX_PER_EM = 0.431;

export interface TypesetMath {
  /** A complete `<svg>` whose width and height are bare numbers of points. */
  svg: string;
  width: number;
  height: number;
  /** How far the drawing's bottom sits below the baseline, in points. */
  descent: number;
}

interface Engine {
  adaptor: LiteAdaptor;
  /** TeX → SVG. */
  svg: MathDocument<unknown, unknown, unknown>;
  /** TeX → MathML tree, no output jax. */
  mml: MathDocument<unknown, unknown, unknown>;
  visitor: SerializedMmlVisitor;
}

let instance: Engine | null = null;

function engine(): Engine {
  if (instance) return instance;
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  // MathJax's habit is to typeset an error box for bad TeX; here bad TeX
  // must be *reported*, so the error is thrown and caught by the callers.
  const input = () =>
    new TeX({
      // Every package but proof trees (they want an output jax) and
      // `noundefined`, which would set an unknown macro in red rather than
      // refuse it — a misspelt `\sqtr` must be reported.
      packages: AllPackages.filter((name) => name !== 'bussproofs' && name !== 'noundefined'),
      formatError: (_jax: unknown, error: Error) => {
        throw error;
      },
    });
  instance = {
    adaptor,
    svg: mathjax.document('', { InputJax: input(), OutputJax: new SVG({ fontCache: 'local' }) }),
    mml: mathjax.document('', { InputJax: input() }),
    visitor: new SerializedMmlVisitor(),
  };
  return instance;
}

/** True when MathJax reads the TeX without complaint. */
export function isValidTex(tex: string): boolean {
  return texToMathML(tex) !== null;
}

/** The TeX as MathML, or null when it does not parse. */
export function texToMathML(tex: string, display = false): string | null {
  const { mml, visitor } = engine();
  try {
    const tree = mml.convert(tex, { display });
    return visitor.visitTree(tree as never);
  } catch {
    return null;
  }
}

/**
 * The TeX drawn at `size` points — the size of the words around it — or
 * null when it does not parse.
 */
export function texToSvg(tex: string, size: number, display = false): TypesetMath | null {
  const { adaptor, svg: document } = engine();
  const ex = size * EX_PER_EM;
  let markup: string;
  try {
    const node = document.convert(tex, { display, em: size, ex, containerWidth: 10_000 });
    markup = adaptor.outerHTML(node as never);
  } catch {
    return null;
  }
  const svg = /<svg[\s\S]*<\/svg>/.exec(markup)?.[0];
  const opening = svg ? /<svg[^>]*/.exec(svg)?.[0] : undefined;
  if (!svg || !opening) return null;

  const exUnits = (name: string) =>
    Number(new RegExp(`\\b${name}="(-?[\\d.]+)ex"`).exec(opening)?.[1] ?? NaN);
  const width = exUnits('width') * ex;
  const height = exUnits('height') * ex;
  const align = Number(/vertical-align:\s*(-?[\d.]+)ex/.exec(opening)?.[1] ?? 0) * ex;
  if (!(width > 0) || !(height > 0)) return null;

  return {
    // Unitless: the PDF drawer takes a bare number as points, and would
    // turn an explicit `pt` into CSS pixels, a third too big.
    svg: svg
      .replace(/\bwidth="[\d.]+ex"/, `width="${width}"`)
      .replace(/\bheight="[\d.]+ex"/, `height="${height}"`),
    width,
    height,
    descent: -align,
  };
}
