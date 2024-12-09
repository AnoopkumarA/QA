declare module 'natural' {
  export class WordTokenizer {
    tokenize(text: string): string[];
  }
  
  export class TfIdf {
    addDocument(doc: string): void;
  }
  
  export function JaroWinklerDistance(s1: string, s2: string): number;
} 