// wgsl.d.ts
declare module "*.wgsl" {
  const source: string;
  export default source;
}


// src/declarations.d.ts
declare module "*?raw" {
  const content: string;
  export default content;
}