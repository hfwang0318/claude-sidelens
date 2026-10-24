declare module 'claude-code' {
  interface PluginState {
    sidelens: {
      /**
       * The `aboutKeyOf` value whose "What is this" card is open, or "".
       * One value per session id.
       */
      aboutOpen: StateFamily<string>
    }
  }
}
