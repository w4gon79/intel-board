declare module '*?raw' {
  const content: string
  export default content
}

declare module '*?worker&inline' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}
