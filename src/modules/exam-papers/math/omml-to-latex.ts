import type { Element, Node } from '@xmldom/xmldom';

/**
 * A Word equation (Office Math, `m:oMath`) as LaTeX.
 *
 * Word's equation editor keeps a tree — fraction, radical, script, bracket,
 * big operator, function, accent, matrix — and every part has a TeX
 * spelling. The text inside (`m:t`) carries Unicode operators, `×` and `≤`
 * and `α`, which TeX can print as they are but which are spelt as their
 * macros here so that a teacher who edits the formula finds the usual
 * names. Anything unknown is read in order, which loses only layout.
 */

export function ommlToLatex(node: Element): string {
  return tidy(convert(node));
}

const elements = (node: Node): Element[] =>
  Array.from(node.childNodes).filter((c): c is Element => c.nodeType === 1);

const child = (node: Node, tag: string): Element | undefined =>
  elements(node).find((c) => c.nodeName === tag);

const property = (parent: Element, tag: string, name: string, fallback: string): string =>
  child(child(parent, tag) ?? parent, name)?.getAttribute('m:val') ?? fallback;

/** `{…}` unless the value is one character — `x^2`, not `x^{2}`. */
const group = (value: string) => (value.length === 1 ? value : `{${value}}`);

function part(parent: Element, tag: string): string {
  const element = child(parent, tag);
  return element ? convert(element) : '';
}

function convert(node: Element): string {
  const kids = elements(node);
  switch (node.nodeName) {
    case 'm:t':
      return symbols(node.textContent ?? '');
    case 'm:r': {
      // A run set as ordinary text (`\text{…}`), rather than maths.
      const style = child(child(node, 'm:rPr') ?? node, 'm:nor');
      const value = (child(node, 'm:t')?.textContent ?? '').replace(/\s+/g, ' ');
      return style ? `\\text{${value}}` : symbols(value);
    }
    case 'm:f': {
      const type = property(node, 'm:fPr', 'm:type', 'bar');
      const numerator = part(node, 'm:num');
      const denominator = part(node, 'm:den');
      if (type === 'skw' || type === 'lin') return `${group(numerator)}/${group(denominator)}`;
      if (type === 'noBar') return `\\binom{${numerator}}{${denominator}}`;
      return `\\frac{${numerator}}{${denominator}}`;
    }
    case 'm:sSup':
      return `${base(part(node, 'm:e'))}^${group(part(node, 'm:sup'))}`;
    case 'm:sSub':
      return `${base(part(node, 'm:e'))}_${group(part(node, 'm:sub'))}`;
    case 'm:sSubSup':
      return `${base(part(node, 'm:e'))}_${group(part(node, 'm:sub'))}^${group(part(node, 'm:sup'))}`;
    case 'm:sPre':
      return `{}_${group(part(node, 'm:sub'))}^${group(part(node, 'm:sup'))}${part(node, 'm:e')}`;
    case 'm:rad': {
      const degree = child(node, 'm:radPr') && property(node, 'm:radPr', 'm:degHide', 'off');
      const deg = degree === 'on' || degree === '1' ? '' : part(node, 'm:deg');
      return deg ? `\\sqrt[${deg}]{${part(node, 'm:e')}}` : `\\sqrt{${part(node, 'm:e')}}`;
    }
    case 'm:d': {
      const begin = property(node, 'm:dPr', 'm:begChr', '(');
      const end = property(node, 'm:dPr', 'm:endChr', ')');
      const separator = property(node, 'm:dPr', 'm:sepChr', '|');
      const inner = kids
        .filter((c) => c.nodeName === 'm:e')
        .map(convert)
        .join(` ${fence(separator)} `);
      return `\\left${fence(begin) || '.'} ${inner} \\right${fence(end) || '.'}`;
    }
    case 'm:nary': {
      const chr = property(node, 'm:naryPr', 'm:chr', '∫');
      const sub = part(node, 'm:sub');
      const sup = part(node, 'm:sup');
      const operator = NARY[chr] ?? `\\mathop{${chr}}`;
      const limits = `${sub ? `_${group(sub)}` : ''}${sup ? `^${group(sup)}` : ''}`;
      return `${operator}${limits} ${part(node, 'm:e')}`;
    }
    case 'm:func':
      return `${functionName(part(node, 'm:fName'))} ${part(node, 'm:e')}`;
    case 'm:limLow':
      return `${part(node, 'm:e')}_${group(part(node, 'm:lim'))}`;
    case 'm:limUpp':
      return `${part(node, 'm:e')}^${group(part(node, 'm:lim'))}`;
    case 'm:bar': {
      const position = property(node, 'm:barPr', 'm:pos', 'bot');
      return `\\${position === 'top' ? 'overline' : 'underline'}{${part(node, 'm:e')}}`;
    }
    case 'm:acc': {
      const chr = property(node, 'm:accPr', 'm:chr', '̂');
      return `${ACCENTS[chr] ?? '\\hat'}{${part(node, 'm:e')}}`;
    }
    case 'm:groupChr': {
      const position = property(node, 'm:groupChrPr', 'm:pos', 'bot');
      return `\\${position === 'top' ? 'overbrace' : 'underbrace'}{${part(node, 'm:e')}}`;
    }
    case 'm:eqArr':
      return `\\begin{aligned} ${kids
        .filter((c) => c.nodeName === 'm:e')
        .map(convert)
        .join(' \\\\ ')} \\end{aligned}`;
    case 'm:m': {
      const rows = kids
        .filter((c) => c.nodeName === 'm:mr')
        .map((row) =>
          elements(row)
            .filter((c) => c.nodeName === 'm:e')
            .map(convert)
            .join(' & '),
        );
      return `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}`;
    }
    case 'm:box':
    case 'm:borderBox':
    case 'm:phant':
      return part(node, 'm:e');
    default:
      // Property elements carry no text; everything else is read in order.
      if (node.nodeName.endsWith('Pr')) return '';
      return kids.map(convert).join('');
  }
}

/** A base that is more than one token needs braces before a script. */
function base(value: string): string {
  return /^(\\[a-zA-Z]+|[^\\\s{}])$/.test(value) || /^{.*}$/.test(value) ? value : `{${value}}`;
}

function functionName(name: string): string {
  const plain = name.replace(/\\text{([^}]*)}/g, '$1').trim();
  return FUNCTIONS.has(plain) ? `\\${plain}` : `\\operatorname{${plain}}`;
}

const FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'coth',
  'log',
  'ln',
  'lg',
  'exp',
  'lim',
  'max',
  'min',
  'det',
  'gcd',
  'deg',
  'dim',
  'arg',
  'sup',
  'inf',
  'ker',
  'hom',
]);

const NARY: Record<string, string> = {
  '∫': '\\int',
  '∬': '\\iint',
  '∭': '\\iiint',
  '∮': '\\oint',
  '∑': '\\sum',
  '∏': '\\prod',
  '∐': '\\coprod',
  '⋃': '\\bigcup',
  '⋂': '\\bigcap',
  '⋁': '\\bigvee',
  '⋀': '\\bigwedge',
};

const ACCENTS: Record<string, string> = {
  '̂': '\\hat',
  '̌': '\\check',
  '̃': '\\tilde',
  '́': '\\acute',
  '̀': '\\grave',
  '̇': '\\dot',
  '̈': '\\ddot',
  '̄': '\\bar',
  '⃗': '\\vec',
  '̆': '\\breve',
  '⃖': '\\overleftarrow',
  '⃡': '\\overleftrightarrow',
};

function fence(chr: string): string {
  if (chr === '') return '.';
  return FENCES[chr] ?? chr;
}

const FENCES: Record<string, string> = {
  '{': '\\{',
  '}': '\\}',
  '⟨': '\\langle',
  '⟩': '\\rangle',
  '|': '|',
  '‖': '\\|',
  '⌊': '\\lfloor',
  '⌋': '\\rfloor',
  '⌈': '\\lceil',
  '⌉': '\\rceil',
};

/** Unicode operators and letters as the macros a TeX writer types. */
const SYMBOLS: Record<string, string> = {
  '×': '\\times ',
  '÷': '\\div ',
  '·': '\\cdot ',
  '⋅': '\\cdot ',
  '±': '\\pm ',
  '∓': '\\mp ',
  '≤': '\\le ',
  '≥': '\\ge ',
  '≠': '\\ne ',
  '≈': '\\approx ',
  '≡': '\\equiv ',
  '∞': '\\infty ',
  '→': '\\to ',
  '←': '\\leftarrow ',
  '⇒': '\\Rightarrow ',
  '⇔': '\\Leftrightarrow ',
  '∈': '\\in ',
  '∉': '\\notin ',
  '⊂': '\\subset ',
  '⊆': '\\subseteq ',
  '∪': '\\cup ',
  '∩': '\\cap ',
  '∅': '\\emptyset ',
  '∀': '\\forall ',
  '∃': '\\exists ',
  '¬': '\\neg ',
  '∧': '\\wedge ',
  '∨': '\\vee ',
  '∂': '\\partial ',
  '∇': '\\nabla ',
  '√': '\\surd ',
  '°': '^{\\circ}',
  '′': "'",
  '…': '\\ldots ',
  '⋯': '\\cdots ',
  α: '\\alpha ',
  β: '\\beta ',
  γ: '\\gamma ',
  δ: '\\delta ',
  ε: '\\varepsilon ',
  ζ: '\\zeta ',
  η: '\\eta ',
  θ: '\\theta ',
  ι: '\\iota ',
  κ: '\\kappa ',
  λ: '\\lambda ',
  μ: '\\mu ',
  ν: '\\nu ',
  ξ: '\\xi ',
  π: '\\pi ',
  ρ: '\\rho ',
  σ: '\\sigma ',
  τ: '\\tau ',
  υ: '\\upsilon ',
  φ: '\\varphi ',
  ϕ: '\\phi ',
  χ: '\\chi ',
  ψ: '\\psi ',
  ω: '\\omega ',
  Γ: '\\Gamma ',
  Δ: '\\Delta ',
  Θ: '\\Theta ',
  Λ: '\\Lambda ',
  Ξ: '\\Xi ',
  Π: '\\Pi ',
  Σ: '\\Sigma ',
  Φ: '\\Phi ',
  Ψ: '\\Psi ',
  Ω: '\\Omega ',
  '{': '\\{',
  '}': '\\}',
  '%': '\\%',
  '&': '\\&',
  '#': '\\#',
  $: '\\$',
  _: '\\_',
};

function symbols(text: string): string {
  let out = '';
  for (const ch of text) out += SYMBOLS[ch] ?? ch;
  return out;
}

/** Spaces a macro left behind, doubled or before punctuation, taken back. */
function tidy(tex: string): string {
  return tex
    .replace(/\s+/g, ' ')
    .replace(/ ([,;)}\]])/g, '$1')
    .trim();
}
