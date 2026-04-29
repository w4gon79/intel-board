// Ambient CSS module declarations (no export {} so these are global ambient declarations)
declare module '*.css' {
  const css: string
  export default css
}

// Allow side-effect imports of CSS files from within node_modules (e.g. maplibre-gl)
declare module 'maplibre-gl/dist/maplibre-gl.css'
