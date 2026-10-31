/**
 * Loads one model at a time and keeps it. Changing the model while a load is
 * in flight discards that load's result: without this, a slow earlier load
 * could finish last and install the model the user had just switched away
 * from, and its cleanup cleared the newer load so a third one started.
 */
export function createModelCache<T>(load: (model: string) => Promise<T>, initialModel: string) {
  let model = initialModel
  let ready: T | null = null
  let loading: Promise<T> | null = null
  let generation = 0

  function get(): Promise<T> {
    if (ready) return Promise.resolve(ready)
    if (loading) return loading

    const mine = ++generation
    const attempt = load(model).then(
      (value) => {
        if (mine === generation) {
          ready = value
          loading = null
        }
        return value
      },
      (err: unknown) => {
        if (mine === generation) loading = null
        throw err
      }
    )
    loading = attempt
    return attempt
  }

  return {
    get,
    model: () => model,
    /** Returns whether the model actually changed. */
    setModel(next: string): boolean {
      if (next === model) return false
      model = next
      generation++
      ready = null
      loading = null
      return true
    },
    dispose() {
      generation++
      ready = null
      loading = null
    }
  }
}
