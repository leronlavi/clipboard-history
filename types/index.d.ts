export type Clip =
  | { id: string; kind: 'text'; text: string; at: number }
  | {
      id: string
      kind: 'image'
      /** Made up from the app in front and the text in the picture; absent while it is being named. */
      name?: string
      path: string
      thumb: string
      width: number
      height: number
      at: number
    }

declare module 'claude-code' {
  interface PluginState {
    'clipboard-history': { clips: Shaped<Clip[]> }
  }
}
