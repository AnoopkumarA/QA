declare module 'compromise' {
  interface NlpInstance {
    match(pattern: string): { found: boolean };
    questions(): { out(format: string): string[] };
    nouns(): { out(format: string): string[] };
    verbs(): { out(format: string): string[] };
    adjectives(): { out(format: string): string[] };
  }

  function nlp(text: string): NlpInstance;
  export default nlp;
} 