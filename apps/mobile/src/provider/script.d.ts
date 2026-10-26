declare module "virtual:gleam-provider-script" {
  /** `src/provider/index.ts` built as one IIFE, for `DappView.open`'s `providerScript`. */
  const script: string;
  export default script;
}
