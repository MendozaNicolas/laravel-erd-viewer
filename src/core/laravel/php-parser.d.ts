declare module 'php-parser' {
  export interface Node {
    kind: string;
    loc?: {
      start: { line: number; column: number; offset: number };
      end: { line: number; column: number; offset: number };
    };
    [key: string]: any;
  }

  export interface Program extends Node {
    kind: 'program';
    children: Node[];
    errors: any[];
  }

  export interface ParserOptions {
    parser?: {
      extractDoc?: boolean;
      php7?: boolean;
      locations?: boolean;
      withPositions?: boolean;
      suppressErrors?: boolean;
    };
    ast?: {
      withPositions?: boolean;
    };
    lexer?: {
      all_tokens?: boolean;
      comment_tokens?: boolean;
      mode_eval?: boolean;
      asp_tags?: boolean;
      short_tags?: boolean;
    };
  }

  export class Engine {
    constructor(options?: ParserOptions);
    parseCode(source: string, filename?: string): Program;
    parseEval(source: string): Program;
  }

  export default Engine;
}
