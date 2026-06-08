// TODO: slice 5
export type VerificationResult = Array<{
  snippetIndex: number;
  ok: boolean;
  stdout: string;
  stderr: string;
}>;

export interface CodeVerifier {
  verify(snippets: Array<{ code: string; language: string }>): Promise<VerificationResult>;
}
