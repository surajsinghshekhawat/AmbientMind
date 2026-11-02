// Install and packaging steps download into home-folder caches unless ./dev has
// redirected them into .local/. Windows has no wrapper yet, so it is exempt.
if (process.platform !== 'win32' && process.env.AMBIENTMIND_ISOLATED !== '1') {
  console.error(
    '\nThis step must run through ./dev so caches and downloads stay inside the repo.\n' +
      'Use: ./dev setup   or   ./dev npm run <script>\n'
  )
  process.exit(1)
}
