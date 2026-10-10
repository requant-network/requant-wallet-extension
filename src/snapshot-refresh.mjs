// Refresh only public node data. A refresh never extends wallet authorization.
export function createSnapshotRefresh({
  load,
  onSnapshot,
  onError,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let disposed = false;
  let timer;
  let inFlight;

  function clear() {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  }

  function refresh() {
    clear();
    if (disposed) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(load)
      .then(
        (snapshot) => {
          if (!disposed) onSnapshot(snapshot);
          return 30_000;
        },
        (error) => {
          if (!disposed) onError(error);
          return 5_000;
        },
      )
      .then((delay) => {
        inFlight = undefined;
        if (!disposed) {
          timer = setTimer(() => {
            timer = undefined;
            void refresh();
          }, delay);
        }
      });
    return inFlight;
  }

  return {
    refresh,
    dispose() {
      disposed = true;
      clear();
    },
  };
}
